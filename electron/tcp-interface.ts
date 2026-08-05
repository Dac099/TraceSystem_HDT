import { EventEmitter } from 'node:events'
import { createServer, type Server, type Socket } from 'node:net'
import { ConfigService } from './config'
import { Logger } from './logger'

export interface ToolingScanPayload {
  matrix: string
  stationId: string
}

export interface PlateScanPayload {
  toolingId: string
  modelId: string
  stationId: string
}

/** Temporary station used for every scanner until the IP map is enabled. */
const TEMP_DEFAULT_STATION_ID = '1'

/**
 * TCP server that receives data from the network barcode scanners.
 *
 * Emits:
 *  - 'ToolingScan' (payload: ToolingScanPayload) e.g. P12815849L3S2D261950000055
 *  - 'PlateScan'   (payload: PlateScanPayload)   e.g. Ens_Final_12749631,T1
 */
export class TcpInterface extends EventEmitter {
  private server: Server | null = null

  start(): void {
    const { tcp } = ConfigService.get()
    const logger = Logger.get()

    this.server = createServer((socket) => this.onConnection(socket))
    this.server.on('error', (err) => logger.error('TCP interface error', err))
    this.server.listen(tcp.port, tcp.host, () => {
      logger.info(`TCP interface listening on ${tcp.host}:${tcp.port}`)
    })
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()))
    this.server = null
  }

  private onConnection(socket: Socket): void {
    const remote = socket.remoteAddress ?? 'unknown'
    Logger.get().info(`Scanner connected from ${remote}`)
    socket.setEncoding('utf-8')

    let buffer = ''
    socket.on('data', (chunk: string) => {
      buffer += chunk
      const lines = buffer.split(/\r\n|\r|\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) this.processLine(line.trim(), remote)
    })
    socket.on('close', () => {
      if (buffer.trim()) this.processLine(buffer.trim(), remote)
      Logger.get().info(`Scanner disconnected from ${remote}`)
    })
    socket.on('error', (err) => Logger.get().error(`Scanner socket error (${remote})`, err))
  }

  private processLine(data: string, remote: string): void {
    const logger = Logger.get()
    if (!data) return
    logger.info(`TCP data from ${remote}: ${data}`)

    if (data.includes(',')) {
      // PlateScan: "Ens_Final_12749631,T1" -> modelId,toolingId
      const [modelId, toolingId] = data.split(',').map((part) => part.trim())
      if (!modelId || !toolingId) {
        logger.warn(`Invalid PlateScan payload ignored: "${data}"`)
        return
      }
      const payload: PlateScanPayload = { toolingId, modelId, stationId: this.resolveStationId(remote) }
      this.emit('PlateScan', payload)
      return
    }

    // ToolingScan: "P12815849L3S2D261950000055"
    const matrix = data
      .replace(/\x1D/g, "|") // Non-printable character: GS
      .replace(/\x1E/g, "|") // Non-printable character: RS
      .replace(/[\x00-\x1F\x7F]/g, "");

    const payload: ToolingScanPayload = { matrix, stationId: this.resolveStationId(remote) }
    this.emit('ToolingScan', payload)
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private resolveStationId(_remote: string): string {
    // TODO(scanners): enable the IP -> stationId map once the physical scanners
    // are connected. Until then every payload is accepted no matter its source
    // and is assigned to the temporary default station.
    //
    const { scannerStationMap } = ConfigService.get()
    const ip = _remote.replace(/^::ffff:/, '')
    const stationId = scannerStationMap[ip]
    if (stationId === undefined) {
      Logger.get().warn(`Scanner IP ${ip} is not mapped to any station; data ignored`)
      return TEMP_DEFAULT_STATION_ID
    }
    return String(stationId)
  }
}

import { EventEmitter } from 'node:events'
import { PLC, Scanner } from 'ethernet-ip'
import { ConfigService, type PlcConfig } from './config'
import { Logger } from './logger'

const HEARTBEAT_TIMEOUT_MS = 10_000
const INITIAL_CONNECT_RETRY_MS = 5_000
const SCAN_RATE_MS = 200
const SCAN_ERROR_LOG_THROTTLE_MS = 10_000

export interface SaveResults {
  statusPart: number
  finalLeakRate: number
  finalPressure: number
}

/**
 * Wraps one PLC connection (ethernet-ip v2): initial tag discovery, tag
 * subscriptions via Scanner, heartbeat watchdog and auto-reconnect wiring.
 *
 * Emits:
 *  - 'reqSavePart' (stationIndex: number)   rising edge of Server_St[i].ReqSavePart
 *  - 'plcDisconnected' (ip: string)         heartbeat watchdog expired
 *  - 'plcAlive' (ip: string)                heartbeat received again
 */
export class PlcService extends EventEmitter {
  readonly ip: string
  private readonly plcConfig: PlcConfig
  private readonly plc: PLC
  private readonly scanner: Scanner
  private heartbeatTimer: NodeJS.Timeout | null = null
  private lastScanErrorLog = 0
  private stopped = false

  constructor(plcConfig: PlcConfig) {
    super()
    this.plcConfig = plcConfig
    this.ip = plcConfig.ip
    this.plc = new PLC({ logger: Logger.eipAdapter() })
    this.scanner = new Scanner((tags) => this.plc.read(tags), { rate: SCAN_RATE_MS })
    this.wireEvents()
    this.subscribeTags()
  }

  private tag(stationIndex: number, member: string): string {
    return ConfigService.tag(stationIndex, member)
  }

  private wireEvents(): void {
    const logger = Logger.get()

    this.plc.on('connected', () => {
      logger.info(`PLC ${this.ip}: connected`)
      this.discoverTags().catch((err) => logger.error(`PLC ${this.ip}: initial tag read failed`, err))
      this.restartHeartbeatWatchdog()
    })
    this.plc.on('disconnected', () => logger.warn(`PLC ${this.ip}: disconnected`))
    this.plc.on('reconnecting', (attempt) => logger.warn(`PLC ${this.ip}: reconnecting (attempt ${attempt})`))
    this.plc.on('error', (err) => logger.error(`PLC ${this.ip}: error`, err))

    this.scanner.on('tagChanged', (tag, value) => {
      if (tag === this.tag(0, 'HeartBeat')) {
        this.onHeartbeat(value === true)
        return
      }
      const match = /\[(\d+)\]\.ReqSavePart$/.exec(tag)
      if (match && value === true) this.emit('reqSavePart', Number(match[1]))
    })
    this.scanner.on('scanError', (err) => {
      const now = Date.now()
      if (now - this.lastScanErrorLog >= SCAN_ERROR_LOG_THROTTLE_MS) {
        this.lastScanErrorLog = now
        logger.error(`PLC ${this.ip}: scan error`, err)
      }
    })
    // First successful read of HeartBeat: force the initial ack to true so the
    // handshake starts right after connect; 'tagChanged' keeps it alive after.
    this.scanner.on('tagInitialized', (tag) => {
      if (tag === this.tag(0, 'HeartBeat')) this.onHeartbeat(false)
    })
  }

  private subscribeTags(): void {
    this.scanner.subscribe(this.tag(0, 'HeartBeat'))
    for (let i = 1; i <= this.plcConfig.stationIds.length; i++) {
      this.scanner.subscribe(this.tag(i, 'ReqSavePart'))
    }
  }

  /** First read of every tag used: validates paths and caches types for writes. */
  private async discoverTags(): Promise<void> {
    const members = [
      'CycleStart',
      'MachineReady',
      'ReqSavePart',
      'StatusPart',
      'FinalLeakRate',
      'FinalPressure',
      'CurrentModel',
      'CurrentTooling',
      'DataMatrix',
      'Messages'
    ]
    const tags = [this.tag(0, 'HeartBeat')]
    for (let i = 1; i <= this.plcConfig.stationIds.length; i++) {
      for (const member of members) tags.push(this.tag(i, member))
    }
    // Read one by one: ethernet-ip v2 batch reads throw "Missing template" for
    // built-in STRING tags (0x0fce has no template); single reads decode them fine.
    for (const tag of tags) await this.plc.read(tag)
    Logger.get().info(`PLC ${this.ip}: ${tags.length} tags discovered`)
  }

  private onHeartbeat(alive: boolean): void {
    if (alive) return
    // HeartBeat dropped to false: acknowledge it back to true and restart the watchdog.
    this.emit('plcAlive', this.ip)
    this.plc.write(this.tag(0, 'HeartBeat'), true).catch((err) => Logger.get().error(`PLC ${this.ip}: heartbeat ack failed`, err))
    this.restartHeartbeatWatchdog()
  }

  private restartHeartbeatWatchdog(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer)
    this.heartbeatTimer = setTimeout(() => {
      Logger.get().error(`PLC ${this.ip}: no heartbeat for ${HEARTBEAT_TIMEOUT_MS / 1000}s`)
      this.emit('plcDisconnected', this.ip)
      // Keep watching so a permanently dead PLC keeps raising the alert.
      this.restartHeartbeatWatchdog()
    }, HEARTBEAT_TIMEOUT_MS)
  }

  /** Connects to the PLC, retrying until the first connection succeeds. */
  async start(): Promise<void> {
    const logger = Logger.get()
    while (!this.stopped && !this.plc.isConnected) {
      try {
        await this.plc.connect(this.ip, {
          slot: this.plcConfig.slot,
          autoReconnect: { enabled: true, initialDelay: 1000, maxDelay: 30000, multiplier: 2, maxRetries: Infinity }
        })
      } catch (err) {
        logger.error(`PLC ${this.ip}: connect failed, retrying in ${INITIAL_CONNECT_RETRY_MS / 1000}s`, err)
        await new Promise((resolve) => setTimeout(resolve, INITIAL_CONNECT_RETRY_MS))
      }
    }
    if (!this.stopped) this.scanner.scan()
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer)
    this.scanner.pause()
    if (this.plc.isConnected) await this.plc.disconnect().catch(() => undefined)
  }

  async readMachineReady(stationIndex: number): Promise<boolean> {
    return (await this.plc.read(this.tag(stationIndex, 'MachineReady'))) === true
  }

  async readCurrentModel(stationIndex: number): Promise<string> {
    return String(await this.plc.read(this.tag(stationIndex, 'CurrentModel')))
  }

  async readSaveResults(stationIndex: number): Promise<SaveResults> {
    const [statusPart, finalLeakRate, finalPressure] = await this.plc.read([
      this.tag(stationIndex, 'StatusPart'),
      this.tag(stationIndex, 'FinalLeakRate'),
      this.tag(stationIndex, 'FinalPressure')
    ])
    return {
      statusPart: Number(statusPart),
      finalLeakRate: Number(finalLeakRate),
      finalPressure: Number(finalPressure)
    }
  }

  /** Starts the machine cycle for a station with the scanned data. */
  async startCycle(stationIndex: number, toolingId: string, matrix: string): Promise<void> {
    await this.plc.write({
      [this.tag(stationIndex, 'CycleStart')]: true,
      [this.tag(stationIndex, 'CurrentTooling')]: toolingId,
      [this.tag(stationIndex, 'DataMatrix')]: matrix
    })
  }

  /** Sends an alert/error message to the machine HMI via the Messages tag. */
  async writeMessage(stationIndex: number, message: string): Promise<void> {
    await this.plc.write(this.tag(stationIndex, 'Messages'), message)
  }

  /** Handshake/reset once the record was stored in the database. */
  async resetAfterSave(stationIndex: number): Promise<void> {
    await this.plc.write({
      [this.tag(stationIndex, 'ReqSavePart')]: false,
      [this.tag(stationIndex, 'CycleStart')]: false,
      [this.tag(stationIndex, 'CurrentTooling')]: '',
      [this.tag(stationIndex, 'DataMatrix')]: '',
      [this.tag(stationIndex, 'Messages')]: ''
    })
  }
}

import { EventEmitter } from 'node:events'
import { ConfigService } from './config'
import { Logger } from './logger'
import {
  hasRecordForPartAndModel,
  hasSuccessfulSubAssembly,
  insertRecord,
  type ToolingRecord
} from './database'
import type { PlcService } from './plc-service'
import type { PlateScanPayload, ToolingScanPayload } from './tcp-interface'

export interface ParsedMatrix {
  partNumber: string // [0-8]
  machineLine: string // [9-10]
  shift: string // [11-12]
  julianDate: string // [13-18]
  serialNumber: string // [19-25]
}

const MATRIX_MIN_LENGTH = 26

export function parseMatrix(matrix: string): ParsedMatrix | null {
  if (matrix.length < MATRIX_MIN_LENGTH) return null
  return {
    partNumber: matrix.slice(0, 9),
    machineLine: matrix.slice(9, 11),
    shift: matrix.slice(11, 13),
    julianDate: matrix.slice(13, 19),
    serialNumber: matrix.slice(19, 26)
  }
}

interface PlateData {
  modelId: string
  toolingId: string
}

interface PendingMatrix {
  matrix: string
  parsed: ParsedMatrix
}

/**
 * Independent workflow for one machine station. Holds the last PlateScan
 * (kept across cycles, overwritten by the next PlateScan) and one pending
 * ToolingScan; processes the tool once both are present.
 *
 * Emits:
 *  - 'warning' (message: string)          warnings for the frontend alarm queue
 *  - 'recordSaved' (record: ToolingRecord) a new row was stored in the database
 */
export class StationProcess extends EventEmitter {
  readonly stationId: string
  private readonly stationIndex: number
  private readonly plc: PlcService
  private plate: PlateData | null = null
  private pending: PendingMatrix | null = null
  private processing = false
  private scanQueue: Promise<void> = Promise.resolve()

  constructor(stationId: string, plc: PlcService, stationIndex: number) {
    super()
    this.stationId = stationId
    this.plc = plc
    this.stationIndex = stationIndex
  }

  private log(): Logger {
    return Logger.get()
  }

  private warn(message: string): void {
    this.log().warn(`Station ${this.stationId}: ${message}`)
    this.emit('warning', message)
  }

  onPlateScan(payload: PlateScanPayload): Promise<void> {
    return this.enqueueScan(() => this.acceptPlateScan(payload))
  }

  onToolingScan(payload: ToolingScanPayload): Promise<void> {
    return this.enqueueScan(() => this.acceptToolingScan(payload))
  }

  /** Runs scanner events in arrival order so validation and cycle start are atomic per station. */
  private enqueueScan(action: () => Promise<void>): Promise<void> {
    const run = this.scanQueue.then(action)
    this.scanQueue = run.catch((err) => {
      this.log().error(`Station ${this.stationId}: process failed`, err)
      this.warn('Error al procesar la herramienta')
    })
    return this.scanQueue
  }

  private async acceptPlateScan(payload: PlateScanPayload): Promise<void> {
    if (!(await this.canAcceptScannerValue())) return

    this.plate = { modelId: payload.modelId, toolingId: payload.toolingId }
    this.log().info(`Station ${this.stationId}: plate stored (model=${payload.modelId}, tooling=${payload.toolingId})`)
    if (this.pending) await this.runProcess()
  }

  private async acceptToolingScan(payload: ToolingScanPayload): Promise<void> {
    if (!(await this.canAcceptScannerValue())) return

    const parsed = parseMatrix(payload.matrix)
    if (!parsed) {
      this.warn(`Matriz inválida: "${payload.matrix}"`)
      return
    }
    this.pending = { matrix: payload.matrix, parsed }
    this.log().info(`Station ${this.stationId}: matrix scanned (${payload.matrix})`)

    if (!this.plate) {
      // PlateScan is received once per tooling change; hold the tool scan until it exists.
      this.log().info(`Station ${this.stationId}: matrix held, waiting for plate scan`)
      return
    }
    await this.runProcess()
  }

  /** Scanner values are accepted only when both local state and the PLC report no cycle. */
  private async canAcceptScannerValue(): Promise<boolean> {
    if (this.processing) {
      await this.failValidation('Proceso en curso', false)
      return false
    }

    try {
      if (await this.plc.readCycleStart(this.stationIndex)) {
        await this.failValidation('Proceso en curso', false)
        return false
      }
    } catch (err) {
      this.log().error(`Station ${this.stationId}: could not read CycleStart`, err)
      this.warn('Error al procesar la herramienta')
      return false
    }

    return true
  }

  private async runProcess(): Promise<void> {
    // 1. The machine must be ready.
    if (!(await this.plc.readMachineReady(this.stationIndex))) {
      await this.failValidation('Máquina no lista', false)
      return
    }

    // 2. Both scanner values are required. Normal partial scans wait silently;
    // this remains as a defensive guard for any direct process invocation.
    if (!this.pending || !this.plate) {
      await this.failValidation('Sin valores de escaner', false)
      return
    }

    const { matrix, parsed } = this.pending
    const plate = this.plate

    // 3. The model running in the machine must match the scanned plate.
    const currentModel = await this.plc.readCurrentModel(this.stationIndex)
    if (currentModel !== plate.modelId) {
      await this.failValidation('Modelo no coincide', true)
      return
    }

    // 4. Final assembly requires a previous successful subassembly cycle for
    // the same part number. The serial number is intentionally not involved.
    if (currentModel.startsWith('Ens_Final') && !(await hasSuccessfulSubAssembly(parsed.partNumber))) {
      await this.failValidation('Sin Sub. Ensamble', true)
      return
    }

    // 5. A part number can run only once for an exact model, regardless of result.
    if (await hasRecordForPartAndModel(parsed.partNumber, currentModel)) {
      await this.failValidation('Pieza ya procesada', true)
      return
    }

    // Start the cycle: hand tooling id and data matrix to the machine.
    await this.plc.startCycle(this.stationIndex, plate.toolingId, matrix)
    this.processing = true
    this.log().info(`Station ${this.stationId}: cycle started (tooling=${plate.toolingId}, matrix=${matrix})`)
  }

  /** Reports a failed condition to the frontend and machine HMI. */
  private async failValidation(message: string, clearPending: boolean): Promise<void> {
    this.warn(message)
    try {
      await this.plc.writeMessage(this.stationIndex, message)
    } catch (err) {
      this.log().error(`Station ${this.stationId}: could not write Messages tag`, err)
    }
    if (clearPending) this.pending = null
  }

  /** Triggered by the rising edge of the station ReqSavePart tag. */
  async onReqSavePart(): Promise<void> {
    if (!this.processing || !this.pending || !this.plate) {
      this.log().warn(`Station ${this.stationId}: ReqSavePart received with no cycle in progress`)
      return
    }
    try {
      const results = await this.plc.readSaveResults(this.stationIndex)
      const { matrix, parsed } = this.pending
      const status = results.statusPart === 1
      const record = await insertRecord({
        stationId: this.stationId,
        modelId: this.plate.modelId,
        toolingId: this.plate.toolingId,
        matrixReaded: matrix,
        partNumber: parsed.partNumber,
        machineLine: parsed.machineLine,
        shift: parsed.shift,
        julianDate: parsed.julianDate,
        serialNumber: parsed.serialNumber,
        status,
        finalLeakRate: results.finalLeakRate,
        finalPressure: results.finalPressure
      })
      this.log().info(`Station ${this.stationId}: record #${record.id} saved (status=${record.status})`)

      const savedMessage = status ? 'Pieza ok almacenada' : 'Pieza nOK almacenada'
      await this.plc.resetAfterSave(this.stationIndex, savedMessage)

      // Reset the cycle state; the plate is kept until the next PlateScan.
      this.pending = null
      this.processing = false
      this.emit('recordSaved', record)
    } catch (err) {
      this.log().error(`Station ${this.stationId}: could not save record`, err)
      this.warn('Error al guardar el registro')
    }
  }
}

/** Creates one StationProcess per configured station. */
export function createStationProcesses(plcs: PlcService[]): Map<string, StationProcess> {
  const stations = new Map<string, StationProcess>()
  for (const plc of plcs) {
    const plcConfig = ConfigService.get().plcs.find((p) => p.ip === plc.ip)
    if (!plcConfig) continue
    plcConfig.stationIds.forEach((stationId, position) => {
      const id = String(stationId)
      stations.set(id, new StationProcess(id, plc, position + 1))
      plc.on('reqSavePart', (stationIndex: number) => {
        if (stationIndex === position + 1) void stations.get(id)?.onReqSavePart()
      })
    })
  }
  return stations
}

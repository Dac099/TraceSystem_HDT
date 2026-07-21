import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export interface TcpConfig {
  host: string
  port: number
}

export interface DatabaseConfig {
  host: string
  port: number
  user: string
  password: string
  database: string
}

export interface PlcConfig {
  ip: string
  slot: number
  stationIds: number[]
}

export interface LogsConfig {
  dir: string
  retentionDays: number
}

export interface AppConfig {
  tcp: TcpConfig
  database: DatabaseConfig
  plcs: PlcConfig[]
  plcTagName: string
  scannerStationMap: Record<string, number>
  logs: LogsConfig
}

export interface StationLocation {
  plc: PlcConfig
  /** Index of the station inside the PLC Server_St array (1-4). */
  stationIndex: number
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireKeys(obj: Record<string, unknown>, keys: string[], path: string): void {
  for (const key of keys) {
    if (!(key in obj)) throw new Error(`Invalid config: missing "${path}.${key}"`)
  }
}

function validate(raw: unknown): AppConfig {
  if (!isObject(raw)) throw new Error('Invalid config: root must be an object')
  requireKeys(raw, ['tcp', 'database', 'plcs', 'plcTagName', 'scannerStationMap', 'logs'], '')

  const { tcp, database, plcs, plcTagName, scannerStationMap, logs } = raw

  if (!isObject(tcp)) throw new Error('Invalid config: "tcp" must be an object')
  requireKeys(tcp, ['host', 'port'], 'tcp')
  if (typeof tcp.host !== 'string' || typeof tcp.port !== 'number')
    throw new Error('Invalid config: "tcp.host" must be string and "tcp.port" must be number')

  if (!isObject(database)) throw new Error('Invalid config: "database" must be an object')
  requireKeys(database, ['host', 'port', 'user', 'password', 'database'], 'database')

  if (!Array.isArray(plcs) || plcs.length === 0)
    throw new Error('Invalid config: "plcs" must be a non-empty array')
  for (const [i, plc] of plcs.entries()) {
    if (!isObject(plc)) throw new Error(`Invalid config: "plcs[${i}]" must be an object`)
    requireKeys(plc, ['ip', 'slot', 'stationIds'], `plcs[${i}]`)
    if (typeof plc.ip !== 'string') throw new Error(`Invalid config: "plcs[${i}].ip" must be string`)
    if (typeof plc.slot !== 'number') throw new Error(`Invalid config: "plcs[${i}].slot" must be number`)
    if (!Array.isArray(plc.stationIds) || plc.stationIds.length === 0 || !plc.stationIds.every((id) => typeof id === 'number'))
      throw new Error(`Invalid config: "plcs[${i}].stationIds" must be a non-empty number array`)
  }

  if (typeof plcTagName !== 'string' || plcTagName.length === 0)
    throw new Error('Invalid config: "plcTagName" must be a non-empty string')

  if (!isObject(scannerStationMap)) throw new Error('Invalid config: "scannerStationMap" must be an object')

  if (!isObject(logs)) throw new Error('Invalid config: "logs" must be an object')
  requireKeys(logs, ['dir', 'retentionDays'], 'logs')

  return raw as unknown as AppConfig
}

/**
 * Loads and exposes the application configuration from config.json.
 * The file lives in the app source directory (project root in dev,
 * next to the packaged app in production).
 */
export class ConfigService {
  private static config: AppConfig | null = null

  static load(): AppConfig {
    const configPath = process.env.CONFIG_PATH ?? join(app.getAppPath(), 'config.json')
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(configPath, 'utf-8'))
    } catch (err) {
      throw new Error(`Cannot read config file at ${configPath}: ${(err as Error).message}`)
    }
    this.config = validate(raw)
    return this.config
  }

  static get(): AppConfig {
    if (!this.config) throw new Error('Config not loaded. Call ConfigService.load() first.')
    return this.config
  }

  /** Maps a global stationId (1-8) to its PLC and its index inside Server_St (1-4). */
  static stationLocation(stationId: number): StationLocation | null {
    for (const plc of this.get().plcs) {
      const position = plc.stationIds.indexOf(stationId)
      if (position !== -1) return { plc, stationIndex: position + 1 }
    }
    return null
  }

  /** Builds a fully qualified tag name, e.g. Server_St[2].MachineReady */
  static tag(stationIndex: number, member: string): string {
    return `${this.get().plcTagName}[${stationIndex}].${member}`
  }
}

import { Pool } from 'pg'
import { ConfigService } from './config'
import { Logger } from './logger'

// Parameterized SQL is used directly; no ORM is involved.
let pool: Pool | null = null

function getPool(): Pool {
  if (!pool) {
    pool = new Pool(ConfigService.get().database)
    pool.on('error', (err) => Logger.get().error('PostgreSQL pool error', err))
  }
  return pool
}

export interface ToolingRecord {
  id: number
  stationId: string
  modelId: string | null
  toolingId: string | null
  matrixReaded: string | null
  partNumber: string | null
  machineLine: string | null
  shift: string | null
  julianDate: string | null
  serialNumber: string | null
  createdAt: Date
  status: boolean | null
  finalLeakRate: number | null
  finalPressure: number | null
}

export interface NewToolingRecord {
  stationId: string
  modelId: string
  toolingId: string
  matrixReaded: string
  partNumber: string
  machineLine: string
  shift: string
  julianDate: string
  serialNumber: string
  status: boolean
  finalLeakRate: number
  finalPressure: number
}

export interface RecordFilters {
  stationId?: string
  modelId?: string
  toolingId?: string
  matrixReaded?: string
  startDate?: string
  endDate?: string
}

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS "toolingRecords" (
  id bigserial PRIMARY KEY,
  "stationId" varchar(2) NOT NULL,
  "modelId" varchar(30),
  "toolingId" char(2),
  "matrixReaded" varchar(30),
  "partNumber" varchar(9),
  "machineLine" varchar(2),
  "shift" varchar(2),
  "julianDate" varchar(6),
  "serialNumber" varchar(5),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  status boolean,
  "finalLeakRate" real,
  "finalPressure" real
)`

/** Creates the toolingRecords table when it does not exist yet. */
export async function initDatabase(): Promise<void> {
  await getPool().query(CREATE_TABLE_SQL)
  Logger.get().info('Database ready: table "toolingRecords" verified')
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}

/** Records belonging to the same physical tool (same part number + serial number). */
export async function findByToolIdentity(partNumber: string, serialNumber: string): Promise<ToolingRecord[]> {
  const result = await getPool().query<ToolingRecord>(
    'SELECT * FROM "toolingRecords" WHERE "partNumber" = $1 AND "serialNumber" = $2 ORDER BY "createdAt" DESC',
    [partNumber, serialNumber]
  )
  return result.rows
}

export async function insertRecord(record: NewToolingRecord): Promise<ToolingRecord> {
  const result = await getPool().query<ToolingRecord>(
    `INSERT INTO "toolingRecords"
      ("stationId", "modelId", "toolingId", "matrixReaded", "partNumber", "machineLine", "shift", "julianDate", "serialNumber", status, "finalLeakRate", "finalPressure")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      record.stationId,
      record.modelId,
      record.toolingId,
      record.matrixReaded,
      record.partNumber,
      record.machineLine,
      record.shift,
      record.julianDate,
      record.serialNumber,
      record.status,
      record.finalLeakRate,
      record.finalPressure
    ]
  )
  return result.rows[0]
}

/** Latest processed tools across all stations (Activity view). */
export async function getLatest(limit = 100): Promise<ToolingRecord[]> {
  const result = await getPool().query<ToolingRecord>(
    'SELECT * FROM "toolingRecords" ORDER BY "createdAt" DESC, id DESC LIMIT $1',
    [limit]
  )
  return result.rows
}

interface BuiltFilters {
  where: string
  params: unknown[]
}

function buildFilters(filters: RecordFilters): BuiltFilters {
  const clauses: string[] = []
  const params: unknown[] = []
  const add = (clause: string, value: unknown): void => {
    params.push(value)
    clauses.push(clause.replace('?', `$${params.length}`))
  }

  if (filters.stationId) add('"stationId" = ?', filters.stationId)
  if (filters.toolingId) add('"toolingId" = ?', filters.toolingId)
  if (filters.modelId) add('"modelId" ILIKE ?', `%${filters.modelId}%`)
  if (filters.matrixReaded) add('"matrixReaded" ILIKE ?', `%${filters.matrixReaded}%`)
  if (filters.startDate) add('"createdAt" >= ?', filters.startDate)
  if (filters.endDate) add('"createdAt" <= ?', filters.endDate)

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

export interface PagedResult {
  rows: ToolingRecord[]
  total: number
}

export async function queryRecords(filters: RecordFilters, page: number, pageSize = 50): Promise<PagedResult> {
  const { where, params } = buildFilters(filters)
  const offset = (Math.max(page, 1) - 1) * pageSize
  const [rows, count] = await Promise.all([
    getPool().query<ToolingRecord>(
      `SELECT * FROM "toolingRecords" ${where} ORDER BY "createdAt" DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]
    ),
    getPool().query<{ count: string }>(`SELECT COUNT(*) AS count FROM "toolingRecords" ${where}`, params)
  ])
  return { rows: rows.rows, total: Number(count.rows[0].count) }
}

/** Every row matching the filters (no pagination) — used by the CSV export. */
export async function queryAllFiltered(filters: RecordFilters): Promise<ToolingRecord[]> {
  const { where, params } = buildFilters(filters)
  const result = await getPool().query<ToolingRecord>(
    `SELECT * FROM "toolingRecords" ${where} ORDER BY "createdAt" DESC, id DESC`,
    params
  )
  return result.rows
}

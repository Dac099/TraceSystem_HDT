import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import {
  getLatest,
  queryAllFiltered,
  queryRecords,
  type RecordFilters,
  type ToolingRecord
} from './database'
import { Logger } from './logger'
import type { PlcStatusPayload } from './plc-service'

export const PAGE_SIZE = 50
export const LATEST_LIMIT = 100

const CSV_COLUMNS: Array<keyof ToolingRecord> = [
  'id',
  'stationId',
  'modelId',
  'toolingId',
  'matrixReaded',
  'partNumber',
  'machineLine',
  'shift',
  'julianDate',
  'serialNumber',
  'status',
  'finalLeakRate',
  'finalPressure',
  'createdAt'
]

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = value instanceof Date ? formatDateTime(value) : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function twoDigits(n: number): string {
  return n.toString().padStart(2, '0')
}

function formatDateTime(d: Date): string {
  return `${d.getFullYear()}-${twoDigits(d.getMonth() + 1)}-${twoDigits(d.getDate())} ${twoDigits(d.getHours())}:${twoDigits(d.getMinutes())}:${twoDigits(d.getSeconds())}`
}

function toCsv(rows: ToolingRecord[]): string {
  const header = CSV_COLUMNS.join(',')
  const lines = rows.map((row) =>
    CSV_COLUMNS.map((col) => csvEscape(col === 'createdAt' ? new Date(row.createdAt) : row[col])).join(',')
  )
  // BOM so Excel opens the UTF-8 file correctly.
  return '\uFEFF' + [header, ...lines].join('\r\n')
}

export function registerIpcHandlers(
  getWindow: () => BrowserWindow | null,
  getPlcStatuses: () => PlcStatusPayload[]
): void {
  ipcMain.handle('records:get-latest', () => getLatest(LATEST_LIMIT))

  ipcMain.handle('plcs:get-status', () => getPlcStatuses())

  ipcMain.handle('records:query', (_event, filters: RecordFilters, page: number) =>
    queryRecords(filters ?? {}, page, PAGE_SIZE)
  )

  ipcMain.handle('records:export-csv', async (_event, filters: RecordFilters) => {
    const window = getWindow()
    if (!window) return null

    const now = new Date()
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
      title: 'Exportar registros a CSV',
      defaultPath: `toolingRecords-${formatDateTime(now).replace(/[-: ]/g, '')}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (canceled || !filePath) return null

    // No filters -> exports the whole table; otherwise every row matching the filters.
    const rows = await queryAllFiltered(filters ?? {})
    await writeFile(filePath, toCsv(rows), 'utf-8')
    Logger.get().info(`CSV exported: ${filePath} (${rows.length} rows)`)
    return filePath
  })
}

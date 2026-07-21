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
  createdAt: string
  status: boolean | null
  finalLeakRate: number | null
  finalPressure: number | null
}

export interface RecordFilters {
  stationId?: string
  modelId?: string
  toolingId?: string
  matrixReaded?: string
  startDate?: string
  endDate?: string
}

export interface PagedResult {
  rows: ToolingRecord[]
  total: number
}

export interface AlarmPayload {
  message: string
  ts: number
}

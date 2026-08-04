/// <reference types="vite/client" />

import type { AlarmPayload, PagedResult, PlcStatus, RecordFilters, ToolingRecord } from './types'

declare global {
  interface Window {
    traceability: {
      records: {
        getLatest: () => Promise<ToolingRecord[]>
        query: (filters: RecordFilters, page: number) => Promise<PagedResult>
        exportCsv: (filters: RecordFilters) => Promise<string | null>
      }
      plcs: {
        getStatus: () => Promise<PlcStatus[]>
      }
      onAlarm: (callback: (payload: AlarmPayload) => void) => () => void
      onRecordSaved: (callback: (payload: ToolingRecord) => void) => () => void
      onPlcStatus: (callback: (payload: PlcStatus) => void) => () => void
    }
  }
}

export {}

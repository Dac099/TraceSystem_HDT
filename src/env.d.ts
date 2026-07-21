/// <reference types="vite/client" />

import type { AlarmPayload, PagedResult, RecordFilters, ToolingRecord } from './types'

declare global {
  interface Window {
    traceability: {
      records: {
        getLatest: () => Promise<ToolingRecord[]>
        query: (filters: RecordFilters, page: number) => Promise<PagedResult>
        exportCsv: (filters: RecordFilters) => Promise<string | null>
      }
      onAlarm: (callback: (payload: AlarmPayload) => void) => () => void
      onRecordSaved: (callback: (payload: ToolingRecord) => void) => () => void
    }
  }
}

export {}

import { contextBridge, ipcRenderer } from 'electron'

export interface AlarmPayload {
  message: string
  ts: number
}

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('traceability', {
  records: {
    getLatest: () => ipcRenderer.invoke('records:get-latest'),
    query: (filters: unknown, page: number) => ipcRenderer.invoke('records:query', filters, page),
    exportCsv: (filters: unknown) => ipcRenderer.invoke('records:export-csv', filters)
  },
  onAlarm: (callback: (payload: AlarmPayload) => void) => subscribe('alarm', callback),
  onRecordSaved: (callback: (payload: unknown) => void) => subscribe('record:saved', callback)
})

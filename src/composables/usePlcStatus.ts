import { ref } from 'vue'
import type { PlcStatus } from '../types'

const plcStatuses = ref<PlcStatus[]>([])
let loaded = false
let subscribed = false

/** Shared PLC connection status fed by the Electron main process. */
export function usePlcStatus() {
  async function load(): Promise<void> {
    try {
      plcStatuses.value = await window.traceability.plcs.getStatus()
    } catch {
      plcStatuses.value = []
    }
  }

  if (!loaded) {
    loaded = true
    void load()
  }

  if (!subscribed) {
    subscribed = true
    window.traceability.onPlcStatus((payload) => {
      const index = plcStatuses.value.findIndex((plc) => plc.ip === payload.ip)
      if (index === -1) plcStatuses.value.push(payload)
      else plcStatuses.value[index] = payload
    })
  }

  return { plcStatuses, load }
}

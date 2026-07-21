import { ref } from 'vue'

export interface Alarm {
  id: number
  message: string
}

const ALARM_TIMEOUT_MS = 3000

const alarms = ref<Alarm[]>([])
let nextId = 0
let subscribed = false

/** Shared alarm queue fed by the Electron main process; each entry lives 3 s. */
export function useAlarms() {
  function push(message: string): void {
    const id = nextId++
    alarms.value.push({ id, message })
    setTimeout(() => dismiss(id), ALARM_TIMEOUT_MS)
  }

  function dismiss(id: number): void {
    alarms.value = alarms.value.filter((alarm) => alarm.id !== id)
  }

  if (!subscribed) {
    subscribed = true
    window.traceability.onAlarm((payload) => push(payload.message))
  }

  return { alarms, push, dismiss }
}

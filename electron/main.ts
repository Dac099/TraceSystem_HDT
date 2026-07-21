import { app, BrowserWindow } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConfigService } from './config'
import { Logger } from './logger'
import { closeDatabase, initDatabase } from './database'
import { PlcService } from './plc-service'
import { TcpInterface, type PlateScanPayload, type ToolingScanPayload } from './tcp-interface'
import { createStationProcesses, type StationProcess } from './station-process'
import { registerIpcHandlers } from './ipc'

// The main process is bundled as ESM ("type": "module" in package.json),
// where __dirname is not defined — derive it from import.meta.url.
const __dirname = dirname(fileURLToPath(import.meta.url))

let window: BrowserWindow | null = null
let plcs: PlcService[] = []
let stations: Map<string, StationProcess> = new Map()
let tcpInterface: TcpInterface | null = null
let databaseReady = false

/** Pushes an event to the renderer (alarms, new records, PLC status). */
function broadcast(channel: string, payload: unknown): void {
  window?.webContents.send(channel, payload)
}

function broadcastAlarm(message: string): void {
  broadcast('alarm', { message, ts: Date.now() })
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  window.webContents.on('did-finish-load', () => {
    if (!databaseReady) broadcastAlarm('Base de datos no disponible')
  })

  if (process.env.VITE_DEV_SERVER_URL) window.loadURL(process.env.VITE_DEV_SERVER_URL)
  else window.loadFile(join(__dirname, '../dist/index.html'))
}

/** Boots every subsystem: config, logger, database, PLCs, stations and the TCP interface. */
async function bootstrap(): Promise<void> {
  ConfigService.load()
  const logger = Logger.init()
  logger.info('Application starting')

  try {
    await initDatabase()
    databaseReady = true
  } catch (err) {
    // The app stays alive: station processes will surface DB errors as alarms.
    logger.error('Database init failed', err)
  }

  // One PlcService per PLC; each handles connection, subscriptions and heartbeat.
  plcs = ConfigService.get().plcs.map((plcConfig) => {
    const plc = new PlcService(plcConfig)
    plc.on('plcDisconnected', (ip: string) => {
      logger.error(`PLC ${ip} not reachable`)
      broadcastAlarm('PLC no conectado')
    })
    void plc.start()
    return plc
  })

  // One independent process per station (8 total), wired to its PLC events.
  stations = createStationProcesses(plcs)
  for (const station of stations.values()) {
    station.on('warning', (message: string) => broadcastAlarm(message))
    station.on('recordSaved', (record: unknown) => broadcast('record:saved', record))
  }

  // TCP interface for the barcode scanners; the main process subscribes to its events.
  tcpInterface = new TcpInterface()
  tcpInterface.on('ToolingScan', (payload: ToolingScanPayload) => {
    const station = stations.get(payload.stationId)
    if (station) void station.onToolingScan(payload)
    else logger.warn(`ToolingScan for unknown station ${payload.stationId}`)
  })
  tcpInterface.on('PlateScan', (payload: PlateScanPayload) => {
    const station = stations.get(payload.stationId)
    if (station) void station.onPlateScan(payload)
    else logger.warn(`PlateScan for unknown station ${payload.stationId}`)
  })
  tcpInterface.start()
}

async function shutdown(): Promise<void> {
  Logger.get().info('Application shutting down')
  await tcpInterface?.stop()
  await Promise.all(plcs.map((plc) => plc.stop()))
  await closeDatabase()
}

app.whenReady().then(async () => {
  await bootstrap()
  registerIpcHandlers(() => window)
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})

let quitting = false
app.on('before-quit', (event) => {
  if (quitting) return
  quitting = true
  event.preventDefault()
  void shutdown().finally(() => app.exit(0))
})

app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())

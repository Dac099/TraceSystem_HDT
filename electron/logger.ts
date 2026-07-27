import { appendFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { Logger as EipLogger } from 'ethernet-ip'
import { ConfigService } from './config'

type Level = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

const LOG_FILE_PATTERN = /^app-(\d{4}-\d{2}-\d{2})\.log$/
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

function twoDigits(n: number): string {
  return n.toString().padStart(2, '0')
}

function dateStamp(d: Date): string {
  return `${d.getFullYear()}-${twoDigits(d.getMonth() + 1)}-${twoDigits(d.getDate())}`
}

function timestamp(d: Date): string {
  return `${dateStamp(d)} ${twoDigits(d.getHours())}:${twoDigits(d.getMinutes())}:${twoDigits(d.getSeconds())}.${d.getMilliseconds().toString().padStart(3, '0')}`
}

/**
 * File logger. Writes one file per day inside <appDir>/<logs.dir> using the
 * format `datetime => level => message`. Files older than logs.retentionDays
 * are deleted on startup and then once per hour. In development mode every
 * entry is also written to stdout.
 */
export class Logger implements EipLogger {
  private static instance: Logger | null = null

  private readonly logsDir: string
  private readonly retentionDays: number
  private readonly devMode: boolean
  private cleanupTimer: NodeJS.Timeout | null = null

  private constructor() {
    const { logs } = ConfigService.get()
    this.logsDir = join(app.getPath('userData'), logs.dir)
    this.retentionDays = logs.retentionDays
    this.devMode = !app.isPackaged
    if (!existsSync(this.logsDir)) mkdirSync(this.logsDir, { recursive: true })
  }

  static init(): Logger {
    if (!this.instance) {
      this.instance = new Logger()
      this.instance.cleanupOldFiles()
      this.instance.cleanupTimer = setInterval(() => this.instance?.cleanupOldFiles(), CLEANUP_INTERVAL_MS)
      this.instance.cleanupTimer.unref()
    }
    return this.instance
  }

  static get(): Logger {
    if (!this.instance) throw new Error('Logger not initialized. Call Logger.init() first.')
    return this.instance
  }

  /** Adapter exposing the ethernet-ip Logger interface (ctx serialized inline). */
  static eipAdapter(): EipLogger {
    const logger = this.get()
    const wrap =
      (fn: (msg: string) => void) =>
      (msg: string, ctx?: Record<string, unknown>): void =>
        fn(ctx ? `${msg} ${JSON.stringify(ctx)}` : msg)
    // debug is a no-op: ethernet-ip logs every CIP request/response at debug
    // level, which floods the log file on each 200ms scan cycle.
    return { debug: () => {}, info: wrap(logger.info), warn: wrap(logger.warn), error: wrap(logger.error) }
  }

  private filePathFor(d: Date): string {
    return join(this.logsDir, `app-${dateStamp(d)}.log`)
  }

  private write(level: Level, message: string): void {
    const line = `${timestamp(new Date())} => ${level} => ${message}`
    try {
      appendFileSync(this.filePathFor(new Date()), `${line}\n`, 'utf-8')
    } catch (err) {
      // Never let logging crash the app.
      console.error('Logger write failed:', err)
    }
    if (this.devMode) console.log(line)
  }

  private cleanupOldFiles(): void {
    const cutoff = new Date()
    cutoff.setHours(0, 0, 0, 0)
    cutoff.setDate(cutoff.getDate() - (this.retentionDays - 1))
    try {
      for (const file of readdirSync(this.logsDir)) {
        const match = LOG_FILE_PATTERN.exec(file)
        if (!match) continue
        if (new Date(`${match[1]}T00:00:00`) < cutoff) unlinkSync(join(this.logsDir, file))
      }
    } catch (err) {
      console.error('Logger cleanup failed:', err)
    }
  }

  debug = (msg: string): void => this.write('DEBUG', msg)
  info = (msg: string): void => this.write('INFO', msg)
  warn = (msg: string): void => this.write('WARN', msg)
  error = (msg: string, err?: unknown): void =>
    this.write('ERROR', err instanceof Error ? `${msg} | ${err.message}` : err ? `${msg} | ${String(err)}` : msg)
}

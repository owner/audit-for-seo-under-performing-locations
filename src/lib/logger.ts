import { AsyncLocalStorage } from 'node:async_hooks'

export interface LogContext {
  requestId?: string
  userId?: string
  [key: string]: unknown
}

const contextStore = new AsyncLocalStorage<LogContext>()

export function getLogContext(): LogContext | undefined {
  return contextStore.getStore()
}

export function runWithLogContext<T>(ctx: LogContext, fn: () => T): T {
  const parent = contextStore.getStore()
  const merged = parent ? { ...parent, ...ctx } : ctx
  return contextStore.run(merged, fn)
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface Logger {
  debug: (msg: string, fields?: Record<string, unknown>) => void
  info: (msg: string, fields?: Record<string, unknown>) => void
  warn: (msg: string, fields?: Record<string, unknown>) => void
  error: (msg: string, fields?: Record<string, unknown>) => void
  child: (bindings: Record<string, unknown>) => Logger
}

function createLoggerImpl(source: string, bindings: Record<string, unknown>): Logger {
  function emit(level: LogLevel, event: string, fields?: Record<string, unknown>) {
    const alsContext = contextStore.getStore()
    const entry: Record<string, unknown> = {
      level,
      source,
      event,
      data: {
        ...alsContext,
        ...bindings,
        ...fields,
      },
    }
    if (level === 'error') console.error(JSON.stringify(entry))
    else if (level === 'warn') console.warn(JSON.stringify(entry))
    else console.log(JSON.stringify(entry))
  }

  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    child: (extra) => createLoggerImpl(source, { ...bindings, ...extra }),
  }
}

export function createLogger(source: string): Logger {
  return createLoggerImpl(source, {})
}

export const logger = createLogger('app')

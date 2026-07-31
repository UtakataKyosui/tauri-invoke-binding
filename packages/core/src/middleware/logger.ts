import { classifyForMiddleware } from '../internal/classify-for-middleware.js'
import type { Invoker, Middleware } from './pipeline.js'

export interface LogEntry {
  command: string
  /** `ctx.args`, after masking has been applied. */
  args: unknown
  status: 'ok' | 'error'
  /** The failure's `TransportError`/`'command'` kind — only present when
   * `status` is `'error'`. */
  kind?: string
  /** Wall-clock duration of the call, in milliseconds. */
  ms: number
}

export interface LoggerOptions {
  /** Whether the middleware logs at all. Defaults to `false` in a production
   * build (`process.env.NODE_ENV === 'production'`) and `true` otherwise —
   * issue #17's "本番ビルドでは既定で無効にする。引数に個人情報や認証情報が
   * 含まれうるため". Set explicitly to override either way. */
  enabled?: boolean
  /** Where entries go. Defaults to `console.log`/`console.error` depending on
   * `status`. */
  sink?: (entry: LogEntry) => void
  /** Redact sensitive argument values before they reach `sink`. An array of
   * key names masks those keys (recursively, at any depth) with `'***'`; a
   * function receives the command name and raw args and returns whatever
   * should be logged instead. */
  mask?: readonly string[] | ((command: string, args: unknown) => unknown)
  /** A separate hook for duration measurements, so they can be piped to a
   * metrics backend independently of `sink`'s human-readable log line
   * (issue #17's "所要時間の計測フックを別途公開し、任意の計測基盤に流せる
   * ようにする"). */
  onDuration?: (entry: { command: string; ms: number; status: 'ok' | 'error' }) => void
}

function isProductionByDefault(): boolean {
  return (
    typeof process !== 'undefined' &&
    typeof process.env === 'object' &&
    process.env !== null &&
    // biome-ignore lint/complexity/useLiteralKeys: bracket notation is required here by noPropertyAccessFromIndexSignature
    process.env['NODE_ENV'] === 'production'
  )
}

function maskDeep(value: unknown, keys: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => maskDeep(item, keys))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      out[key] = keys.has(key) ? '***' : maskDeep(item, keys)
    }
    return out
  }
  return value
}

function defaultSink(entry: LogEntry): void {
  const line = `[tauri-invoke-binding] ${entry.command} ${entry.status} ${entry.ms.toFixed(1)}ms`
  if (entry.status === 'error') {
    console.error(line, { args: entry.args, kind: entry.kind })
  } else {
    console.log(line, { args: entry.args })
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

/**
 * Logs each call's command name, (masked) args, duration, and outcome
 * (issue #17). Disabled by default in production builds — see
 * `LoggerOptions.enabled` — since args can carry personal or credential
 * data that shouldn't reach a production log sink.
 *
 * This module has no side effects at import time and is only referenced if
 * a consumer actually calls `logger(...)`, so an app that never imports it
 * doesn't pay for it in its bundle (issue #17's tree-shaking completion
 * condition) — standard ESM dead-code elimination, nothing bespoke needed
 * here.
 */
export function logger(options: LoggerOptions = {}): Middleware {
  const enabled = options.enabled ?? !isProductionByDefault()
  if (!enabled) return (next: Invoker): Invoker => next

  const sink = options.sink ?? defaultSink
  const maskKeys = Array.isArray(options.mask) ? new Set(options.mask) : undefined
  const maskFn =
    typeof options.mask === 'function'
      ? options.mask
      : (_command: string, args: unknown) => (maskKeys ? maskDeep(args, maskKeys) : args)

  return (next: Invoker): Invoker => {
    return async (ctx) => {
      const start = now()
      try {
        const result = await next(ctx)
        const ms = now() - start
        sink({ command: ctx.command, args: maskFn(ctx.command, ctx.args), status: 'ok', ms })
        options.onDuration?.({ command: ctx.command, ms, status: 'ok' })
        return result
      } catch (reason) {
        const ms = now() - start
        const kind = classifyForMiddleware(reason, ctx.command).kind
        sink({
          command: ctx.command,
          args: maskFn(ctx.command, ctx.args),
          status: 'error',
          ms,
          kind,
        })
        options.onDuration?.({ command: ctx.command, ms, status: 'error' })
        throw reason
      }
    }
  }
}

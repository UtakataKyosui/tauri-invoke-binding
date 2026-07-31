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
   * 含まれうるため". Set explicitly to override either way.
   *
   * **Pass this explicitly in a frontend bundle.** The auto-detection reads
   * `process.env.NODE_ENV`, which is a Node concept: in a Tauri webview it
   * exists only if the bundler substituted it at build time. If it did not,
   * detection cannot see a production build and the default falls to
   * *enabled* — the unsafe direction, since args may carry personal or
   * credential data. `enabled: import.meta.env.DEV` (Vite) or an equivalent
   * build-time constant removes the guesswork, and lets the bundler drop this
   * middleware from the production bundle entirely. */
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

  /**
   * Observability must never change what it observes. A `sink`, `mask`, or
   * `onDuration` supplied by the caller is arbitrary user code that can throw
   * — and if it did, a successful call would start rejecting, and a failing
   * one would report the sink's error instead of the real transport failure.
   * Every callback is therefore isolated: a throw here is swallowed rather
   * than allowed to reach the call site.
   */
  function report(entry: LogEntry): void {
    try {
      sink(entry)
    } catch {
      // A broken log sink is not the call's problem.
    }
    try {
      options.onDuration?.({ command: entry.command, ms: entry.ms, status: entry.status })
    } catch {
      // Likewise for a broken metrics hook.
    }
  }

  function maskArgs(command: string, args: unknown): unknown {
    try {
      return maskFn(command, args)
    } catch {
      // A mask function that throws must not leak the unmasked args as a
      // fallback — that is exactly what it was installed to prevent.
      return '<masking failed>'
    }
  }

  return (next: Invoker): Invoker => {
    return async (ctx) => {
      const start = now()
      try {
        const result = await next(ctx)
        const ms = now() - start
        report({ command: ctx.command, args: maskArgs(ctx.command, ctx.args), status: 'ok', ms })
        return result
      } catch (reason) {
        const ms = now() - start
        const kind = classifyForMiddleware(reason, ctx.command).kind
        report({
          command: ctx.command,
          args: maskArgs(ctx.command, ctx.args),
          status: 'error',
          ms,
          kind,
        })
        throw reason
      }
    }
  }
}

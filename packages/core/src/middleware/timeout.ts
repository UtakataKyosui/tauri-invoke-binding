import { TimeoutError } from '../internal/errors.js'
import type { Invoker, Middleware } from './pipeline.js'

/**
 * Fails a call after `defaultMs` milliseconds instead of waiting forever
 * (issue #14) — the plain `@tauri-apps/api` `invoke` has no timeout, and a
 * Rust-side deadlock or long-running block otherwise hangs the caller
 * indefinitely.
 *
 * **Important**: this only makes the TS side stop waiting. It cannot cancel
 * the in-flight Tauri IPC call — the Rust command handler keeps running to
 * completion regardless. If it eventually resolves, that result is silently
 * discarded here rather than acted on (see the completion condition on issue
 * #14: "タイムアウト後に遅れて解決した結果が漏れて処理されないこと").
 *
 * On timeout the call rejects with a `TimeoutError`, which the `.safe` call
 * site surfaces as `{ kind: 'timeout', command, ms }` — a `TransportError`
 * variant, so it appears in the same exhaustive `switch` as every other
 * failure (see `assertExhaustive`).
 *
 * Per-call/per-command override: pass `{ timeoutMs }` in `CallOptions` (a
 * call-site value, or a `commandOptions` entry in `createClient`) to use a
 * different deadline than `defaultMs` for that command, or `0`/`Infinity` to
 * disable the timeout entirely for it.
 */
export function timeout(defaultMs: number): Middleware {
  return (next: Invoker): Invoker => {
    return (ctx) => {
      const ms = ctx.callOptions.timeoutMs ?? defaultMs
      if (!Number.isFinite(ms) || ms <= 0) return next(ctx)

      return new Promise((resolve, reject) => {
        let settled = false

        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          reject(new TimeoutError(ctx.command, ms))
        }, ms)

        next(ctx).then(
          (value) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolve(value)
          },
          (reason) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            reject(reason)
          },
        )
      })
    }
  }
}

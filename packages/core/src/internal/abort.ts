/**
 * Shared `AbortSignal` plumbing (issue #16) used by the base invoker
 * (call.ts), the `timeout` middleware, and the `retry` middleware's backoff
 * wait. Kept in one place so "already-aborted signals abort immediately" and
 * "a late settlement after abort is discarded, never surfaced" are true
 * everywhere a signal is consulted, not just at the outermost call.
 */
import { AbortError } from './errors.js'

export function throwIfAborted(signal: AbortSignal | undefined, command: string): void {
  if (signal?.aborted) throw new AbortError(command)
}

/**
 * Resolves after `ms`, or rejects immediately with `AbortError` if `signal`
 * fires (or has already fired) first. Used by the `retry` middleware so an
 * abort during the backoff wait interrupts immediately (issue #16's "リトライ
 * の待機中に abort すると即座に中断される") instead of waiting out the delay.
 */
export function delay(ms: number, signal: AbortSignal | undefined, command: string): Promise<void> {
  throwIfAborted(signal, command)
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(new AbortError(command))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Races `promise` against `signal`. Tauri IPC itself cannot be cancelled, so
 * when `signal` fires first this only stops the TS side from waiting: the
 * loser is left to settle on its own, and once it does its value (or
 * rejection) is silently discarded rather than surfaced — see the doc
 * comments on `TimeoutError`/`AbortError` in errors.ts for the same
 * constraint applied to `timeout`.
 */
export function raceAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  command: string,
): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) {
    promise.catch(() => {})
    return Promise.reject(new AbortError(command))
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false
    const onAbort = () => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      reject(new AbortError(command))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (reason) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        reject(reason)
      },
    )
  })
}

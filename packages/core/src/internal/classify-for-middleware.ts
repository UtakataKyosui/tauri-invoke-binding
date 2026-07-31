import { classifyRejection } from '../classify.js'
import type { SafeError } from '../transport-error.js'
import { AbortError, NotInTauriError, TimeoutError } from './errors.js'

/**
 * The single place that turns *any* rejection reaching the top of a call's
 * middleware pipeline into a `SafeError` — reused by `callCommandSafe`
 * (call.ts), the `retry` middleware's retry-or-not decision, and the
 * `logger` middleware's error reporting, so all three agree on what a given
 * rejection means. `NotInTauriError`/`TimeoutError`/`AbortError` are
 * recognized structurally (`instanceof`), same rationale as the original
 * `callCommandSafe` check this replaces: they are raised by this package
 * itself, not guessed from a message string, so they must be checked before
 * the generic `Error`/`string` heuristics in `classifyRejection` get a
 * chance to misclassify them as `unknown`.
 */
export function classifyForMiddleware<Err>(reason: unknown, command: string): SafeError<Err> {
  if (reason instanceof NotInTauriError) return { kind: 'not-in-tauri' }
  if (reason instanceof TimeoutError)
    return { kind: 'timeout', command: reason.command, ms: reason.ms }
  if (reason instanceof AbortError) return { kind: 'aborted' }
  if (reason instanceof Error || typeof reason === 'string') {
    return classifyRejection(reason, { command })
  }
  return { kind: 'command', value: reason as Err }
}

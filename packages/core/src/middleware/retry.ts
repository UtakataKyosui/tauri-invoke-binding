import { delay } from '../internal/abort.js'
import { classifyForMiddleware } from '../internal/classify-for-middleware.js'
import { AbortError } from '../internal/errors.js'
import type { SafeError } from '../transport-error.js'
import type { Invoker, Middleware, RetryOverride } from './pipeline.js'

export interface RetryOptions extends RetryOverride {
  /** Maximum number of retries (not counting the initial attempt). Required
   * here — this is the client-wide default; `RetryOverride.times` (used for
   * the per-call/per-command `CallOptions.retry` override) is optional. */
  times: number
}

/**
 * The default retry policy (issue #15's completion condition: "kind ごとの
 * リトライ可否がテストで固定されている"):
 *
 * - Retried: `unknown` — the one kind that could plausibly be a transient
 *   webview/transport hiccup rather than a structural failure.
 * - Never retried:
 *   - `command-not-found`, `deserialization`, `permission-denied` — retrying
 *     these just repeats the same failure forever; nothing about a retry
 *     changes whether the command exists, the args deserialize, or the
 *     capability is granted.
 *   - `aborted` — the caller asked to stop; retrying would ignore that.
 *   - `timeout` — the underlying call may still be running on the Rust side
 *     (see the `timeout` middleware's doc comment); firing another one on
 *     top by default risks running a side-effecting command twice.
 *   - `not-in-tauri` — an environment/structural mismatch, not transient.
 *   - `command` (the Rust command's own declared `Err(E)`) — this package
 *     cannot know whether a given `Err(E)` represents a retryable condition
 *     for a given app, so it does not guess; pass `shouldRetry` to opt in.
 */
const DEFAULT_RETRYABLE_KINDS: ReadonlySet<string> = new Set(['unknown'])

function defaultShouldRetry(classified: SafeError<unknown>): boolean {
  return DEFAULT_RETRYABLE_KINDS.has(classified.kind)
}

/** Exponential backoff with jitter: `200ms * 2^attempt`, plus up to 20%
 * random jitter (so many callers retrying at once don't all land on the same
 * tick). `attempt` is 0 on the first retry. */
function defaultBackoff(attempt: number): number {
  const base = 200 * 2 ** attempt
  return base + Math.random() * base * 0.2
}

/**
 * Retries a failed call according to `defaults`, unless the call's
 * `CallOptions.retry` says otherwise (issue #15's "呼び出し側で判定を上書き
 * できるようにする").
 *
 * **This can be dangerous for side-effecting commands.** Retrying a command
 * that isn't idempotent (e.g. one that appends a row, sends a message, moves
 * a file) on a failure whose outcome is actually ambiguous — did the first
 * attempt's Rust-side work complete before the rejection reached TS? — can
 * run it twice. The default retryable set (`unknown` only) is deliberately
 * narrow for this reason; widen it (via `shouldRetry`) only for commands
 * you've confirmed are safe to repeat.
 *
 * The wait between attempts observes `ctx.signal`: aborting during the
 * backoff delay interrupts immediately instead of waiting it out (issue
 * #16), and an abort is never itself retried.
 */
export function retry(defaults: RetryOptions): Middleware {
  return (next: Invoker): Invoker => {
    return async (ctx) => {
      const override = ctx.callOptions.retry
      if (override === false) return next(ctx)

      const times = override?.times ?? defaults.times
      const backoff = override?.backoff ?? defaults.backoff ?? defaultBackoff
      const shouldRetry = override?.shouldRetry ?? defaults.shouldRetry ?? defaultShouldRetry

      let attempt = 0
      for (;;) {
        try {
          return await next(ctx)
        } catch (reason) {
          if (reason instanceof AbortError) throw reason

          const classified = classifyForMiddleware(reason, ctx.command)
          if (attempt >= times || !shouldRetry(classified, attempt)) throw reason

          await delay(backoff(attempt), ctx.signal, ctx.command)
          attempt += 1
        }
      }
    }
  }
}

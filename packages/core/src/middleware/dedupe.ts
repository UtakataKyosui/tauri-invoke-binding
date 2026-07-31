import { raceAbort } from '../internal/abort.js'
import { stableKey } from '../internal/stable-key.js'
import type { Invoker, Middleware } from './pipeline.js'

export interface DedupeOptions {
  /** Derives the in-flight key from the command name and its args. Defaults
   * to `` `${command}:${stableKey(args)}` `` — a JSON serialization with
   * object keys sorted recursively, so argument key order never affects
   * whether two calls are considered the same (issue #18's completion
   * condition). Array order is preserved (position is meaningful there). */
  keyFn?: (command: string, args: unknown) => string
}

function defaultKeyFn(command: string, args: unknown): string {
  return `${command}:${stableKey(args)}`
}

/**
 * Merges concurrent calls to the same command with the same args into a
 * single in-flight `invoke` (issue #18) — if three components all request
 * the same data at once, only one IPC round trip happens; all three get the
 * same settled promise.
 *
 * **Opt-in per call, off by default.** Merging calls to a side-effecting
 * command is dangerous: a caller who fired three intentionally-separate
 * writes would only get one performed. Pass `{ dedupe: true }` in
 * `CallOptions` — at the call site, or as a `commandOptions` default for a
 * specific command in `createClient` — for the commands where sharing an
 * in-flight call is actually safe (typically idempotent reads).
 *
 * This is in-flight de-duplication only, not a result cache: as soon as a
 * call settles it's removed from the map, so the next call — even with
 * identical args — always triggers a fresh `invoke`.
 *
 * **Cancellation is per caller, not per shared call.** Merged callers each
 * bring their own `AbortSignal`, so the shared call cannot be tied to any one
 * of them: it runs with no signal at all, and every caller instead races its
 * own signal against the shared result. One caller aborting therefore rejects
 * only that caller — the others keep waiting and still receive the real
 * result. (Naively passing the first caller's `ctx` straight through would
 * have let whoever happened to arrive first cancel everyone else's call, and
 * would have silently ignored every later caller's signal entirely.)
 *
 * The corollary is that an abort never stops the underlying `invoke` — the
 * same constraint that applies everywhere else in this package, and doubly so
 * here, since other callers may still be waiting on it.
 *
 * Note that the key covers only the command and its args: two callers that
 * merge may have passed *different* `CallOptions` (a different `timeoutMs`,
 * say), and the shared call runs with whichever caller's options started it.
 * Only `signal` is isolated per caller.
 */
export function dedupe(options: DedupeOptions = {}): Middleware {
  const keyFn = options.keyFn ?? defaultKeyFn
  const inFlight = new Map<string, Promise<unknown>>()

  return (next: Invoker): Invoker => {
    return (ctx) => {
      if (!ctx.callOptions.dedupe) return next(ctx)

      const key = keyFn(ctx.command, ctx.args)
      let shared = inFlight.get(key)

      if (!shared) {
        const { signal: _ignoredCallOptionsSignal, ...callOptions } = ctx.callOptions
        shared = next({ ...ctx, signal: undefined, callOptions }).finally(() => {
          inFlight.delete(key)
        })
        inFlight.set(key, shared)
      }

      return raceAbort(shared, ctx.signal, ctx.command)
    }
  }
}

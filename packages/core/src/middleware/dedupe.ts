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
 */
export function dedupe(options: DedupeOptions = {}): Middleware {
  const keyFn = options.keyFn ?? defaultKeyFn
  const inFlight = new Map<string, Promise<unknown>>()

  return (next: Invoker): Invoker => {
    return (ctx) => {
      if (!ctx.callOptions.dedupe) return next(ctx)

      const key = keyFn(ctx.command, ctx.args)
      const existing = inFlight.get(key)
      if (existing) return existing

      const call = next(ctx).finally(() => {
        inFlight.delete(key)
      })
      inFlight.set(key, call)
      return call
    }
  }
}

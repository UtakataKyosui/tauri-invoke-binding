import type { SafeError } from '../transport-error.js'

/**
 * A caller-supplied override for the `retry` middleware's decision on a
 * specific call (issue #15's "呼び出し側で判定を上書きできるようにする").
 * Declared here (rather than in retry.ts) so `CallOptions` doesn't need to
 * import the middleware module that consumes it — only `retry.ts` depends on
 * this file, never the other way around.
 */
export interface RetryOverride {
  /** Maximum number of retries (not counting the initial attempt). */
  times?: number
  /** `attempt` is 0 on the first retry. Return a delay in milliseconds. */
  backoff?: (attempt: number) => number
  /** Decide whether `classified` is worth retrying. Called only when the
   * built-in attempt budget hasn't been exhausted yet. */
  shouldRetry?: (classified: SafeError<unknown>, attempt: number) => boolean
}

/**
 * Per-call options every generated invoker accepts alongside its command
 * arguments (issue #13/#16). Also doubles as the per-command default shape
 * passed to `createClient({ commandOptions })` — a command's own entry there
 * is shallow-merged under whatever the caller passes at the call site, the
 * call site winning (see client.ts).
 */
export interface CallOptions {
  /** Abort the wait for this call. Tauri's IPC itself cannot be cancelled —
   * this only stops the TS side from waiting on (and acting on) the result;
   * the Rust-side handler keeps running to completion. An already-aborted
   * signal aborts immediately, without ever calling `invoke`. */
  signal?: AbortSignal
  /** Per-call/per-command override for the `timeout` middleware, if one is
   * installed. Ignored otherwise. */
  timeoutMs?: number
  /** Per-call/per-command override for the `retry` middleware, if one is
   * installed. `false` disables retrying for this call entirely. Ignored
   * otherwise. */
  retry?: RetryOverride | false
  /** Per-call/per-command opt-in for the `dedupe` middleware, if one is
   * installed. Ignored otherwise — dedupe is opt-in precisely because
   * merging calls to a side-effecting command is dangerous by default. */
  dedupe?: boolean
}

/** What every middleware and the transport-specific base invoker (the tail
 * of the chain — see `baseInvoker` in call.ts and the specta adapter) see. */
export interface InvokeContext {
  /** The wire command name (already snake_case / whatever the transport
   * uses), never the camelCase accessor the caller typed. */
  readonly command: string
  /** Whatever the transport passes as the command's own payload — a plain
   * args object for the hand-written DSL, a positional argument list for the
   * `tauri-specta` adapter. Deliberately untyped here: middleware treats it
   * as opaque data (for logging, keying, ...), never calls into it. */
  readonly args: unknown
  readonly signal?: AbortSignal | undefined
  readonly callOptions: CallOptions
}

export type Invoker = (ctx: InvokeContext) => Promise<unknown>

/** `(next: Invoker) => Invoker` — wrap the next invoker in the chain,
 * returning a new one. See composeMiddleware for composition order. */
export type Middleware = (next: Invoker) => Invoker

/**
 * Composes a list of middleware around a base invoker (the tail of the
 * chain, which actually performs the call). `middleware[0]` is outermost:
 * given `[A, B, C]`, the composed invoker is `A(B(C(base)))`.
 *
 * This determines execution order (documented as the issue #13 completion
 * condition):
 *  - "before" code (anything before a middleware calls `next`) runs
 *    front-to-back: A, then B, then C.
 *  - "after" code (anything after `await next(ctx)` resolves) runs
 *    back-to-front: C, then B, then A — the classic onion/middleware model.
 *
 * ```ts
 * const pipeline = composeMiddleware([timeout(5_000), retry({ times: 3 }), logger()])(baseInvoker)
 * ```
 */
export function composeMiddleware(middleware: readonly Middleware[]): (base: Invoker) => Invoker {
  return (base) => middleware.reduceRight((next, mw) => mw(next), base)
}

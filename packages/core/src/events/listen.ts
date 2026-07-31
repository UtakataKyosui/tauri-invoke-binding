/**
 * `AbortSignal`-based unlisten, plus a scope for unlistening several
 * listeners at once (issue #20).
 *
 * `@tauri-apps/api/event`'s own `listen`/`once` return `Promise<UnlistenFn>`
 * — the caller must `await` registration, then remember to call the
 * returned function later. That is awkward from a React `useEffect`, whose
 * cleanup function must be synchronous: there is nothing to `return`
 * directly from the effect body. Passing a `signal` instead lets the effect
 * register the listener fire-and-forget and clean up with
 * `() => controller.abort()`, exactly like `addEventListener`.
 */
import type { EventCallback, EventName, Options, UnlistenFn } from '@tauri-apps/api/event'
import { rawListen, rawOnce } from '../internal/tauri-events.js'

export interface ListenOptions extends Options {
  /** Unlisten when this signal fires. An already-aborted signal is honored
   * immediately: the listener is never registered with Tauri at all. */
  signal?: AbortSignal
}

const noopUnlisten: UnlistenFn = () => undefined

type Register<T> = (
  event: EventName,
  handler: EventCallback<T>,
  options?: Options,
) => Promise<UnlistenFn>

/**
 * Shared implementation behind `listen`/`once` below. Handles three cases:
 *
 * 1. `signal` already aborted — never registers with Tauri at all.
 * 2. `signal` aborts while `register`'s promise is still pending (the race
 *    the issue calls out) — the listener is unregistered the instant
 *    registration resolves, so nothing observable leaks.
 * 3. `signal` aborts after registration — the real `UnlistenFn` runs.
 *
 * `settled` guards against a double-unlisten when both the caller's
 * returned function and the abort listener could otherwise fire: whichever
 * runs first wins, the other is a no-op.
 */
async function listenWithSignal<T>(
  register: Register<T>,
  event: EventName,
  handler: EventCallback<T>,
  options: ListenOptions | undefined,
): Promise<UnlistenFn> {
  const { signal, ...rest } = options ?? {}
  if (signal?.aborted) return noopUnlisten

  let settled = false
  let realUnlisten: UnlistenFn | undefined
  let abortedDuringRegistration = false

  const cleanup = () => {
    if (settled) return
    settled = true
    signal?.removeEventListener('abort', onAbort)
    realUnlisten?.()
  }
  const onAbort = () => {
    abortedDuringRegistration = realUnlisten === undefined
    cleanup()
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  const unlisten = await register(event, handler, rest)
  realUnlisten = unlisten

  if (abortedDuringRegistration) {
    // `cleanup` already ran with `realUnlisten` still undefined (the abort
    // fired before `register` resolved) — finish the job now that the real
    // unlisten function exists, and never hand it to the caller.
    unlisten()
    return noopUnlisten
  }

  return cleanup
}

/** `listen` with `AbortSignal` support (issue #20). Identical to
 * `@tauri-apps/api/event`'s `listen` otherwise.
 *
 * ```ts
 * useEffect(() => {
 *   const ac = new AbortController()
 *   listen('foo', handler, { signal: ac.signal })
 *   return () => ac.abort()
 * }, [])
 * ```
 */
export function listen<T>(
  event: EventName,
  handler: EventCallback<T>,
  options?: ListenOptions,
): Promise<UnlistenFn> {
  return listenWithSignal(rawListen, event, handler, options)
}

/** `once` with `AbortSignal` support (issue #20). Identical to
 * `@tauri-apps/api/event`'s `once` otherwise. */
export function once<T>(
  event: EventName,
  handler: EventCallback<T>,
  options?: ListenOptions,
): Promise<UnlistenFn> {
  return listenWithSignal(rawOnce, event, handler, options)
}

/**
 * A scope that unlistens every listener registered through it with a single
 * `dispose()` call — the "複数リスナをまとめて解除するスコープ API" from
 * issue #20. Built on the same `signal` mechanism as `listen`/`once` above,
 * so it inherits the same abort-during-registration safety.
 *
 * ```ts
 * useEffect(() => {
 *   const scope = createEventScope()
 *   scope.listen('foo', handler)
 *   scope.listen('bar', otherHandler)
 *   return () => scope.dispose()
 * }, [])
 * ```
 */
export interface EventScope {
  /** The signal backing this scope, for composing with other signal-aware APIs. */
  readonly signal: AbortSignal
  listen<T>(event: EventName, handler: EventCallback<T>, options?: Options): void
  once<T>(event: EventName, handler: EventCallback<T>, options?: Options): void
  /** Unlistens every listener registered through this scope. Idempotent. */
  dispose(): void
}

export function createEventScope(): EventScope {
  const controller = new AbortController()
  return {
    signal: controller.signal,
    listen(event, handler, options) {
      void listen(event, handler, { ...options, signal: controller.signal })
    },
    once(event, handler, options) {
      void once(event, handler, { ...options, signal: controller.signal })
    },
    dispose() {
      controller.abort()
    },
  }
}

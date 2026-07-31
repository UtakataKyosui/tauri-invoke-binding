/**
 * A typed event client (issues #19–#21): one factory that gives every event
 * — built-in `TauriEvent`s (`BuiltinEventMap`, issue #21) and app-defined
 * ones alike — a payload-narrowed `listen` / `once` / `emit` / `emitTo`
 * (issue #19), with `AbortSignal` support built in (issue #20, via
 * `ListenOptions` from listen.ts).
 *
 * `tauri-specta`'s generated `events` object (`makeEvent`) is deliberately
 * *not* wrapped here. Its generated shape exposes `listen`/`once`/`emit`
 * only — no stable, documented way to read back the wire event name a given
 * key maps to (see the upstream gap this issue tracks, tauri-specta#187) —
 * so there is nothing safe to call `emitTo` against without depending on
 * that generator's internal Proxy implementation. Instead, `createEventClient`
 * is a hand-written, structural sibling of `createClient` (client.ts): give
 * it an `EventPayloadMap` type (hand-written, or `BuiltinEventMap` merged
 * with your own), same as declaring a `CommandMap` for `createClient`.
 *
 * ```ts
 * type AppEvents = { myDemoEvent: DemoEvent }
 * const events = createEventClient<BuiltinEventMap & AppEvents>()
 *
 * await events.myDemoEvent.emitTo({ kind: 'WebviewWindow', label: 'main' }, payload)
 * await events.on(TauriEvent.WINDOW_RESIZED, (e) => console.log(e.payload))
 * ```
 */
import type { EventCallback, UnlistenFn } from '@tauri-apps/api/event'
import { rawEmit } from '../internal/tauri-events.js'
import { type EventTarget, emitTo } from './emit-to.js'
import { type ListenOptions, listen, once } from './listen.js'

export type EventPayloadMap = Record<string, unknown>

export interface TypedEvent<T> {
  listen(handler: EventCallback<T>, options?: ListenOptions): Promise<UnlistenFn>
  once(handler: EventCallback<T>, options?: ListenOptions): Promise<UnlistenFn>
  emit(payload: T): Promise<void>
  emitTo(target: EventTarget | string, payload: T): Promise<void>
}

/**
 * Reserved top-level members every `EventClient` exposes alongside its
 * per-event accessors — the generic, name-based counterpart to
 * `events.myDemoEvent.listen(...)`. Reserved the same way `Client.safe` and
 * `.then` are reserved in client.ts: an `EventPayloadMap` key that happens
 * to camelCase to one of these names is shadowed by it, and the collision
 * isn't caught by the type system.
 */
export interface EventClientReserved<TEvents extends EventPayloadMap> {
  on<K extends keyof TEvents>(
    event: K,
    handler: EventCallback<TEvents[K]>,
    options?: ListenOptions,
  ): Promise<UnlistenFn>
  once<K extends keyof TEvents>(
    event: K,
    handler: EventCallback<TEvents[K]>,
    options?: ListenOptions,
  ): Promise<UnlistenFn>
  emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): Promise<void>
  emitTo<K extends keyof TEvents>(
    event: K,
    target: EventTarget | string,
    payload: TEvents[K],
  ): Promise<void>
}

export type EventClient<TEvents extends EventPayloadMap> = {
  [K in keyof TEvents]: TypedEvent<TEvents[K]>
} & EventClientReserved<TEvents>

export interface CreateEventClientOptions<TEvents extends EventPayloadMap> {
  /** Maps an `EventPayloadMap` key to the wire event name Rust actually
   * emits, for the (uncommon) case where they differ. Defaults to the key
   * itself — which is exact for every `BuiltinEventMap` key (they're already
   * `TauriEvent`'s own wire-name string values) and for the common
   * hand-written case of naming your map key after the Rust event string. */
  names?: Partial<Record<keyof TEvents, string>>
}

const RESERVED = new Set(['on', 'once', 'emit', 'emitTo', 'then'])

function makeTypedEvent(wireName: string): TypedEvent<unknown> {
  return {
    listen: (handler, options) => listen(wireName, handler, options),
    once: (handler, options) => once(wireName, handler, options),
    emit: (payload) => rawEmit(wireName, payload),
    emitTo: (target, payload) => emitTo(target, wireName, payload),
  }
}

/**
 * Builds a typed event client for `TEvents`. No runtime schema is required —
 * `TEvents` is erased at runtime, so every access is resolved on the fly via
 * a `Proxy`, the same strategy `createClient` (client.ts) uses for its
 * hand-written `CommandMap`. A typo in an event key is still caught by
 * `TEvents`'s type, not by this runtime lookup.
 */
export function createEventClient<TEvents extends EventPayloadMap>(
  options?: CreateEventClientOptions<TEvents>,
): EventClient<TEvents> {
  const names = options?.names
  const cache = new Map<string, TypedEvent<unknown>>()

  const reserved: EventClientReserved<TEvents> = {
    on: (event, handler, listenOptions) =>
      listen(names?.[event] ?? (event as string), handler, listenOptions),
    once: (event, handler, listenOptions) =>
      once(names?.[event] ?? (event as string), handler, listenOptions),
    emit: (event, payload) => rawEmit(names?.[event] ?? (event as string), payload),
    emitTo: (event, target, payload) =>
      emitTo(target, names?.[event] ?? (event as string), payload),
  }

  return new Proxy(reserved as unknown as Record<string, unknown>, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver)
      if (RESERVED.has(prop)) return Reflect.get(target, prop, receiver)

      let typedEvent = cache.get(prop)
      if (!typedEvent) {
        typedEvent = makeTypedEvent(names?.[prop as keyof TEvents] ?? prop)
        cache.set(prop, typedEvent)
      }
      return typedEvent
    },
  }) as EventClient<TEvents>
}

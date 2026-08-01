/**
 * Typed mock client for testing (issue #26, filling the gap left by
 * specta-rs/tauri-specta#197 — "Unit testing"): generated bindings are const
 * arrow functions wired straight to `__TAURI_INVOKE`, with no seam to swap in
 * a fake. This package already sits between the call site and the transport,
 * so it can offer that seam directly, independent of `@tauri-apps/api/mocks`'
 * `mockIPC` (which mocks at the `window.__TAURI_INTERNALS__` layer and is not
 * typed against a `CommandMap` at all).
 *
 * Kept as its own subpath (`tauri-invoke-binding/testing`) — test-only code
 * has no reason to be in every consumer's production bundle.
 *
 * ```ts
 * import { createMockClient } from 'tauri-invoke-binding/testing'
 *
 * const api = createMockClient<AppCommands>({
 *   hello_world: ({ myName }) => `hi ${myName}`,
 *   has_error: () => ({ status: 'error', error: 42 }),
 * })
 *
 * await api.helloWorld({ myName: 'Tauri' }) // -> 'hi Tauri'
 * await api.safe.hasError() // -> { status: 'error', error: { kind: 'command', value: 42 } }
 * api.__mock.calls // -> [{ command: 'hello_world', args: { myName: 'Tauri' } }, ...]
 * ```
 */
import type { InvokeFn, SafeInvokeFn } from './call.js'
import type { SnakeToCamel } from './casing.js'
import { camelToSnake } from './casing.js'
import { raceAbort, throwIfAborted } from './internal/abort.js'
import { classifyForMiddleware } from './internal/classify-for-middleware.js'
import type { CallOptions } from './middleware/pipeline.js'
import { err, ok, type Result } from './result.js'
import type { SafeError, TransportError } from './transport-error.js'

/**
 * The subset of `Command` (command.ts) this module works against: the
 * hand-written DSL's own restriction (`void` or a plain args object, see
 * `HandWrittenCommandMap` in client.ts) — handlers are keyed by wire command
 * name and called with a single args value, so a positional-tuple `Command`
 * (the `tauri-specta` calling convention) has no natural handler shape here.
 */
export type MockCommandMap = Record<
  string,
  // biome-ignore lint/suspicious/noExplicitAny: extractors below must accept any instantiation
  { readonly __command?: { args: any; ok: any; err: any } }
>

// biome-ignore lint/suspicious/noExplicitAny: matches MockCommandMap's own definition
type AnyMockCommand = { readonly __command?: { args: any; ok: any; err: any } }
type MockArgs<C extends AnyMockCommand> = C extends { __command?: { args: infer A } } ? A : never
type MockOk<C extends AnyMockCommand> = C extends { __command?: { ok: infer O } } ? O : never
type MockErr<C extends AnyMockCommand> = C extends { __command?: { err: infer E } } ? E : never

/** The shape a handler returns to simulate the command's own declared
 * `Err(E)` — deliberately identical to `Result`'s error branch (result.ts),
 * the same convention `tauri-specta`'s generated code and this package's
 * `specta.ts` adapter already use. A handler with no declared `Err` (the
 * default `never`) cannot construct one of these, since `error: never` has
 * no value — misuse is a type error, not a runtime footgun. */
export interface MockErrorResult<Err> {
  status: 'error'
  error: Err
}

export type MockHandler<Args, Ok, Err> = (
  args: Args,
) => Ok | MockErrorResult<Err> | Promise<Ok | MockErrorResult<Err>>

export type MockHandlers<TCommands extends MockCommandMap> = {
  [K in keyof TCommands]?: MockHandler<
    MockArgs<TCommands[K]>,
    MockOk<TCommands[K]>,
    MockErr<TCommands[K]>
  >
}

function isMockErrorResult(value: unknown): value is MockErrorResult<unknown> {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  // biome-ignore lint/complexity/useLiteralKeys: bracket notation is required here by noPropertyAccessFromIndexSignature
  return record['status'] === 'error' && 'error' in record
}

/**
 * Thrown by a handler (via `mockTransportError`) to make a call resolve as a
 * specific `TransportError` `kind` — issue #26's "各 `TransportError` の
 * `kind` を注入できる" completion condition. Recognized by both call sites
 * before anything else: unlike a real IPC rejection, there is no ambiguity to
 * resolve heuristically here, the kind was stated directly.
 */
export class MockTransportError extends Error {
  constructor(readonly transportError: TransportError) {
    super(`tauri-invoke-binding: mock transport error (kind: "${transportError.kind}")`)
    this.name = 'MockTransportError'
  }
}

/** Throws a `MockTransportError` wrapping `error` — call this from a handler
 * to simulate a specific transport failure (timeout, deserialization,
 * not-in-tauri, ...) instead of the command's own `Err`.
 *
 * ```ts
 * createMockClient<AppCommands>({
 *   hello_world: () => mockTransportError({ kind: 'timeout', command: 'hello_world', ms: 5000 }),
 * })
 * ```
 */
export function mockTransportError(error: TransportError): never {
  throw new MockTransportError(error)
}

/** Wraps a handler's `{ status: 'error', error }` return so the throwing and
 * safe call sites can each unwrap it deterministically instead of
 * re-guessing what the raw value means (see `dispatchMock`). */
class MockCommandError extends Error {
  constructor(readonly value: unknown) {
    super('tauri-invoke-binding: mock command error (see .value)')
    this.name = 'MockCommandError'
  }
}

export interface MockCall {
  readonly command: string
  readonly args: unknown
}

/** What happens when a call targets a command with no registered handler.
 * `'throw'` (default) fails loudly and names the command — the common case
 * of a typo or a forgotten handler should not be mistaken for the
 * `'command-not-found'` `TransportError` the real transport would produce
 * for a command missing from `generate_handler!`, which is what
 * `'command-not-found'` simulates instead. */
export type UnknownCommandPolicy = 'throw' | 'command-not-found'

export interface MockClientController<TCommands extends MockCommandMap> {
  /** Every call made through this client so far, in order. */
  readonly calls: readonly MockCall[]
  /** Calls made to a specific wire command name (snake_case, matching the
   * `MockHandlers` key — not the camelCase call-site accessor). */
  callsFor(command: keyof TCommands & string): readonly MockCall[]
  /** Clears recorded calls. Handlers are untouched. */
  reset(): void
  /** Registers or replaces handlers after construction — e.g. per-test
   * overrides layered on a shared base client. */
  setHandlers(handlers: MockHandlers<TCommands>): void
}

export type MockFlatClient<TCommands extends MockCommandMap> = {
  [K in keyof TCommands as SnakeToCamel<K & string>]: InvokeFn<
    MockArgs<TCommands[K]>,
    MockOk<TCommands[K]>
  >
}

export type MockSafeClient<TCommands extends MockCommandMap> = {
  [K in keyof TCommands as SnakeToCamel<K & string>]: SafeInvokeFn<
    MockArgs<TCommands[K]>,
    MockOk<TCommands[K]>,
    MockErr<TCommands[K]>
  >
}

/**
 * `safe` and `__mock` are reserved the same way `Client.safe`/`.then` are
 * reserved in client.ts: a `MockCommandMap` key that happens to camelCase to
 * one of these names is shadowed by it, and the type system does not flag
 * the collision. `then` is reserved for the same language-level reason
 * documented there (a `Proxy` answering every property would be mistaken for
 * a thenable).
 */
export type MockClient<TCommands extends MockCommandMap> = MockFlatClient<TCommands> & {
  safe: MockSafeClient<TCommands>
  __mock: MockClientController<TCommands>
}

export interface CreateMockClientOptions {
  /** Default `'throw'` — see `UnknownCommandPolicy`. */
  unknownCommand?: UnknownCommandPolicy
}

/**
 * Runs one call against the handler map, resolving to the handler's raw
 * return value or throwing. The exact thing it throws is deliberately
 * disambiguated up front — `MockCommandError` for a declared `Err`,
 * `MockTransportError` for an injected transport failure — so `callMock` and
 * `callMockSafe` below never have to re-derive what a rejection means the
 * way the real transport's callers must (classify.ts exists precisely
 * because real IPC rejections don't come with that certainty).
 */
async function dispatchMock(
  handlers: Record<string, MockHandler<unknown, unknown, unknown> | undefined>,
  calls: MockCall[],
  unknownCommand: UnknownCommandPolicy,
  command: string,
  args: unknown,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  throwIfAborted(signal, command)
  calls.push({ command, args })

  const handler = handlers[command]
  if (!handler) {
    if (unknownCommand === 'command-not-found') {
      throw new MockTransportError({ kind: 'command-not-found', command })
    }
    throw new Error(
      `tauri-invoke-binding: no mock handler registered for command "${command}". ` +
        "Pass one to createMockClient() / __mock.setHandlers(), or set unknownCommand: 'command-not-found' " +
        'to simulate the command not existing on the Rust side instead of failing the test loudly.',
    )
  }

  const result = await raceAbort(
    Promise.resolve().then(() => handler(args)),
    signal,
    command,
  )
  if (isMockErrorResult(result)) throw new MockCommandError(result.error)
  return result
}

async function callMock<Ok>(
  handlers: Record<string, MockHandler<unknown, unknown, unknown> | undefined>,
  calls: MockCall[],
  unknownCommand: UnknownCommandPolicy,
  command: string,
  args: unknown,
  callOptions: CallOptions,
): Promise<Ok> {
  try {
    return (await dispatchMock(
      handlers,
      calls,
      unknownCommand,
      command,
      args,
      callOptions.signal,
    )) as Ok
  } catch (reason) {
    // The throwing call site mirrors real `invoke()`: whatever the command
    // rejects with, unwrapped from the disambiguation wrapper above but
    // otherwise untouched — real Tauri IPC gives no stronger guarantee either.
    if (reason instanceof MockCommandError) throw reason.value
    throw reason
  }
}

async function callMockSafe<Ok, Err>(
  handlers: Record<string, MockHandler<unknown, unknown, unknown> | undefined>,
  calls: MockCall[],
  unknownCommand: UnknownCommandPolicy,
  command: string,
  args: unknown,
  callOptions: CallOptions,
): Promise<Result<Ok, SafeError<Err>>> {
  try {
    const value = await dispatchMock(
      handlers,
      calls,
      unknownCommand,
      command,
      args,
      callOptions.signal,
    )
    return ok(value as Ok)
  } catch (reason) {
    if (reason instanceof MockCommandError)
      return err({ kind: 'command', value: reason.value as Err })
    if (reason instanceof MockTransportError) return err(reason.transportError as TransportError)
    // Anything else (AbortError from throwIfAborted/raceAbort, or a handler
    // that threw a plain Error/string/value on its own) goes through the same
    // classifier every other safe call site uses (issue #11).
    return err(classifyForMiddleware<Err>(reason, command))
  }
}

function buildMockProxy(
  invoke: (commandName: string, args: unknown, options: CallOptions | undefined) => unknown,
): Record<string, unknown> {
  const cache = new Map<string, (...args: unknown[]) => unknown>()
  const target: Record<string, unknown> = {}
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop !== 'string') return Reflect.get(obj, prop, receiver)
      if (prop in obj) return Reflect.get(obj, prop, receiver)
      if (prop === 'then') return undefined

      let fn = cache.get(prop)
      if (!fn) {
        const commandName = camelToSnake(prop)
        fn = (args: unknown, options?: unknown) =>
          invoke(commandName, args, options as CallOptions | undefined)
        cache.set(prop, fn)
      }
      return fn
    },
  })
}

/**
 * Builds a fully-typed mock client from a handler map (issue #26). No Tauri
 * webview, no `window.__TAURI_INTERNALS__` — every function in this module
 * is pure TS/JS, so the whole surface (throwing and `.safe.*` call sites,
 * injected `TransportError`s, call history) is testable from plain vitest.
 */
export function createMockClient<TCommands extends MockCommandMap>(
  handlers: MockHandlers<TCommands>,
  options: CreateMockClientOptions = {},
): MockClient<TCommands> {
  const unknownCommand = options.unknownCommand ?? 'throw'
  let current: Record<string, MockHandler<unknown, unknown, unknown> | undefined> = {
    ...(handlers as Record<string, MockHandler<unknown, unknown, unknown> | undefined>),
  }
  const calls: MockCall[] = []

  const controller: MockClientController<TCommands> = {
    calls,
    callsFor: (command) => calls.filter((c) => c.command === command),
    reset: () => {
      calls.length = 0
    },
    setHandlers: (next) => {
      current = {
        ...current,
        ...(next as Record<string, MockHandler<unknown, unknown, unknown> | undefined>),
      }
    },
  }

  const client = buildMockProxy((commandName, args, callOptions) =>
    callMock(current, calls, unknownCommand, commandName, args, callOptions ?? {}),
  )
  const safe = buildMockProxy((commandName, args, callOptions) =>
    callMockSafe(current, calls, unknownCommand, commandName, args, callOptions ?? {}),
  )
  // biome-ignore lint/complexity/useLiteralKeys: bracket notation is required here by noPropertyAccessFromIndexSignature
  client['safe'] = safe
  // biome-ignore lint/complexity/useLiteralKeys: bracket notation is required here by noPropertyAccessFromIndexSignature
  client['__mock'] = controller

  return client as MockClient<TCommands>
}

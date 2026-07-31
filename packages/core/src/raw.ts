/**
 * Typed calling convention for Tauri v2's raw IPC request —
 * `tauri::ipc::Request` on the Rust side, `invoke(cmd, rawBody, { headers
 * })` on the TS side (issue #24, filling the gap left by
 * specta-rs/tauri-specta#170):
 *
 * ```rust
 * #[tauri::command]
 * fn upload(request: tauri::ipc::Request) -> Result<(), Error> {
 *   let tauri::ipc::InvokeBody::Raw(data) = request.body() else { ... };
 *   let auth = request.headers().get("Authorization");
 * }
 * ```
 *
 * `RawCommand` is deliberately not `Command` (command.ts) with a wider
 * `Args`: it is a structurally distinct type (see the unique-symbol brand
 * below), so a `CommandMap` and a `RawCommandMap` can never be confused for
 * one another — passing a JSON args object to a raw command, or a raw body
 * to a JSON command, is a type error at the call site, per the issue's
 * completion condition.
 */
import type { SnakeToCamel } from './casing.js'
import { camelToSnake } from './casing.js'
import { raceAbort, throwIfAborted } from './internal/abort.js'
import { classifyForMiddleware } from './internal/classify-for-middleware.js'
import { NotInTauriError } from './internal/errors.js'
import { isTauriEnvironment, rawInvokeRequest } from './internal/tauri.js'
import {
  type CallOptions,
  composeMiddleware,
  type Invoker,
  type Middleware,
} from './middleware/pipeline.js'
import { err, ok, type Result } from './result.js'
import type { SafeError } from './transport-error.js'

export type RawBody = ArrayBuffer | Uint8Array | readonly number[]

declare const RAW_COMMAND_BRAND: unique symbol

/** Declares a single raw-IPC command: the body shape it accepts (always
 * `RawBody`, unlike `Command`'s `Args`), what it resolves with, and — if the
 * Rust command returns `Result<T, E>` — what `E` is. See command.ts's
 * `Command` for the JSON-args counterpart this deliberately does not share a
 * type with. */
export type RawCommand<Ok, Err = never> = {
  readonly __command?: {
    args: RawBody
    ok: Ok
    err: Err
  }
  readonly [RAW_COMMAND_BRAND]: true
}

export type RawCommandMap = Record<string, RawCommand<unknown, unknown>>

// biome-ignore lint/suspicious/noExplicitAny: extractors must accept any RawCommand<...> instantiation
type AnyRawCommand = RawCommand<any, any>

export type RawCommandOk<C extends AnyRawCommand> =
  C extends RawCommand<infer Ok, unknown> ? Ok : never

export type RawCommandErr<C extends AnyRawCommand> =
  C extends RawCommand<unknown, infer Err> ? Err : never

export interface RawCallOptions extends CallOptions {
  headers?: HeadersInit
}

interface RawInvokeArgs {
  body: RawBody
  headers: HeadersInit | undefined
}

async function invokeRawBody(
  command: string,
  body: RawBody,
  headers: HeadersInit | undefined,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  throwIfAborted(signal, command)
  if (!isTauriEnvironment()) throw new NotInTauriError(command)
  return raceAbort(rawInvokeRequest(command, body, headers), signal, command)
}

/** The tail of every raw-command middleware pipeline — mirrors `baseInvoker`
 * in call.ts, but unpacks `ctx.args` as `{ body, headers }` instead of a
 * JSON args object. */
export const rawBaseInvoker: Invoker = (ctx) => {
  const { body, headers } = ctx.args as RawInvokeArgs
  return invokeRawBody(ctx.command, body, headers, ctx.signal)
}

/** The throwing raw-IPC call site. Mirrors `callCommand` in call.ts. */
export async function callRaw<Ok>(
  command: string,
  body: RawBody,
  pipeline: Invoker = rawBaseInvoker,
  callOptions: RawCallOptions = {},
): Promise<Ok> {
  const { headers, ...rest } = callOptions
  const args: RawInvokeArgs = { body, headers }
  return pipeline({ command, args, signal: rest.signal, callOptions: rest }) as Promise<Ok>
}

/** The never-throws raw-IPC call site. Mirrors `callCommandSafe` in call.ts. */
export async function callRawSafe<Ok, Err>(
  command: string,
  body: RawBody,
  pipeline: Invoker = rawBaseInvoker,
  callOptions: RawCallOptions = {},
): Promise<Result<Ok, SafeError<Err>>> {
  try {
    const data = await callRaw<Ok>(command, body, pipeline, callOptions)
    return ok(data)
  } catch (reason: unknown) {
    return err(classifyForMiddleware<Err>(reason, command))
  }
}

export type RawInvokeFn<Ok> = (body: RawBody, options?: RawCallOptions) => Promise<Ok>
export type RawSafeInvokeFn<Ok, Err> = (
  body: RawBody,
  options?: RawCallOptions,
) => Promise<Result<Ok, SafeError<Err>>>

export type RawFlatClient<TCommands extends RawCommandMap> = {
  [K in keyof TCommands as SnakeToCamel<K & string>]: RawInvokeFn<RawCommandOk<TCommands[K]>>
}

export type RawSafeClient<TCommands extends RawCommandMap> = {
  [K in keyof TCommands as SnakeToCamel<K & string>]: RawSafeInvokeFn<
    RawCommandOk<TCommands[K]>,
    RawCommandErr<TCommands[K]>
  >
}

export type RawClient<TCommands extends RawCommandMap> = RawFlatClient<TCommands> & {
  safe: RawSafeClient<TCommands>
}

export interface CreateRawClientOptions {
  middleware?: readonly Middleware[]
  commandOptions?: Record<string, RawCallOptions>
}

function mergeRawCallOptions(
  commandOptions: Record<string, RawCallOptions> | undefined,
  commandName: string,
  callSiteOptions: RawCallOptions | undefined,
): RawCallOptions {
  return { ...commandOptions?.[commandName], ...callSiteOptions }
}

function buildRawInvokerProxy(
  invoke: (commandName: string, body: RawBody, options: RawCallOptions | undefined) => unknown,
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
        fn = (body: unknown, options?: unknown) =>
          invoke(commandName, body as RawBody, options as RawCallOptions | undefined)
        cache.set(prop, fn)
      }
      return fn
    },
  })
}

/**
 * The raw-IPC entry point (issue #24) — declare a `RawCommandMap` as a
 * `type`, the same way `createClient` (client.ts) works from a `CommandMap`:
 *
 * ```ts
 * type AppRawCommands = {
 *   upload: RawCommand<void, string>
 * }
 * const api = createRawClient<AppRawCommands>()
 * await api.upload(new Uint8Array([1, 2, 3]), { headers: { Authorization: 'key' } })
 * ```
 */
export function createRawClient<TCommands extends RawCommandMap>(
  options?: CreateRawClientOptions,
): RawClient<TCommands> {
  const pipeline = composeMiddleware(options?.middleware ?? [])(rawBaseInvoker)
  const commandOptions = options?.commandOptions

  const client = buildRawInvokerProxy((commandName, body, callSiteOptions) =>
    callRaw(
      commandName,
      body,
      pipeline,
      mergeRawCallOptions(commandOptions, commandName, callSiteOptions),
    ),
  )
  const safe = buildRawInvokerProxy((commandName, body, callSiteOptions) =>
    callRawSafe(
      commandName,
      body,
      pipeline,
      mergeRawCallOptions(commandOptions, commandName, callSiteOptions),
    ),
  )
  // biome-ignore lint/complexity/useLiteralKeys: bracket notation is required here by noPropertyAccessFromIndexSignature
  client['safe'] = safe

  return client as RawClient<TCommands>
}

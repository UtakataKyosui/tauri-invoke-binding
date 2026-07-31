import {
  baseInvoker,
  callCommand,
  callCommandSafe,
  type InvokeFn,
  type SafeInvokeFn,
} from './call.js'
import type { SnakeToCamel } from './casing.js'
import { camelToSnake } from './casing.js'
import type { Command, CommandArgs, CommandErr, CommandMap, CommandOk } from './command.js'
import {
  type CallOptions,
  composeMiddleware,
  type Invoker,
  type Middleware,
} from './middleware/pipeline.js'

/**
 * The hand-written DSL's `Args` shape is narrower than `Command`'s general
 * `CommandArgsShape` (see command.ts): only `void` or a plain object, never
 * a positional tuple. The runtime client below is a `Proxy` that derives the
 * wire command name from whatever camelCase property was accessed — it has
 * no way to know a command's real arity, so it always forwards exactly one
 * `args` value. A tuple-shaped `Command` would silently drop everything past
 * the first positional argument if called through this client. Tuple args
 * only make sense where the underlying function already has a real,
 * well-defined arity to call — i.e. the `tauri-specta` adapter (specta.ts),
 * which wraps generated functions directly instead of guessing.
 */
export type HandWrittenCommandMap = Record<
  string,
  // biome-ignore lint/suspicious/noConfusingVoidType: void models "this command takes no arguments", the same way Promise<void> models "no return value"
  Command<void | Record<string, unknown>, unknown, unknown>
>

export type FlatClient<TCommands extends CommandMap> = {
  [K in keyof TCommands as SnakeToCamel<K & string>]: InvokeFn<
    CommandArgs<TCommands[K]>,
    CommandOk<TCommands[K]>
  >
}

export type SafeClient<TCommands extends CommandMap> = {
  [K in keyof TCommands as SnakeToCamel<K & string>]: SafeInvokeFn<
    CommandArgs<TCommands[K]>,
    CommandOk<TCommands[K]>,
    CommandErr<TCommands[K]>
  >
}

type NamespaceMembers<TCommands extends CommandMap, Prefix extends string> = {
  [K in keyof TCommands as K extends `${Prefix}${infer Rest}`
    ? SnakeToCamel<Rest>
    : never]: InvokeFn<CommandArgs<TCommands[K]>, CommandOk<TCommands[K]>>
}

type NamespaceSafeMembers<TCommands extends CommandMap, Prefix extends string> = {
  [K in keyof TCommands as K extends `${Prefix}${infer Rest}`
    ? SnakeToCamel<Rest>
    : never]: SafeInvokeFn<
    CommandArgs<TCommands[K]>,
    CommandOk<TCommands[K]>,
    CommandErr<TCommands[K]>
  >
}

/** Issue #8: TS-side-only command namespacing on top of Tauri's single flat
 * command namespace, keyed by a runtime prefix→namespace mapping passed to
 * `createClient`. Flat access (`FlatClient`) stays available alongside this
 * — namespacing is additive, not a replacement. */
export type NamespacedClient<
  TCommands extends CommandMap,
  Namespaces extends Record<string, string>,
> = {
  [N in keyof Namespaces]: NamespaceMembers<TCommands, Namespaces[N] & string> & {
    safe: NamespaceSafeMembers<TCommands, Namespaces[N] & string>
  }
}

/**
 * `safe` is a reserved accessor on every `Client` (and every namespace within
 * one) — it is always the never-throws call site, not a command. A
 * hand-written `CommandMap` key that itself derives to the camelCase name
 * `safe` (e.g. a Rust command literally named `safe`) is shadowed by it: the
 * type system does not flag this collision (the intersection below simply
 * merges both shapes under the same key), and at runtime `client.safe` will
 * always resolve to the reserved accessor. `createClient` does guard the one
 * case it can detect cheaply — a namespace key of `"safe"` — but a
 * command-level collision is left to the caller to avoid.
 *
 * `then` is reserved too, for a harder reason: it is not this package's
 * choice but the language's. Any object with a callable `then` is a thenable,
 * so a client that answered `.then` with an invoker would hang the moment it
 * met `await` or `Promise.resolve`. The proxy therefore always reports `then`
 * as absent — see `buildInvokerProxy`. A command named `then` is
 * unreachable through this client; call it via `callCommand` directly.
 */
export type Client<
  TCommands extends CommandMap,
  Namespaces extends Record<string, string> = Record<never, string>,
> = FlatClient<TCommands> & { safe: SafeClient<TCommands> } & NamespacedClient<
    TCommands,
    Namespaces
  >

export interface CreateClientOptions<Namespaces extends Record<string, string>> {
  /** Maps a namespace key to the literal prefix its commands share on the
   * Rust side, e.g. `{ fs: 'fs_' }` exposes `fs_read_file` as
   * `client.fs.readFile`. See issue #8. */
  namespaces?: Namespaces
  /** Middleware applied to every call through this client, in the order
   * documented on `composeMiddleware` (issue #13): `middleware[0]` runs its
   * "before" logic first and its "after"/error-handling logic last. */
  middleware?: readonly Middleware[]
  /** Per-command defaults for `CallOptions` (issue #14/#18's "コマンド単位
   * での...上書き/指定"), keyed by the wire command name (snake_case, the
   * same name middleware sees as `ctx.command` — not the camelCase accessor
   * used at the call site). Shallow-merged under whatever the caller passes
   * at the call site, which always wins. */
  commandOptions?: Record<string, CallOptions>
}

function mergeCallOptions(
  commandOptions: Record<string, CallOptions> | undefined,
  commandName: string,
  callSiteOptions: CallOptions | undefined,
): CallOptions {
  return { ...commandOptions?.[commandName], ...callSiteOptions }
}

function buildInvokerProxy(
  toCommandName: (prop: string) => string,
  invoke: (commandName: string, args: unknown, options: CallOptions | undefined) => unknown,
): Record<string, unknown> {
  const cache = new Map<string, (...args: unknown[]) => unknown>()
  const target: Record<string, unknown> = {}

  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop !== 'string') return Reflect.get(obj, prop, receiver)
      if (prop in obj) return Reflect.get(obj, prop, receiver)

      // `then` must stay absent, or the language itself mistakes the client
      // for a thenable: `await api`, `Promise.resolve(api)`, and returning
      // the client from an async function all probe `.then`, and a proxy that
      // answers every property with an invoker would hand one back. The
      // runtime would then call it as `then(resolve, reject)` — dispatching a
      // phantom `invoke('then', resolve)` and, because the invoker ignores
      // the resolve/reject callbacks it was handed, never settling. Awaiting
      // the client would hang forever. A Rust command genuinely named `then`
      // is unreachable through this client as a result; `safe` is reserved
      // the same way (see the doc comment on `Client`).
      if (prop === 'then') return undefined

      let fn = cache.get(prop)
      if (!fn) {
        const commandName = toCommandName(prop)
        fn = (...args: unknown[]) =>
          invoke(commandName, args[0], args[1] as CallOptions | undefined)
        cache.set(prop, fn)
      }
      return fn
    },
  })
}

function makeFlatInvokers(
  prefix: string,
  pipeline: Invoker,
  commandOptions: Record<string, CallOptions> | undefined,
): Record<string, unknown> {
  return buildInvokerProxy(
    (prop) => prefix + camelToSnake(prop),
    (commandName, args, options) =>
      callCommand(
        commandName,
        args as Record<string, unknown> | undefined,
        pipeline,
        mergeCallOptions(commandOptions, commandName, options),
      ),
  )
}

function makeSafeInvokers(
  prefix: string,
  pipeline: Invoker,
  commandOptions: Record<string, CallOptions> | undefined,
): Record<string, unknown> {
  return buildInvokerProxy(
    (prop) => prefix + camelToSnake(prop),
    (commandName, args, options) =>
      callCommandSafe(
        commandName,
        args as Record<string, unknown> | undefined,
        pipeline,
        mergeCallOptions(commandOptions, commandName, options),
      ),
  )
}

/**
 * The hand-written entry point (issue #5) — declare `AppCommands` as a
 * `type`, no runtime schema required:
 *
 * ```ts
 * type AppCommands = {
 *   hello_world: Command<{ myName: string }, string>
 *   has_error: Command<void, string, number>
 * }
 * const api = createClient<AppCommands>()
 * await api.helloWorld({ myName: 'Tauri' }) // -> invoke('hello_world', { myName: 'Tauri' })
 * ```
 *
 * Since there is no runtime `AppCommands` value (the type is erased), this
 * returns a `Proxy`: each camelCase property access derives its wire command
 * name on the fly via `camelToSnake`, rather than being built from a static
 * list of known commands. A typo in a command name is still caught — by
 * `TCommands`'s type, not by this runtime lookup.
 */
export function createClient<
  TCommands extends HandWrittenCommandMap,
  const Namespaces extends Record<string, string> = Record<never, string>,
>(options?: CreateClientOptions<Namespaces>): Client<TCommands, Namespaces> {
  const namespaces = options?.namespaces ?? ({} as Namespaces)

  // 'safe' is reserved for the never-throws call site below. A namespace
  // registered under that key would silently overwrite it — the type system
  // doesn't reliably catch this collision (see the doc comment on `Client`),
  // so it's guarded here instead of failing silently at the call site.
  if ('safe' in namespaces) {
    throw new Error(
      '"safe" cannot be used as a namespace key — it is reserved for the never-throws call site (client.safe.*).',
    )
  }

  const pipeline = composeMiddleware(options?.middleware ?? [])(baseInvoker)
  const commandOptions = options?.commandOptions

  const client = makeFlatInvokers('', pipeline, commandOptions)
  // biome-ignore lint/complexity/useLiteralKeys: bracket notation is required here by noPropertyAccessFromIndexSignature (client is Record<string, unknown>)
  client['safe'] = makeSafeInvokers('', pipeline, commandOptions)

  for (const [key, prefix] of Object.entries(namespaces)) {
    const namespaceClient = makeFlatInvokers(prefix, pipeline, commandOptions)
    // biome-ignore lint/complexity/useLiteralKeys: bracket notation is required here by noPropertyAccessFromIndexSignature
    namespaceClient['safe'] = makeSafeInvokers(prefix, pipeline, commandOptions)
    client[key] = namespaceClient
  }

  return client as Client<TCommands, Namespaces>
}

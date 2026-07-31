/**
 * The `tauri-specta` adapter (issue #6) — the other half of "two entry
 * points, one call-site API" from the README. Hand this the object
 * `tauri-specta` already generates and get the same `FlatClient`/`SafeClient`
 * shape `createClient` (client.ts) builds from a hand-written `CommandMap`,
 * without redeclaring a single command.
 *
 * `tauri-specta` is deliberately not a dependency of this package (see the
 * README's Non-goals) — everything here works structurally against
 * `typeof commands`, so it isn't pinned to any particular version of the
 * generator.
 *
 * Event support (`events`, `emitTo`, ...) is out of scope here — that's
 * issues #18–#21 (L4). This module only adapts commands.
 */

import type { FlatClient, SafeClient } from './client.js'
import type { Command, CommandArgsShape } from './command.js'
import { raceAbort, throwIfAborted } from './internal/abort.js'
import { classifyForMiddleware } from './internal/classify-for-middleware.js'
import {
  type CallOptions,
  composeMiddleware,
  type Invoker,
  type Middleware,
} from './middleware/pipeline.js'
import { err, ok, type Result } from './result.js'
import type { SafeError } from './transport-error.js'

type ResultLike<Ok, Err> = { status: 'ok'; data: Ok } | { status: 'error'; error: Err }

/**
 * Detects whether a generated command's return type is `Promise<T>` (no
 * declared Rust `Result`) or `Promise<{ status: 'ok'|'error', ... }>` (a
 * command using `typedError`, i.e. the Rust command returns `Result<T, E>`)
 * — tauri-specta's own two shapes (see the README's "But type generation
 * already solves most of this" section). `[X]` on both sides disables
 * conditional-type distribution over `X`'s own union members, which matters
 * because `X` (the resolved value) can itself already be a union.
 */
type InferOk<X> = [X] extends [ResultLike<infer Ok, unknown>] ? Ok : X
type InferErr<X> = [X] extends [ResultLike<unknown, infer Err>] ? Err : never

type InferCommand<F> = F extends (...args: infer Args) => infer R
  ? Args extends CommandArgsShape
    ? Command<Args, InferOk<Awaited<R>>, InferErr<Awaited<R>>>
    : never
  : never

/**
 * Derives a `CommandMap` (see command.ts) from `typeof commands` — the
 * generated bindings object itself, not a hand-written declaration. This is
 * what makes type redeclaration unnecessary: `Args` comes from the generated
 * function's own parameter list (positional, matching tauri-specta's
 * calling convention exactly — see the doc comment on `Command` in
 * command.ts for why this isn't normalized into an args object), and
 * `Ok`/`Err` come from unwrapping its return type.
 */
export type InferCommands<T> = {
  [K in keyof T]: InferCommand<T[K]>
}

// biome-ignore lint/suspicious/noExplicitAny: matches the shape tauri-specta actually generates — arbitrary positional params, arbitrary return type
type GeneratedCommands = Record<string, (...args: any[]) => Promise<unknown>>

export interface CreateSpectaClientOptions {
  /** Middleware applied to every call through this client — same semantics
   * as `CreateClientOptions.middleware` in client.ts (issue #13). */
  middleware?: readonly Middleware[]
  /** Per-command `CallOptions` defaults, keyed by the generated bindings
   * object's own key (the same camelCase name used at the call site, since
   * `tauri-specta`'s generated object has no separate wire name to key by).
   * Shallow-merged under whatever the caller passes at the call site, which
   * always wins. */
  commandOptions?: Record<string, CallOptions>
}

function isResultLike(value: unknown): value is ResultLike<unknown, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    (value.status === 'ok' || value.status === 'error')
  )
}

/**
 * Splits the raw arguments a call site passed into the generated function's
 * real positional args and an optional trailing `CallOptions`. Unlike the
 * hand-written DSL (client.ts), this can be done unambiguously at runtime:
 * `generated.length` is the generated function's real, fixed arity (it's a
 * concrete function, not a type-erased declaration), so any argument past
 * that position is unambiguously the trailing options object rather than a
 * guess.
 */
function splitCallArgs(
  generated: (...args: unknown[]) => Promise<unknown>,
  rawArgs: unknown[],
): { positional: unknown[]; options: CallOptions | undefined } {
  const arity = generated.length
  if (rawArgs.length > arity) {
    return { positional: rawArgs.slice(0, arity), options: rawArgs[arity] as CallOptions }
  }
  return { positional: rawArgs, options: undefined }
}

/**
 * The `tauri-specta` entry point. Pass the `commands` object generated into
 * your `bindings.ts` — no type parameter needed, it's inferred from the
 * value itself:
 *
 * ```ts
 * import { commands } from './bindings'
 * import { createClient } from 'tauri-invoke-binding/specta'
 *
 * const api = createClient(commands)
 * await api.helloWorld('Tauri')       // same shape as commands.helloWorld itself
 * await api.safe.hasError()           // never throws
 * ```
 */
export function createClient<T extends GeneratedCommands>(
  commands: T,
  options?: CreateSpectaClientOptions,
): FlatClient<InferCommands<T>> & { safe: SafeClient<InferCommands<T>> } {
  const flat: Record<string, unknown> = {}
  const safe: Record<string, unknown> = {}
  const commandOptions = options?.commandOptions

  for (const key of Object.keys(commands)) {
    const generated = commands[key]
    if (!generated) continue

    // Same signal handling as the hand-written client's `baseInvoker`
    // (call.ts): an already-aborted signal never even reaches `generated`,
    // and once aborted mid-flight the eventual result is discarded — issue
    // #16 applies to every client this package builds, not just the
    // hand-written DSL.
    const baseInvoker: Invoker = async (ctx) => {
      throwIfAborted(ctx.signal, ctx.command)
      return raceAbort(generated(...(ctx.args as unknown[])), ctx.signal, ctx.command)
    }
    const pipeline = composeMiddleware(options?.middleware ?? [])(baseInvoker)

    flat[key] = (...rawArgs: unknown[]) => {
      const { positional, options: callSiteOptions } = splitCallArgs(generated, rawArgs)
      const callOptions: CallOptions = { ...commandOptions?.[key], ...callSiteOptions }
      return pipeline({ command: key, args: positional, signal: callOptions.signal, callOptions })
    }

    safe[key] = async (...rawArgs: unknown[]): Promise<Result<unknown, SafeError<unknown>>> => {
      const { positional, options: callSiteOptions } = splitCallArgs(generated, rawArgs)
      const callOptions: CallOptions = { ...commandOptions?.[key], ...callSiteOptions }
      try {
        const resolved = await pipeline({
          command: key,
          args: positional,
          signal: callOptions.signal,
          callOptions,
        })
        if (isResultLike(resolved)) {
          return resolved.status === 'ok'
            ? ok(resolved.data)
            : err({ kind: 'command', value: resolved.error })
        }
        return ok(resolved)
      } catch (reason: unknown) {
        // tauri-specta's own generated code only ever rejects (as opposed to
        // resolving with `{ status: 'error', error }`) for genuine
        // Error-instance transport failures — see the doc comment above and
        // the issue #10 investigation. classifyForMiddleware never produces
        // a `'command'` kind for an Error/string rejection, so a caught
        // rejection here never gets misreported as the command's own
        // declared Err.
        return err(classifyForMiddleware(reason, key))
      }
    }
  }

  // biome-ignore lint/complexity/useLiteralKeys: bracket notation is required here by noPropertyAccessFromIndexSignature (flat is Record<string, unknown>)
  flat['safe'] = safe
  return flat as FlatClient<InferCommands<T>> & { safe: SafeClient<InferCommands<T>> }
}

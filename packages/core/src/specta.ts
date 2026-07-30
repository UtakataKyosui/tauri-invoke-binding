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
import { classifyRejection } from './classify.js'
import type { FlatClient, SafeClient } from './client.js'
import type { Command, CommandArgsShape } from './command.js'
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

function isResultLike(value: unknown): value is ResultLike<unknown, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    (value.status === 'ok' || value.status === 'error')
  )
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
): FlatClient<InferCommands<T>> & { safe: SafeClient<InferCommands<T>> } {
  const flat: Record<string, unknown> = {}
  const safe: Record<string, unknown> = {}

  for (const key of Object.keys(commands)) {
    const generated = commands[key]
    if (!generated) continue

    flat[key] = (...args: unknown[]) => generated(...args)

    safe[key] = async (...args: unknown[]): Promise<Result<unknown, SafeError<unknown>>> => {
      try {
        const resolved = await generated(...args)
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
        // the issue #10 investigation. classifyRejection never produces a
        // `'command'` kind, so a caught rejection here never gets
        // misreported as the command's own declared Err.
        return err(classifyRejection(reason, { command: key }))
      }
    }
  }

  // biome-ignore lint/complexity/useLiteralKeys: bracket notation is required here by noPropertyAccessFromIndexSignature (flat is Record<string, unknown>)
  flat['safe'] = safe
  return flat as FlatClient<InferCommands<T>> & { safe: SafeClient<InferCommands<T>> }
}

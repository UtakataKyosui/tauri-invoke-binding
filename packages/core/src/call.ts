import { classifyRejection } from './classify.js'
import type { CommandArgsShape } from './command.js'
import { isTauriEnvironment, rawInvoke } from './internal/tauri.js'
import { err, ok, type Result } from './result.js'
import type { SafeError } from './transport-error.js'

/**
 * The calling convention for a command, derived from its declared `Args`
 * shape (see command.ts): no parameter for `void`, a single args object for
 * a plain object, or positional parameters for a tuple (the shape
 * `tauri-specta`'s generated functions use — see specta.ts).
 *
 * `CallOptions` (an `AbortSignal`, retry/timeout middleware, ...) is
 * deliberately not part of this signature yet — that is issue #16's job.
 * Adding it here would make the runtime call dispatch ambiguous (is a
 * trailing object argument the command's own args or call options?) without
 * a real per-command runtime schema to resolve it against, which the
 * hand-written DSL (client.ts) doesn't have.
 */
export type InvokeFn<Args extends CommandArgsShape, Ok> = Args extends void
  ? () => Promise<Ok>
  : Args extends readonly unknown[]
    ? (...args: Args) => Promise<Ok>
    : (args: Args) => Promise<Ok>

/** Same calling convention as `InvokeFn`, but resolves a `Result` instead of
 * throwing — see `SafeError` in transport-error.ts and issue #11. */
export type SafeInvokeFn<Args extends CommandArgsShape, Ok, Err> = Args extends void
  ? () => Promise<Result<Ok, SafeError<Err>>>
  : Args extends readonly unknown[]
    ? (...args: Args) => Promise<Result<Ok, SafeError<Err>>>
    : (args: Args) => Promise<Result<Ok, SafeError<Err>>>

export class NotInTauriError extends Error {
  constructor(command: string) {
    super(
      `"${command}" was called outside a Tauri webview (window.__TAURI_INTERNALS__ is not available).`,
    )
    this.name = 'NotInTauriError'
  }
}

async function invokeRaw(
  command: string,
  args: Record<string, unknown> | undefined,
): Promise<unknown> {
  if (!isTauriEnvironment()) throw new NotInTauriError(command)
  return rawInvoke(command, args)
}

/**
 * The throwing call site — behaves like the plain `@tauri-apps/api` `invoke`
 * (whatever it throws, this throws), just with `command`/`args`/return type
 * fully typed, plus the `not-in-tauri` check. Safety lives in
 * `callCommandSafe`, not here.
 */
export async function callCommand<Ok>(
  command: string,
  args: Record<string, unknown> | undefined,
): Promise<Ok> {
  return invokeRaw(command, args) as Promise<Ok>
}

/**
 * The `api.safe.*` call site (issue #11). Never throws: every rejection is
 * classified into either `{ kind: 'command', value }` (the Rust command's
 * own declared `Err`) or a `TransportError`.
 *
 * The `Error`-instance-vs-plain-value split below is the load-bearing
 * heuristic (see the issue #10 investigation): `reject(e)` on the JS side
 * passes through unmodified whatever Rust put in `InvokeResponse::Err`, and
 * a `serde::Serialize`-produced JSON value can never come back as a JS
 * `Error` instance — only a genuine JS/webview-layer failure (thrown before
 * or outside the Rust dispatch) looks like one. So a plain, non-`Error`,
 * non-`string` rejection is the strongest signal available that it's the
 * command's own `Err(E)`.
 */
export async function callCommandSafe<Ok, Err>(
  command: string,
  args: Record<string, unknown> | undefined,
): Promise<Result<Ok, SafeError<Err>>> {
  try {
    const data = await invokeRaw(command, args)
    return ok(data as Ok)
  } catch (reason: unknown) {
    if (reason instanceof NotInTauriError) return err({ kind: 'not-in-tauri' })
    if (reason instanceof Error || typeof reason === 'string') {
      return err(classifyRejection(reason, { command }))
    }
    return err({ kind: 'command', value: reason as Err })
  }
}

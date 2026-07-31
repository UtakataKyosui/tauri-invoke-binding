import type { CommandArgsShape } from './command.js'
import { raceAbort, throwIfAborted } from './internal/abort.js'
import { classifyForMiddleware } from './internal/classify-for-middleware.js'
import { NotInTauriError } from './internal/errors.js'
import { isTauriEnvironment, rawInvoke } from './internal/tauri.js'
import type { CallOptions, Invoker } from './middleware/pipeline.js'
import { err, ok, type Result } from './result.js'
import type { SafeError } from './transport-error.js'

export { NotInTauriError }

/**
 * The calling convention for a command, derived from its declared `Args`
 * shape (see command.ts): no parameter for `void`, a single args object for
 * a plain object, or positional parameters for a tuple (the shape
 * `tauri-specta`'s generated functions use — see specta.ts). Every shape also
 * accepts a trailing `CallOptions` (issue #13/#16): `signal`, and whatever a
 * middleware installed on the client reads off it (`timeoutMs`, `retry`,
 * `dedupe`, ...).
 *
 * The `void`-args shape is the one subtlety: the hand-written DSL
 * (client.ts) has no runtime schema, so its dispatch proxy cannot tell
 * whether a lone argument at the call site is "real" args or `CallOptions` —
 * doing so would require guessing from the object's shape, which is exactly
 * the ambiguity call.ts previously flagged as blocking this work. The fix is
 * to never let that ambiguity exist at the type level either: `args` is
 * always its own parameter position (`undefined` for a `void` command),
 * `options` is always the position after it. `api.ping()` and
 * `api.ping(undefined, { signal })` are both valid; `api.ping({ signal })` is
 * a type error.
 */
export type InvokeFn<Args extends CommandArgsShape, Ok> = Args extends void
  ? {
      (): Promise<Ok>
      (args: undefined, options: CallOptions): Promise<Ok>
    }
  : Args extends readonly unknown[]
    ? {
        (...args: Args): Promise<Ok>
        (...args: [...Args, CallOptions]): Promise<Ok>
      }
    : (args: Args, options?: CallOptions) => Promise<Ok>

/** Same calling convention as `InvokeFn`, but resolves a `Result` instead of
 * throwing — see `SafeError` in transport-error.ts and issue #11. */
export type SafeInvokeFn<Args extends CommandArgsShape, Ok, Err> = Args extends void
  ? {
      (): Promise<Result<Ok, SafeError<Err>>>
      (args: undefined, options: CallOptions): Promise<Result<Ok, SafeError<Err>>>
    }
  : Args extends readonly unknown[]
    ? {
        (...args: Args): Promise<Result<Ok, SafeError<Err>>>
        (...args: [...Args, CallOptions]): Promise<Result<Ok, SafeError<Err>>>
      }
    : (args: Args, options?: CallOptions) => Promise<Result<Ok, SafeError<Err>>>

async function invokeRaw(
  command: string,
  args: Record<string, unknown> | undefined,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  throwIfAborted(signal, command)
  if (!isTauriEnvironment()) throw new NotInTauriError(command)
  return raceAbort(rawInvoke(command, args), signal, command)
}

/** The tail of every middleware pipeline built by `createClient` (the
 * hand-written DSL) — the actual `invoke()` call, with the not-in-tauri
 * check and abort race baked in. Exported so client.ts can compose
 * middleware around it without duplicating this logic. */
export const baseInvoker: Invoker = (ctx) =>
  invokeRaw(ctx.command, ctx.args as Record<string, unknown> | undefined, ctx.signal)

/**
 * The throwing call site — behaves like the plain `@tauri-apps/api` `invoke`
 * (whatever it throws, this throws), just with `command`/`args`/return type
 * fully typed, plus the `not-in-tauri` check. Safety lives in
 * `callCommandSafe`, not here.
 *
 * `pipeline` defaults to `baseInvoker` (no middleware) so existing callers —
 * and this module's own tests — that only pass `command`/`args` keep working
 * unchanged; `createClient` (client.ts) passes its composed middleware chain.
 */
export async function callCommand<Ok>(
  command: string,
  args: Record<string, unknown> | undefined,
  pipeline: Invoker = baseInvoker,
  callOptions: CallOptions = {},
): Promise<Ok> {
  return pipeline({ command, args, signal: callOptions.signal, callOptions }) as Promise<Ok>
}

/**
 * The `api.safe.*` call site (issue #11). Never throws: every rejection is
 * classified into either `{ kind: 'command', value }` (the Rust command's
 * own declared `Err`) or a `TransportError` — see `classifyForMiddleware`.
 */
export async function callCommandSafe<Ok, Err>(
  command: string,
  args: Record<string, unknown> | undefined,
  pipeline: Invoker = baseInvoker,
  callOptions: CallOptions = {},
): Promise<Result<Ok, SafeError<Err>>> {
  try {
    const data = await pipeline({ command, args, signal: callOptions.signal, callOptions })
    return ok(data as Ok)
  } catch (reason: unknown) {
    return err(classifyForMiddleware<Err>(reason, command))
  }
}

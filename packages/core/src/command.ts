/**
 * Declares a single Tauri command's shape: what it takes, what it resolves
 * with, and — if the Rust command returns `Result<T, E>` — what `E` is.
 *
 * `Args` covers the two calling conventions this package supports:
 *  - `void` — no arguments (e.g. `Command<void, string>`)
 *  - a plain object — named arguments matching Tauri's own wire format,
 *    `invoke(cmd, { ...args })` (the shape used by the hand-written DSL, see
 *    `createClient` in client.ts)
 *  - a readonly tuple — positional arguments (the shape `tauri-specta`'s own
 *    generated functions use, e.g. `helloWorld: (myName: string) => ...`;
 *    see `InferCommands` in specta.ts, which derives this directly from the
 *    generated function's parameter list rather than guessing parameter
 *    names back into an object — TypeScript cannot recover them reliably)
 *
 * `Err` defaults to `never`: a command with no declared Rust error type has
 * no legitimate `{ kind: 'command', value }` case, so nothing should be able
 * to construct one (see `SafeError` in transport-error.ts).
 */
export type Command<Args extends CommandArgsShape, Ok, Err = never> = {
  readonly __command?: {
    args: Args
    ok: Ok
    err: Err
  }
}

// biome-ignore lint/suspicious/noConfusingVoidType: void models "this command takes no arguments", the same way Promise<void> models "no return value"
export type CommandArgsShape = void | Record<string, unknown> | readonly unknown[]

export type CommandMap = Record<string, Command<CommandArgsShape, unknown, unknown>>

// biome-ignore lint/suspicious/noExplicitAny: extractors must accept any Command<...> instantiation
type AnyCommand = Command<any, any, any>

export type CommandArgs<C extends AnyCommand> =
  C extends Command<infer A, unknown, unknown> ? A : never

export type CommandOk<C extends AnyCommand> =
  C extends Command<CommandArgsShape, infer Ok, unknown> ? Ok : never

export type CommandErr<C extends AnyCommand> =
  C extends Command<CommandArgsShape, unknown, infer Err> ? Err : never

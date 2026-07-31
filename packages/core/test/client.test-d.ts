import { describe, expectTypeOf, it } from 'vitest'
import { createClient } from '../src/client.js'
import type { Command } from '../src/command.js'
import type { CallOptions } from '../src/middleware/index.js'
import type { Result } from '../src/result.js'
import type { SafeError } from '../src/transport-error.js'

type AppCommands = {
  hello_world: Command<{ myName: string }, string>
  ping: Command<void, void>
  has_error: Command<void, string, number>
  fs_read_file: Command<{ path: string }, string>
  fs_write_file: Command<{ path: string; contents: string }, void>
  window_close: Command<void, void>
}

/** Mirrors the two-call-signature shape `InvokeFn` produces for a `void`-args
 * command (call.ts) — see its doc comment for why `args` and `options` are
 * always separate parameter positions instead of overloading one. */
type VoidInvoke<Ok> = {
  (): Promise<Ok>
  (args: undefined, options: CallOptions): Promise<Ok>
}

type VoidSafeInvoke<Ok, Err> = {
  (): Promise<Result<Ok, SafeError<Err>>>
  (args: undefined, options: CallOptions): Promise<Result<Ok, SafeError<Err>>>
}

describe('createClient (issue #5 — hand-written DSL)', () => {
  it('derives camelCase accessors from snake_case command keys', () => {
    const api = createClient<AppCommands>()
    expectTypeOf(api.helloWorld).toEqualTypeOf<
      (args: { myName: string }, options?: CallOptions) => Promise<string>
    >()
    expectTypeOf(api.hasError).toEqualTypeOf<VoidInvoke<string>>()
  })

  it('allows calling a no-args command with zero parameters', () => {
    const api = createClient<AppCommands>()
    expectTypeOf(api.ping).toEqualTypeOf<VoidInvoke<void>>()
    // @ts-expect-error - ping takes no arguments directly (only `(undefined, options)`)
    api.ping({})
  })

  it('rejects a typo in the command name', () => {
    const api = createClient<AppCommands>()
    // @ts-expect-error - 'helloWrld' is not a key of AppCommands
    api.helloWrld({ myName: 'x' })
  })

  it('rejects missing required arguments', () => {
    const api = createClient<AppCommands>()
    // @ts-expect-error - myName is required
    api.helloWorld({})
  })

  it('rejects excess properties on the args object', () => {
    const api = createClient<AppCommands>()
    // @ts-expect-error - 'extra' is not part of the declared args
    api.helloWorld({ myName: 'x', extra: 1 })
  })

  it('rejects a type mismatch on an argument', () => {
    const api = createClient<AppCommands>()
    // @ts-expect-error - myName must be a string
    api.helloWorld({ myName: 123 })
  })

  it('accepts a trailing CallOptions (issue #16 — signal, and whatever a middleware reads)', () => {
    const api = createClient<AppCommands>()
    const controller = new AbortController()
    api.helloWorld({ myName: 'x' }, { signal: controller.signal, timeoutMs: 1_000 })
    api.ping(undefined, { signal: controller.signal })
  })

  it('exposes a .safe accessor for every command, returning a Result', () => {
    const api = createClient<AppCommands>()
    expectTypeOf(api.safe.hasError).toEqualTypeOf<VoidSafeInvoke<string, number>>()
  })
})

describe('createClient namespacing (issue #8)', () => {
  it('exposes prefixed commands under a configured namespace, stripped and camelCased', () => {
    const api = createClient<AppCommands, { fs: 'fs_'; window: 'window_' }>({
      namespaces: { fs: 'fs_', window: 'window_' },
    })

    expectTypeOf(api.fs.readFile).toEqualTypeOf<
      (args: { path: string }, options?: CallOptions) => Promise<string>
    >()
    expectTypeOf(api.fs.writeFile).toEqualTypeOf<
      (args: { path: string; contents: string }, options?: CallOptions) => Promise<void>
    >()
    expectTypeOf(api.window.close).toEqualTypeOf<VoidInvoke<void>>()
  })

  it('gives each namespace its own .safe accessor', () => {
    const api = createClient<AppCommands, { fs: 'fs_' }>({ namespaces: { fs: 'fs_' } })
    expectTypeOf(api.fs.safe.readFile).toEqualTypeOf<
      (args: { path: string }, options?: CallOptions) => Promise<Result<string, SafeError<never>>>
    >()
  })

  it('keeps flat top-level access available alongside namespaces', () => {
    const api = createClient<AppCommands, { fs: 'fs_' }>({ namespaces: { fs: 'fs_' } })
    expectTypeOf(api.helloWorld).toEqualTypeOf<
      (args: { myName: string }, options?: CallOptions) => Promise<string>
    >()
  })

  it('does not expose a command under a namespace it does not belong to', () => {
    const api = createClient<AppCommands, { window: 'window_' }>({
      namespaces: { window: 'window_' },
    })
    // @ts-expect-error - readFile is fs_-prefixed, not window_-prefixed
    api.window.readFile
  })

  it('rejects an unconfigured namespace key', () => {
    const api = createClient<AppCommands, { fs: 'fs_' }>({ namespaces: { fs: 'fs_' } })
    // @ts-expect-error - 'window' was not configured as a namespace
    api.window
  })
})

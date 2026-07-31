/**
 * Issue #13's headline completion condition: "ミドルウェアを 0 個・1 個・
 * 複数個つけても型推論が変わらないことの型レベルテスト" — installing
 * middleware must not perturb any command's own argument or return types.
 *
 * These assertions are `toEqualTypeOf`, not `toMatchTypeOf`: a middleware
 * that widened a return type to `Promise<unknown>`, or that erased a
 * command's argument types, would still satisfy a looser check.
 */
import { describe, expectTypeOf, it } from 'vitest'
import { createClient } from '../../src/client.js'
import type { Command } from '../../src/command.js'
import type { CallOptions, Middleware } from '../../src/middleware/index.js'
import { dedupe, logger, retry, timeout } from '../../src/middleware/index.js'
import type { Result } from '../../src/result.js'
import type { SafeError } from '../../src/transport-error.js'

type AppCommands = {
  hello_world: Command<{ myName: string }, string>
  ping: Command<void, void>
  has_error: Command<void, string, number>
}

type HelloWorld = (args: { myName: string }, options?: CallOptions) => Promise<string>
type SafeHasError = {
  (): Promise<Result<string, SafeError<number>>>
  (args: undefined, options: CallOptions): Promise<Result<string, SafeError<number>>>
}

describe('middleware does not perturb command type inference (issue #13)', () => {
  it('infers identically with zero middleware', () => {
    const api = createClient<AppCommands>()
    expectTypeOf(api.helloWorld).toEqualTypeOf<HelloWorld>()
    expectTypeOf(api.safe.hasError).toEqualTypeOf<SafeHasError>()
  })

  it('infers identically with an explicitly empty middleware list', () => {
    const api = createClient<AppCommands>({ middleware: [] })
    expectTypeOf(api.helloWorld).toEqualTypeOf<HelloWorld>()
    expectTypeOf(api.safe.hasError).toEqualTypeOf<SafeHasError>()
  })

  it('infers identically with a single middleware', () => {
    const api = createClient<AppCommands>({ middleware: [timeout(5_000)] })
    expectTypeOf(api.helloWorld).toEqualTypeOf<HelloWorld>()
    expectTypeOf(api.safe.hasError).toEqualTypeOf<SafeHasError>()
  })

  it('infers identically with several middleware', () => {
    const api = createClient<AppCommands>({
      middleware: [timeout(5_000), retry({ times: 3 }), logger(), dedupe()],
    })
    expectTypeOf(api.helloWorld).toEqualTypeOf<HelloWorld>()
    expectTypeOf(api.safe.hasError).toEqualTypeOf<SafeHasError>()
  })

  it('infers identically with a custom user-written middleware', () => {
    const tap: Middleware = (next) => async (ctx) => next(ctx)
    const api = createClient<AppCommands>({ middleware: [tap] })
    expectTypeOf(api.helloWorld).toEqualTypeOf<HelloWorld>()
    expectTypeOf(api.safe.hasError).toEqualTypeOf<SafeHasError>()
  })

  it('still rejects bad arguments when middleware is installed', () => {
    const api = createClient<AppCommands>({ middleware: [timeout(1), retry({ times: 1 })] })
    // @ts-expect-error - myName must be a string, middleware or not
    api.helloWorld({ myName: 123 })
    // @ts-expect-error - unknown command, middleware or not
    api.nope()
  })

  it('keeps namespaced accessors inferring identically under middleware', () => {
    type Namespaced = { fs_read_file: Command<{ path: string }, string> }
    const api = createClient<Namespaced, { fs: 'fs_' }>({
      namespaces: { fs: 'fs_' },
      middleware: [logger()],
    })
    expectTypeOf(api.fs.readFile).toEqualTypeOf<
      (args: { path: string }, options?: CallOptions) => Promise<string>
    >()
  })
})

describe('CallOptions surface (issue #16)', () => {
  it('accepts every documented option', () => {
    const api = createClient<AppCommands>()
    api.helloWorld(
      { myName: 'x' },
      {
        signal: new AbortController().signal,
        timeoutMs: 1_000,
        retry: { times: 2, backoff: (n) => n * 10, shouldRetry: (e) => e.kind === 'unknown' },
        dedupe: true,
      },
    )
  })

  it('accepts retry: false to disable retrying for one call', () => {
    const api = createClient<AppCommands>()
    api.helloWorld({ myName: 'x' }, { retry: false })
  })

  it('rejects an unknown option key', () => {
    const api = createClient<AppCommands>()
    // @ts-expect-error - 'timeout' is not a CallOptions key ('timeoutMs' is)
    api.helloWorld({ myName: 'x' }, { timeout: 1_000 })
  })

  it('types shouldRetry with a fully narrowable SafeError', () => {
    const api = createClient<AppCommands>()
    api.helloWorld(
      { myName: 'x' },
      {
        retry: {
          shouldRetry: (e) => {
            // The classified error must still discriminate on `kind`.
            if (e.kind === 'timeout') return e.ms > 100
            if (e.kind === 'deserialization') return false
            return e.kind === 'unknown'
          },
        },
      },
    )
  })
})

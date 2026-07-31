import { describe, expectTypeOf, it } from 'vitest'
import type { CallOptions } from '../src/middleware/index.js'
import type { Result } from '../src/result.js'
import { createClient } from '../src/specta.js'
import type { SafeError } from '../src/transport-error.js'
import { commands } from './fixtures/specta-bindings.js'

/** Mirrors the two-call-signature shape `InvokeFn`/`SafeInvokeFn` produce for
 * a tuple-args command (call.ts): the plain positional call, plus the same
 * positional args with a trailing `CallOptions`. */
type TupleInvoke<Args extends readonly unknown[], Ok> = {
  (...args: Args): Promise<Ok>
  (...args: [...Args, CallOptions]): Promise<Ok>
}

type TupleSafeInvoke<Args extends readonly unknown[], Ok, Err> = {
  (...args: Args): Promise<Result<Ok, SafeError<Err>>>
  (...args: [...Args, CallOptions]): Promise<Result<Ok, SafeError<Err>>>
}

describe('tauri-specta adapter (issue #6)', () => {
  it('infers Args/Ok from a command with no declared Result, preserving positional params', () => {
    const api = createClient(commands)
    expectTypeOf(api.helloWorld).toEqualTypeOf<TupleInvoke<[myName: string], string>>()
  })

  it('infers Ok/Err from a command using typedError (a declared Rust Result<T, E>)', () => {
    const api = createClient(commands)
    expectTypeOf(api.safe.hasError).toEqualTypeOf<TupleSafeInvoke<[], string, number>>()
  })

  it('infers a no-args command as callable with zero parameters', () => {
    const api = createClient(commands)
    expectTypeOf(api.ping).toEqualTypeOf<TupleInvoke<[], null>>()
  })

  it('gives a command with no declared Result an Err of never on the safe path', () => {
    const api = createClient(commands)
    expectTypeOf(api.safe.helloWorld).toEqualTypeOf<
      TupleSafeInvoke<[myName: string], string, never>
    >()
  })

  it('requires zero type redeclaration — no type parameter passed to createClient', () => {
    // this compiling at all (T inferred purely from `commands`) is the test
    const api = createClient(commands)
    expectTypeOf(api).toHaveProperty('helloWorld')
    expectTypeOf(api).toHaveProperty('hasError')
    expectTypeOf(api).toHaveProperty('ping')
  })
})

import { describe, expectTypeOf, it } from 'vitest'
import type { Command } from '../src/command.js'
import { createMockClient } from '../src/testing.js'

type AppCommands = {
  hello_world: Command<{ myName: string }, string>
  has_error: Command<void, string, number>
  ping: Command<void, void>
}

describe('createMockClient handler typing (issue #26)', () => {
  it("a handler receives the command's own Args type", () => {
    createMockClient<AppCommands>({
      hello_world: (args) => {
        expectTypeOf(args).toEqualTypeOf<{ myName: string }>()
        return 'ok'
      },
    })
  })

  it("a handler must return the command's own Ok type (or a MockErrorResult)", () => {
    createMockClient<AppCommands>({
      // @ts-expect-error - hello_world resolves string, not number
      hello_world: () => 42,
    })
  })

  it('a command with no declared Err cannot return { status: "error", error }', () => {
    createMockClient<AppCommands>({
      // @ts-expect-error - ping declares no Err (defaults to never), so `error` has no valid value
      ping: () => ({ status: 'error', error: 'anything' }),
    })
  })

  it('a command with a declared Err accepts a correctly-typed MockErrorResult', () => {
    createMockClient<AppCommands>({
      has_error: () => ({ status: 'error', error: 42 }),
    })
  })

  it('a declared Err of the wrong type is a type error', () => {
    createMockClient<AppCommands>({
      // @ts-expect-error - has_error declares Err as number, not string
      has_error: () => ({ status: 'error', error: 'wrong' }),
    })
  })

  it('not every command needs a handler — MockHandlers is Partial', () => {
    createMockClient<AppCommands>({ ping: () => undefined })
  })
})

describe('createMockClient call-site typing (issue #26)', () => {
  it('the throwing site resolves the Ok type', async () => {
    const api = createMockClient<AppCommands>({ hello_world: ({ myName }) => `hi ${myName}` })
    expectTypeOf(await api.helloWorld({ myName: 'x' })).toEqualTypeOf<string>()
  })

  it('the safe site resolves Result<Ok, SafeError<Err>>', async () => {
    const api = createMockClient<AppCommands>({ has_error: () => ({ status: 'error', error: 42 }) })
    const result = await api.safe.hasError()
    if (result.status === 'ok') {
      expectTypeOf(result.data).toEqualTypeOf<string>()
    } else {
      expectTypeOf(result.error.kind).toEqualTypeOf<
        | 'command'
        | 'deserialization'
        | 'command-not-found'
        | 'permission-denied'
        | 'panic'
        | 'aborted'
        | 'timeout'
        | 'not-in-tauri'
        | 'unknown'
      >()
    }
  })

  it('a mistyped args object at the call site is a type error', async () => {
    const api = createMockClient<AppCommands>({ hello_world: ({ myName }) => `hi ${myName}` })
    // @ts-expect-error - myName must be a string
    await api.helloWorld({ myName: 42 })
  })
})

describe('__mock controller typing (issue #26)', () => {
  it('callsFor only accepts a known wire command name', () => {
    const api = createMockClient<AppCommands>({})
    api.__mock.callsFor('hello_world')
    // @ts-expect-error - not a command in AppCommands
    api.__mock.callsFor('not_a_command')
  })
})

/**
 * Type-level adversarial checks for L6 (issues #24–#25). The runtime tests
 * cover dispatch; these cover the claims the README makes about what the
 * types *prevent* — and the integration claim that a `BinaryCommand` is
 * callable through the ordinary `createClient`, which nothing else tests.
 */
import { describe, expectTypeOf, it } from 'vitest'
import type { BinaryCommand } from '../src/binary.js'
import { createClient } from '../src/client.js'
import type { Command } from '../src/command.js'
import type { RawCommand } from '../src/raw.js'
import { createRawClient } from '../src/raw.js'

type AppCommands = {
  read_file: BinaryCommand<{ path: string }>
  hello_world: Command<{ myName: string }, string>
}

type AppRawCommands = {
  upload: RawCommand<void, string>
}

describe('BinaryCommand flows through the ordinary client (issue #25)', () => {
  it('a BinaryCommand is usable in a hand-written CommandMap and resolves ArrayBuffer', async () => {
    // This is the exact README example. If `BinaryCommand`'s brand made it
    // unassignable to `HandWrittenCommandMap`, the documented usage would not
    // compile at all.
    const api = createClient<AppCommands>()
    const buffer = await api.readFile({ path: '/tmp/x' })
    expectTypeOf(buffer).toEqualTypeOf<ArrayBuffer>()
  })

  it('the binary result is not treated as parsed JSON', async () => {
    const api = createClient<AppCommands>()
    const buffer = await api.readFile({ path: '/tmp/x' })
    // @ts-expect-error - ArrayBuffer has no arbitrary JSON properties
    buffer.someField
  })

  it('a JSON command in the same map keeps its own return type', async () => {
    const api = createClient<AppCommands>()
    expectTypeOf(await api.helloWorld({ myName: 'x' })).toEqualTypeOf<string>()
  })

  it('safe.* on a binary command still yields ArrayBuffer in the ok branch', async () => {
    const api = createClient<AppCommands>()
    const result = await api.safe.readFile({ path: '/tmp/x' })
    if (result.status === 'ok') {
      expectTypeOf(result.data).toEqualTypeOf<ArrayBuffer>()
    }
  })
})

describe('raw vs JSON command confusion is rejected (issue #24)', () => {
  it('a raw command does not accept a JSON args object', async () => {
    const raw = createRawClient<AppRawCommands>()
    // @ts-expect-error - raw commands take a raw body, never a JSON args object
    await raw.upload({ path: '/tmp/x' })
  })

  it('a JSON command does not accept a raw body', async () => {
    const api = createClient<AppCommands>()
    // @ts-expect-error - hello_world takes { myName }, not a Uint8Array
    await api.helloWorld(new Uint8Array([1, 2, 3]))
  })

  it('headers are typed as HeadersInit', async () => {
    const raw = createRawClient<AppRawCommands>()
    await raw.upload(new Uint8Array([1]), { headers: [['Authorization', 'key']] })
    await raw.upload(new Uint8Array([1]), { headers: new Headers() })
    // @ts-expect-error - a number is not a valid HeadersInit
    await raw.upload(new Uint8Array([1]), { headers: 42 })
  })
})

import { describe, expectTypeOf, it } from 'vitest'
import type { Command, CommandMap } from '../src/command.js'
import type { RawCommand, RawCommandErr, RawCommandMap, RawCommandOk } from '../src/raw.js'
import { createRawClient } from '../src/raw.js'

type AppRawCommands = {
  upload: RawCommand<void, string>
}

type AppCommands = {
  hello_world: Command<{ myName: string }, string>
}

describe('RawCommand extractor types (issue #24)', () => {
  it('extracts Ok and Err', () => {
    type C = RawCommand<string, number>
    expectTypeOf<RawCommandOk<C>>().toEqualTypeOf<string>()
    expectTypeOf<RawCommandErr<C>>().toEqualTypeOf<number>()
  })

  it('a RawCommand is not assignable where a Command is expected, and vice versa', () => {
    // @ts-expect-error - RawCommandMap and CommandMap are structurally distinct
    const _asCommandMap: CommandMap = {} as AppRawCommands
    // @ts-expect-error - RawCommandMap and CommandMap are structurally distinct
    const _asRawCommandMap: RawCommandMap = {} as AppCommands
    void _asCommandMap
    void _asRawCommandMap
  })
})

describe('createRawClient call-site typing (issue #24)', () => {
  it('accepts a raw body (ArrayBuffer/Uint8Array/number[]) and rejects a JSON args object', async () => {
    const api = createRawClient<AppRawCommands>()
    await api.upload(new Uint8Array([1, 2, 3]))
    await api.upload(new ArrayBuffer(4))
    await api.upload([1, 2, 3])
    // @ts-expect-error - a raw command does not accept a JSON args object
    await api.upload({ myName: 'x' })
  })

  it('accepts typed headers via options', async () => {
    const api = createRawClient<AppRawCommands>()
    await api.upload(new Uint8Array([1]), { headers: { Authorization: 'key' } })
  })
})

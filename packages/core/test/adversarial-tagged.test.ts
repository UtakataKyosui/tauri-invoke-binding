/**
 * Adversarial suite for the L5 tagged-enum matchers (issue #23). The type
 * signature guarantees exhaustiveness at compile time, but the *values* come
 * off the IPC wire from a Rust binary that may have been rebuilt with a new
 * variant since the TS was compiled — the one case the types cannot cover.
 */
import { describe, expect, it } from 'vitest'
import {
  matchAdjacentlyTagged,
  matchExternallyTagged,
  matchInternallyTagged,
} from '../src/tagged.js'

type Variants = {
  Started: { url: string }
  Finished: undefined
}

const handlers = {
  Started: ({ url }: { url: string }) => `start:${url}`,
  Finished: () => 'done',
}

describe('unknown variant from a newer Rust binary (adversarial)', () => {
  it('externally tagged: reports the offending variant rather than "handler is not a function"', () => {
    expect(() =>
      matchExternallyTagged<Variants, string>({ Cancelled: { reason: 'x' } } as never, handlers),
    ).toThrow(/Cancelled/)
  })

  it('externally tagged: the same applies to an unknown bare-string unit variant', () => {
    expect(() => matchExternallyTagged<Variants, string>('Cancelled' as never, handlers)).toThrow(
      /Cancelled/,
    )
  })

  it('internally tagged: reports the offending variant', () => {
    expect(() =>
      matchInternallyTagged<'event', Variants, string>(
        'event',
        { event: 'Cancelled' } as never,
        handlers,
      ),
    ).toThrow(/Cancelled/)
  })

  it('adjacently tagged: reports the offending variant', () => {
    expect(() =>
      matchAdjacentlyTagged<'event', 'data', Variants, string>(
        'event',
        'data',
        { event: 'Cancelled', data: undefined } as never,
        handlers,
      ),
    ).toThrow(/Cancelled/)
  })
})

describe('payload shapes that are not plain records (adversarial)', () => {
  it('externally tagged: a newtype variant wrapping a string is not mistaken for a unit variant', () => {
    // `{ Error: "boom" }` is an object (newtype variant), not the bare string
    // a unit variant serializes to — the two must not be conflated.
    const result = matchExternallyTagged<{ Error: string }, string>(
      { Error: 'boom' },
      {
        Error: (message) => `err:${message}`,
      },
    )
    expect(result).toBe('err:boom')
  })

  it('externally tagged: a null payload still dispatches to its handler', () => {
    const result = matchExternallyTagged<{ Cleared: null }, string>(
      { Cleared: null },
      {
        Cleared: (payload) => `cleared:${String(payload)}`,
      },
    )
    expect(result).toBe('cleared:null')
  })
})

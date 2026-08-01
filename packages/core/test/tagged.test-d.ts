import { describe, expectTypeOf, it } from 'vitest'
import type { AdjacentlyTagged, ExternallyTagged, InternallyTagged } from '../src/tagged.js'
import {
  matchAdjacentlyTagged,
  matchExternallyTagged,
  matchInternallyTagged,
} from '../src/tagged.js'

type Variants = {
  Started: { url: string; contentLength: number }
  Progress: { chunkLength: number }
  Finished: undefined
}

describe('tagged enum representations narrow correctly (issue #23)', () => {
  it('externally tagged: object-key variants and bare-string unit variants', () => {
    type Ev = ExternallyTagged<Variants>
    expectTypeOf<Ev>().toEqualTypeOf<
      | { readonly Started: Variants['Started'] }
      | { readonly Progress: Variants['Progress'] }
      | 'Finished'
    >()

    const result = matchExternallyTagged<Variants, number>(
      { Started: { url: 'x', contentLength: 1 } } satisfies Ev,
      {
        Started: (p) => {
          expectTypeOf(p).toEqualTypeOf<Variants['Started']>()
          return p.contentLength
        },
        Progress: (p) => {
          expectTypeOf(p).toEqualTypeOf<Variants['Progress']>()
          return p.chunkLength
        },
        Finished: (p) => {
          expectTypeOf(p).toEqualTypeOf<undefined>()
          return 0
        },
      },
    )
    expectTypeOf(result).toEqualTypeOf<number>()
  })

  it('internally tagged: a flat discriminated union keyed by `tag`', () => {
    type Ev = InternallyTagged<'event', Variants>
    matchInternallyTagged<'event', Variants, void>('event', {} as Ev, {
      Started: (p) => {
        expectTypeOf(p.url).toEqualTypeOf<string>()
      },
      Progress: (p) => {
        expectTypeOf(p.chunkLength).toEqualTypeOf<number>()
      },
      Finished: () => undefined,
    })
  })

  it('adjacently tagged: `tag` selects the handler, `content` is the payload', () => {
    type Ev = AdjacentlyTagged<'event', 'data', Variants>
    matchAdjacentlyTagged<'event', 'data', Variants, void>('event', 'data', {} as Ev, {
      Started: (p) => {
        expectTypeOf(p).toEqualTypeOf<Variants['Started']>()
      },
      Progress: (p) => {
        expectTypeOf(p).toEqualTypeOf<Variants['Progress']>()
      },
      Finished: (p) => {
        expectTypeOf(p).toEqualTypeOf<undefined>()
      },
    })
  })

  it('omitting a variant handler is a type error (exhaustiveness)', () => {
    type Ev = ExternallyTagged<Variants>
    // @ts-expect-error - missing the `Finished` handler
    matchExternallyTagged<Variants, void>({} as Ev, {
      Started: () => undefined,
      Progress: () => undefined,
    })
  })
})

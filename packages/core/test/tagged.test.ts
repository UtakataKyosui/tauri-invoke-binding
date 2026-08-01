import { describe, expect, it, vi } from 'vitest'
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

describe('matchExternallyTagged (serde default representation, issue #23)', () => {
  it('dispatches an object-shaped variant to its handler with the payload', () => {
    const handlers = {
      Started: vi.fn((p: Variants['Started']) => `start:${p.url}`),
      Progress: vi.fn((p: Variants['Progress']) => `chunk:${p.chunkLength}`),
      Finished: vi.fn(() => 'done'),
    }
    const result = matchExternallyTagged<Variants, string>(
      { Started: { url: 'https://x', contentLength: 100 } },
      handlers,
    )
    expect(result).toBe('start:https://x')
    expect(handlers.Started).toHaveBeenCalledWith({ url: 'https://x', contentLength: 100 })
    expect(handlers.Progress).not.toHaveBeenCalled()
  })

  it('dispatches a bare-string unit variant with an undefined payload', () => {
    const handlers = {
      Started: vi.fn(),
      Progress: vi.fn(),
      Finished: vi.fn(() => 'done'),
    }
    const result = matchExternallyTagged<Variants, string>('Finished', handlers)
    expect(result).toBe('done')
    expect(handlers.Finished).toHaveBeenCalledWith(undefined)
  })
})

describe('matchInternallyTagged (#[serde(tag = "...")], issue #23)', () => {
  it('dispatches using the tag key on the flat object', () => {
    const handlers = {
      Started: vi.fn((p: Variants['Started']) => `start:${p.url}`),
      Progress: vi.fn((p: Variants['Progress']) => `chunk:${p.chunkLength}`),
      Finished: vi.fn(() => 'done'),
    }
    const result = matchInternallyTagged<'event', Variants, string>(
      'event',
      { event: 'Progress', chunkLength: 42 } as { event: 'Progress'; chunkLength: number },
      handlers,
    )
    expect(result).toBe('chunk:42')
    expect(handlers.Progress).toHaveBeenCalledWith({ event: 'Progress', chunkLength: 42 })
  })
})

describe('matchAdjacentlyTagged (#[serde(tag, content)], issue #23)', () => {
  it('dispatches using the tag key and passes only the content payload', () => {
    const handlers = {
      Started: vi.fn((p: Variants['Started']) => `start:${p.url}`),
      Progress: vi.fn((p: Variants['Progress']) => `chunk:${p.chunkLength}`),
      Finished: vi.fn(() => 'done'),
    }
    const result = matchAdjacentlyTagged<'event', 'data', Variants, string>(
      'event',
      'data',
      { event: 'Started', data: { url: 'https://y', contentLength: 5 } },
      handlers,
    )
    expect(result).toBe('start:https://y')
    expect(handlers.Started).toHaveBeenCalledWith({ url: 'https://y', contentLength: 5 })
  })

  it('dispatches the Finished variant with the content value (undefined here)', () => {
    const handlers = {
      Started: vi.fn(),
      Progress: vi.fn(),
      Finished: vi.fn(() => 'done'),
    }
    const result = matchAdjacentlyTagged<'event', 'data', Variants, string>(
      'event',
      'data',
      { event: 'Finished', data: undefined },
      handlers,
    )
    expect(result).toBe('done')
    expect(handlers.Finished).toHaveBeenCalledWith(undefined)
  })
})

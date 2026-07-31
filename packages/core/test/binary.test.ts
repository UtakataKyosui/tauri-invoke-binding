import { describe, expect, it } from 'vitest'
import { toBlob, toUint8Array } from '../src/binary.js'

describe('binary conversion helpers (issue #25)', () => {
  it('toUint8Array views the buffer bytes', () => {
    const buffer = new Uint8Array([1, 2, 3]).buffer
    const view = toUint8Array(buffer)
    expect(Array.from(view)).toEqual([1, 2, 3])
  })

  it('toBlob wraps the buffer with an optional MIME type', () => {
    const buffer = new Uint8Array([1, 2, 3]).buffer
    const blob = toBlob(buffer, 'application/octet-stream')
    expect(blob.size).toBe(3)
    expect(blob.type).toBe('application/octet-stream')
  })

  it('toBlob works without a MIME type', () => {
    const buffer = new Uint8Array([1]).buffer
    const blob = toBlob(buffer)
    expect(blob.size).toBe(1)
    expect(blob.type).toBe('')
  })
})

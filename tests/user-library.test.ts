/**
 * The personal parts library format (user-made parts, slice 3b). Parts you author live in
 * ~/.chipblocks/user-parts.json so they follow you across projects. This locks the file format: a
 * round-trip preserves parts, a malformed file is rejected with a reason (never half-loaded), a broken
 * individual part is dropped while the rest load, and withPart adds/updates by id (authoring only).
 */
import { describe, expect, test } from 'vitest'
import {
  deserializeUserLibrary,
  serializeUserLibrary,
  USER_LIBRARY_FORMAT,
  USER_LIBRARY_VERSION,
  withPart,
} from '../src/renderer/user-library.ts'
import type { UserPart } from '../src/renderer/user-parts.ts'

const sensor: UserPart = {
  id: 'my_sensor',
  name: 'My Sensor',
  designatorPrefix: 'U',
  pins: [
    { id: 'in', name: 'IN', side: 'left', electrical: 'input' },
    { id: 'out', name: 'OUT', side: 'right', electrical: 'output' },
  ],
}
const poweredIc: UserPart = {
  id: 'my_ic',
  name: 'My IC',
  designatorPrefix: 'U',
  footprintId: 'DIP-8_W7.62mm', // a board footprint must follow the part into the library too (slice 4a)
  pins: [{ id: 'vcc', name: 'VCC', side: 'top', electrical: 'power_in' }],
  parameters: { supply_voltage: { value: { kind: 'scalar', amount: 5, unit: 'V' } } },
}

describe('serialize / deserialize round-trip', () => {
  test('parts survive a write → read round-trip intact', () => {
    const result = deserializeUserLibrary(serializeUserLibrary([sensor, poweredIc]))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.parts).toEqual([sensor, poweredIc])
  })

  test('the serialized file carries the versioned format header', () => {
    const parsed = JSON.parse(serializeUserLibrary([sensor]))
    expect(parsed.format).toBe(USER_LIBRARY_FORMAT)
    expect(parsed.version).toBe(USER_LIBRARY_VERSION)
  })
})

describe('honest rejections + resilient loading', () => {
  test('not JSON → rejected with a reason', () => {
    expect(deserializeUserLibrary('{not json')).toEqual({ ok: false, reason: expect.any(String) })
  })

  test('wrong format → rejected', () => {
    const r = deserializeUserLibrary(JSON.stringify({ format: 'something-else', userParts: [] }))
    expect(r.ok).toBe(false)
  })

  test('a future version → rejected (not guessed at)', () => {
    const r = deserializeUserLibrary(
      JSON.stringify({ format: USER_LIBRARY_FORMAT, version: 999, userParts: [] }),
    )
    expect(r.ok).toBe(false)
  })

  test('a malformed part is dropped; the good ones still load', () => {
    const text = JSON.stringify({
      format: USER_LIBRARY_FORMAT,
      version: USER_LIBRARY_VERSION,
      userParts: [sensor, { id: 'Bad Id', name: 'x', designatorPrefix: 'U', pins: [] }, poweredIc],
    })
    const r = deserializeUserLibrary(text)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.parts).toEqual([sensor, poweredIc])
  })

  test('an empty / missing userParts list loads as no parts', () => {
    const r = deserializeUserLibrary(
      JSON.stringify({ format: USER_LIBRARY_FORMAT, version: USER_LIBRARY_VERSION }),
    )
    expect(r).toEqual({ ok: true, parts: [] })
  })
})

describe('withPart — the library grows by authoring, deduped by id', () => {
  test('adds a new part, keeps the others', () => {
    expect(withPart([sensor], poweredIc)).toEqual([sensor, poweredIc])
  })

  test('re-authoring the same id replaces it (new wins), does not duplicate', () => {
    const edited: UserPart = { ...sensor, designatorPrefix: 'Q' }
    const result = withPart([sensor, poweredIc], edited)
    expect(result).toHaveLength(2)
    expect(result.find((p) => p.id === 'my_sensor')?.designatorPrefix).toBe('Q')
  })
})

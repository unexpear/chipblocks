/**
 * The personal parts library format (user-made parts, slice 3b). Parts you author live in
 * ~/.chipblocks/user-parts.json so they follow you across projects. This locks the file format: a
 * round-trip preserves parts, a malformed file is rejected with a reason (never half-loaded), a broken
 * individual part is dropped while the rest load, and withPart adds/updates by id (authoring only).
 */
import { describe, expect, test } from 'vitest'
import type { BlockData } from '../src/renderer/blocks.ts'
import { NAND2_BLOCK } from '../src/renderer/builtin-blocks.ts'
import type { Footprint } from '../src/renderer/footprint.ts'
import {
  deserializeUserLibrary,
  serializeUserLibrary,
  USER_LIBRARY_FORMAT,
  USER_LIBRARY_VERSION,
  withFootprint,
  withPart,
} from '../src/renderer/user-library.ts'
import { userPartFromBlock } from '../src/renderer/user-part-draft.ts'
import type { UserPart } from '../src/renderer/user-parts.ts'
import { opampPart } from './drawn-symbol-fixture.ts'

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
    expect(r).toEqual({ ok: true, parts: [], footprints: [] })
  })
})

describe('the library also carries the footprints you draw', () => {
  const qfn: Footprint = {
    id: 'TEST_LIB_QFN',
    name: 'Library QFN',
    description: '',
    pads: [
      {
        id: '1',
        center: { x: -1, y: 0 },
        size: { w: 0.5, h: 0.3 },
        shape: 'rect',
        type: 'smd',
      },
    ],
    silkscreen: [],
    fabrication: [],
    labels: { reference: { x: 0, y: -2 }, value: { x: 0, y: 2 }, fabReference: { x: 0, y: 0 } },
    courtyard: { x: -2, y: -1, w: 4, h: 2 },
    provenance: {
      source_type: 'datasheet',
      title: 'A datasheet',
      citation: 'package drawing',
      confidence: 'high',
    },
  }

  test('a drawn footprint survives a write → read round-trip', () => {
    const r = deserializeUserLibrary(serializeUserLibrary([sensor], [qfn]))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.footprints).toEqual([qfn])
  })

  test('a v1 library (parts only) still loads, just with no footprints', () => {
    // Someone's existing library was written before footprints existed — it must not be refused.
    const v1 = JSON.stringify({ format: USER_LIBRARY_FORMAT, version: 1, userParts: [sensor] })
    const r = deserializeUserLibrary(v1)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parts).toEqual([sensor])
    expect(r.footprints).toEqual([])
    // and it is written back in the current format, so the next save can hold footprints
    expect(JSON.parse(serializeUserLibrary(r.parts, r.footprints)).version).toBe(
      USER_LIBRARY_VERSION,
    )
  })

  test('a malformed footprint is dropped; the parts still load', () => {
    const text = JSON.stringify({
      format: USER_LIBRARY_FORMAT,
      version: USER_LIBRARY_VERSION,
      userParts: [sensor],
      userFootprints: [{ ...qfn, pads: [] }], // nothing to solder to
    })
    const r = deserializeUserLibrary(text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parts).toEqual([sensor])
    expect(r.footprints).toEqual([])
  })

  test('withFootprint replaces by id and keeps the others', () => {
    const other = { ...qfn, id: 'TEST_LIB_OTHER' }
    const list = withFootprint([qfn, other], { ...qfn, name: 'Redrawn' })
    expect(list).toHaveLength(2)
    expect(list.find((f) => f.id === qfn.id)?.name).toBe('Redrawn')
    expect(list.find((f) => f.id === other.id)).toBeDefined()
  })

  test('saving a PART carries the footprints through untouched', () => {
    // The two authoring paths share one file. A part save that wrote only parts would silently delete
    // every package the user had drawn.
    const start = deserializeUserLibrary(serializeUserLibrary([sensor], [qfn]))
    expect(start.ok).toBe(true)
    if (!start.ok) return
    const afterPartSave = serializeUserLibrary(withPart(start.parts, poweredIc), start.footprints)
    const r = deserializeUserLibrary(afterPartSave)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parts.map((p) => p.id).sort()).toEqual([sensor.id, poweredIc.id].sort())
    expect(r.footprints).toEqual([qfn])
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

describe('a drawn symbol follows its part through the personal library (v3)', () => {
  test('the drawing and the datasheet survive a write → read round-trip', () => {
    const drawn = opampPart({ datasheet: 'https://example.com/opamp.pdf' })
    const r = deserializeUserLibrary(serializeUserLibrary([sensor, drawn]))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.parts).toEqual([sensor, drawn])
  })

  test('the library is written as v4 — older builds refuse it rather than erasing metadata', () => {
    // A v2 build would drop the unknown `symbol` field on read, and a library save rewrites the whole
    // file from that read. Refusing the whole file (and so never overwriting it) is what keeps the
    // drawings: persistAuthoredPart never writes over a library it could not read.
    expect(USER_LIBRARY_VERSION).toBe(4)
    expect(JSON.parse(serializeUserLibrary([opampPart()])).version).toBe(4)
  })

  test('a v2 library (parts + footprints, no drawings) still loads', () => {
    const v2 = JSON.stringify({ format: USER_LIBRARY_FORMAT, version: 2, userParts: [sensor] })
    const r = deserializeUserLibrary(v2)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.parts).toEqual([sensor])
  })
})

describe('versioned reusable circuits in the personal library', () => {
  test.each([1, 2, 3])('migrates library version %i without losing existing parts', (version) => {
    const loaded = deserializeUserLibrary(
      JSON.stringify({ format: USER_LIBRARY_FORMAT, version, userParts: [sensor] }),
    )
    if (!loaded.ok) throw new Error(loaded.reason)
    expect(loaded.parts).toEqual([sensor])
    expect(JSON.parse(serializeUserLibrary(loaded.parts)).version).toBe(4)
  })

  test('preserves typed contracts and runnable tests through a library rewrite', () => {
    const savedTest = {
      id: 'both-high',
      name: 'Both high',
      cycles: 2,
      inputs: { a: 1, b: 1 },
      expected: { out: [0, 0] },
    }
    const block: BlockData = {
      ...NAND2_BLOCK,
      ports: NAND2_BLOCK.ports.map((port) =>
        port.id === 'a'
          ? { ...port, domain: 'electrical', direction: 'input', unit: 'volt' }
          : port,
      ),
      tests: [savedTest],
    }
    const drafted = userPartFromBlock('Portable NAND', 'U', block)
    if (!drafted.ok) throw new Error(drafted.error)
    const before = structuredClone(drafted.part)
    const loaded = deserializeUserLibrary(serializeUserLibrary([drafted.part]))
    if (!loaded.ok) throw new Error(loaded.reason)
    const rewritten = deserializeUserLibrary(serializeUserLibrary(withPart(loaded.parts, sensor)))
    if (!rewritten.ok) throw new Error(rewritten.reason)
    const internal = rewritten.parts.find((part) => part.id === drafted.part.id)?.internal
    expect(internal?.version).toBe(1)
    expect(internal?.tests).toEqual([savedTest])
    expect(internal?.ports.find((port) => port.id === 'a')).toMatchObject({
      domain: 'electrical',
      direction: 'input',
      unit: 'volt',
    })
    expect(drafted.part).toEqual(before)
    expect(() =>
      serializeUserLibrary([
        { ...drafted.part, internal: { ...block, version: 2 } as unknown as BlockData },
      ]),
    ).toThrow('Unsupported block format')
  })
})

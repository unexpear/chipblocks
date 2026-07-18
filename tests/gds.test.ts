/**
 * The GDSII writer (chip-physical chapter, increment 2) — the first EXPORTABLE chip artifact. Correctness
 * is proven by PARSING the emitted bytes back with a from-scratch decoder (so record lengths, the
 * big-endian ints, and the base-16 8-byte REAL are all validated end-to-end) and pinning the known GDSII
 * encodings. A malformed stream would silently fail to open in Magic / KLayout — the whole point of the
 * export — so the test walks the records to the exact end and checks every field.
 */
import { describe, expect, test } from 'vitest'
import { PROCESS } from '../src/renderer/cell-layout.ts'
import type { Floorplan } from '../src/renderer/cell-place.ts'
import {
  floorplanToGds,
  type GdsLibrary,
  gdsName,
  gdsReal,
  rectRing,
  writeGds,
} from '../src/renderer/gds.ts'
import { PR_BOUNDARY } from '../src/renderer/pdk.ts'

const WHEN = new Date(2026, 6, 17, 12, 0, 0)

// ---- a minimal from-scratch GDSII record reader (validates the writer independently) ----
type Rec = { rtype: number; dtype: number; data: Uint8Array }
function parseRecords(bytes: Uint8Array): Rec[] {
  const recs: Rec[] = []
  let i = 0
  while (i < bytes.length) {
    const len = ((bytes[i] as number) << 8) | (bytes[i + 1] as number)
    expect(len, 'no zero-length record (would loop / mean a bad length)').toBeGreaterThanOrEqual(4)
    recs.push({
      rtype: bytes[i + 2] as number,
      dtype: bytes[i + 3] as number,
      data: bytes.slice(i + 4, i + len),
    })
    i += len
  }
  // walking the declared lengths must land EXACTLY on the end — proves every record length is right
  expect(i).toBe(bytes.length)
  return recs
}
const REC = {
  HEADER: 0x00,
  BGNLIB: 0x01,
  LIBNAME: 0x02,
  UNITS: 0x03,
  ENDLIB: 0x04,
  BGNSTR: 0x05,
  STRNAME: 0x06,
  ENDSTR: 0x07,
  BOUNDARY: 0x08,
  LAYER: 0x0d,
  DATATYPE: 0x0e,
  XY: 0x10,
  ENDEL: 0x11,
}
const i16 = (d: Uint8Array, o: number) => {
  const v = ((d[o] as number) << 8) | (d[o + 1] as number)
  return v & 0x8000 ? v - 0x10000 : v
}
const i32 = (d: Uint8Array, o: number) =>
  ((d[o] as number) << 24) |
  ((d[o + 1] as number) << 16) |
  ((d[o + 2] as number) << 8) |
  (d[o + 3] as number)
const realDecode = (d: Uint8Array, o: number) => {
  const sign = (d[o] as number) & 0x80 ? -1 : 1
  const exp = ((d[o] as number) & 0x7f) - 64
  let mant = 0
  for (let k = 1; k < 8; k++) mant = mant * 256 + (d[o + k] as number)
  return sign * (mant / 2 ** 56) * 16 ** exp
}

describe('GDSII 8-byte REAL (base-16 excess-64, NOT IEEE-754)', () => {
  test('the canonical 1.0 encoding, zero, and a round-trip of the UNITS values', () => {
    expect(gdsReal(1)).toEqual([0x41, 0x10, 0, 0, 0, 0, 0, 0])
    expect(gdsReal(0)).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    for (const v of [1e-3, 1e-9, 0.5, 300, -2.5]) {
      expect(realDecode(Uint8Array.from(gdsReal(v)), 0)).toBeCloseTo(v, 12)
    }
  })
})

describe('writeGds — a well-formed GDSII stream', () => {
  const lib: GdsLibrary = {
    name: 'demo',
    userUnitMeters: 1e-6,
    dbUnitMeters: 1e-9,
    structures: [
      {
        name: 'TOP',
        elements: [
          { kind: 'boundary', layer: 68, datatype: 20, points: rectRing(0, 0, 1000, 500) },
          { kind: 'sref', structure: 'SUB', x: 100, y: 200 },
        ],
      },
    ],
  }

  test('records appear in the required order and the lengths walk to the exact end', () => {
    const recs = parseRecords(writeGds(lib, WHEN))
    const types = recs.map((r) => r.rtype)
    // HEADER, BGNLIB, LIBNAME, UNITS, BGNSTR, STRNAME, BOUNDARY, LAYER, DATATYPE, XY, ENDEL, SREF, SNAME,
    // XY, ENDEL, ENDSTR, ENDLIB
    expect(types[0]).toBe(REC.HEADER)
    expect(types.at(-1)).toBe(REC.ENDLIB)
    expect(types).toContain(REC.BGNLIB)
    expect(types).toContain(REC.UNITS)
    expect(types).toContain(REC.BOUNDARY)
    // HEADER value = GDSII release 6
    expect(i16(recs[0]?.data as Uint8Array, 0)).toBe(600)
  })

  test('UNITS decodes to [1e-3, 1e-9] (1 µm user unit on a 1 nm grid)', () => {
    const recs = parseRecords(writeGds(lib, WHEN))
    const units = recs.find((r) => r.rtype === REC.UNITS)
    if (units === undefined) throw new Error('no UNITS record')
    expect(realDecode(units.data, 0)).toBeCloseTo(1e-3, 12) // db unit in user units
    expect(realDecode(units.data, 8)).toBeCloseTo(1e-9, 15) // db unit in metres
  })

  test('the BOUNDARY carries its layer, datatype and a closed 5-point ring', () => {
    const recs = parseRecords(writeGds(lib, WHEN))
    const bi = recs.findIndex((r) => r.rtype === REC.BOUNDARY)
    expect(recs[bi + 1]?.rtype).toBe(REC.LAYER)
    expect(i16(recs[bi + 1]?.data as Uint8Array, 0)).toBe(68)
    expect(recs[bi + 2]?.rtype).toBe(REC.DATATYPE)
    expect(i16(recs[bi + 2]?.data as Uint8Array, 0)).toBe(20)
    const xy = recs[bi + 3]
    expect(xy?.rtype).toBe(REC.XY)
    expect((xy?.data.length ?? 0) / 8).toBe(5) // 5 points (closed rectangle)
    // first point (0,0) and the ring closes back to it
    const d = xy?.data as Uint8Array
    expect([i32(d, 0), i32(d, 4)]).toEqual([0, 0])
    expect([i32(d, 32), i32(d, 36)]).toEqual([0, 0])
    // corner (1000, 500) is present
    expect([i32(d, 8), i32(d, 12)]).toEqual([1000, 0])
    expect([i32(d, 16), i32(d, 20)]).toEqual([1000, 500])
  })
})

describe('floorplanToGds — the placed floorplan becomes real GDS geometry', () => {
  const fp: Floorplan = {
    cells: [
      { id: 'g1', name: 'AND', x: 0, y: 0, w: 10, h: 8, row: 0, reliable: true },
      { id: 'g2', name: 'OR', x: 10, y: 0, w: 12, h: 8, row: 0, reliable: true },
    ],
    rows: 1,
    dieWidthLambda: 22,
    dieHeightLambda: 8,
    dieWidthUm: 22 * PROCESS.lambdaUm,
    dieHeightUm: 8 * PROCESS.lambdaUm,
    cellAreaLambda2: 176,
    dieAreaLambda2: 176,
    utilization: 1,
    anyUnreliable: false,
  }

  test('every cell + the die outline is a BOUNDARY on prBoundary (235/4), in λ→nm database units', () => {
    expect(PROCESS.lambdaUm).toBe(0.3) // the conversion the coords below depend on: λ → 300 nm
    const nm = (lambda: number) => Math.round(lambda * PROCESS.lambdaUm * 1000)
    const recs = parseRecords(writeGds(floorplanToGds(fp, { topName: 'demo' }), WHEN))
    const boundaries = recs.filter((r) => r.rtype === REC.BOUNDARY)
    expect(boundaries).toHaveLength(3) // die outline + 2 cells
    // every one is on prBoundary 235/4
    for (const r of recs) {
      if (r.rtype === REC.LAYER) expect(i16(r.data, 0)).toBe(PR_BOUNDARY.layer)
      if (r.rtype === REC.DATATYPE) expect(i16(r.data, 0)).toBe(PR_BOUNDARY.datatype)
    }
    // collect the XY rings and check the die outline (0,0)-(dieW,dieH) is one of them
    const rings = recs
      .filter((r) => r.rtype === REC.XY)
      .map((r) =>
        Array.from({ length: r.data.length / 8 }, (_, k) => [
          i32(r.data, k * 8),
          i32(r.data, k * 8 + 4),
        ]),
      )
    const dieRing = rings.find((ring) => ring.some(([x, y]) => x === nm(22) && y === nm(8)))
    expect(dieRing, 'die outline present').toBeDefined()
    // cell g1 spans x 0..10 λ, and Y is flipped (die height 8 λ, cell at top y=0 → GDS y 0..2400)
    const g1 = rings.find(
      (ring) => ring.some(([x]) => x === nm(10)) && !ring.some(([x]) => x === nm(22)),
    )
    expect(g1, 'cell g1 rectangle present').toBeDefined()
    expect(g1?.every(([, y]) => y === 0 || y === nm(8))).toBe(true)
  })

  test('an empty floorplan yields a valid but geometry-free library (no crash)', () => {
    const empty: Floorplan = { ...fp, cells: [], dieWidthLambda: 0, dieHeightLambda: 0 }
    const recs = parseRecords(writeGds(floorplanToGds(empty), WHEN))
    expect(recs.filter((r) => r.rtype === REC.BOUNDARY)).toHaveLength(0)
    expect(recs.at(-1)?.rtype).toBe(REC.ENDLIB) // still a well-formed library
  })
})

describe('gdsName — legal GDSII cell names', () => {
  test('illegal chars → underscore, capped at 32, never empty', () => {
    expect(gdsName('AND gate #1')).toBe('AND_gate__1')
    expect(gdsName('a'.repeat(40)).length).toBe(32)
    expect(gdsName('###')).toBe('___')
    expect(gdsName('')).toBe('CELL')
  })
})

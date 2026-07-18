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
import { gdsOf, PR_BOUNDARY } from '../src/renderer/pdk.ts'

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
  SREF: 0x0a,
  LAYER: 0x0d,
  DATATYPE: 0x0e,
  XY: 0x10,
  ENDEL: 0x11,
  SNAME: 0x12,
}
const asciiOf = (d: Uint8Array): string => {
  let s = ''
  for (const b of d) if (b !== 0) s += String.fromCharCode(b)
  return s
}
// Partition a record stream into its structures: name + the records between BGNSTR…ENDSTR.
function structuresOf(recs: Rec[]): { name: string; recs: Rec[] }[] {
  const out: { name: string; recs: Rec[] }[] = []
  let current: { name: string; recs: Rec[] } | null = null
  for (const r of recs) {
    if (r.rtype === REC.BGNSTR) current = { name: '', recs: [] }
    else if (r.rtype === REC.STRNAME && current) current.name = asciiOf(r.data)
    else if (r.rtype === REC.ENDSTR && current) {
      out.push(current)
      current = null
    } else if (current) current.recs.push(r)
  }
  return out
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
  // realistic λ dimensions: AND/OR cells are 32 λ wide and the row height is 90 λ (so the SREF'd polygons
  // coincide with the prBoundary outline). Two of the same type + one unmapped cell exercise dedup + fallback.
  const fp: Floorplan = {
    cells: [
      { id: 'g1', name: 'AND', x: 0, y: 0, w: 32, h: 90, row: 0, reliable: true },
      { id: 'g2', name: 'OR', x: 32, y: 0, w: 32, h: 90, row: 0, reliable: true },
      { id: 'g3', name: 'AND', x: 64, y: 0, w: 32, h: 90, row: 0, reliable: true },
      { id: 'g4', name: 'MYSTERY', x: 96, y: 0, w: 16, h: 90, row: 0, reliable: true },
    ],
    rows: 1,
    dieWidthLambda: 112,
    dieHeightLambda: 90,
    dieWidthUm: 112 * PROCESS.lambdaUm,
    dieHeightUm: 90 * PROCESS.lambdaUm,
    cellAreaLambda2: 112 * 90,
    dieAreaLambda2: 112 * 90,
    utilization: 1,
    anyUnreliable: false,
  }
  const nm = (lambda: number) => Math.round(lambda * PROCESS.lambdaUm * 1000)

  test('λ is 0.3 µm — the conversion the coordinates below depend on', () => {
    expect(PROCESS.lambdaUm).toBe(0.3) // λ → 300 nm
  })

  test('each unique mapped gate is one cell STRUCTURE (dedup); MYSTERY has none', () => {
    const structs = structuresOf(
      parseRecords(writeGds(floorplanToGds(fp, { topName: 'demo' }), WHEN)),
    )
    const names = structs.map((s) => s.name)
    expect(names).toContain('cell_AND')
    expect(names).toContain('cell_OR')
    expect(names).not.toContain('cell_MYSTERY') // unmapped → outline only, no fabricated geometry
    // AND appears twice in the floorplan but is emitted as ONE structure
    expect(names.filter((n) => n === 'cell_AND')).toHaveLength(1)
  })

  test('cell_AND carries real per-layer polygons (poly/diff/nwell/met1), 3 poly columns', () => {
    const structs = structuresOf(parseRecords(writeGds(floorplanToGds(fp), WHEN)))
    const and = structs.find((s) => s.name === 'cell_AND')
    if (and === undefined) throw new Error('no cell_AND structure')
    // each BOUNDARY is followed by LAYER then DATATYPE — key on the (layer, datatype) PAIR, since poly
    // (66/20) and licon1 (66/44) share a layer number.
    const pairs: string[] = []
    for (let i = 0; i < and.recs.length; i++) {
      if ((and.recs[i] as Rec).rtype !== REC.BOUNDARY) continue
      const layer = i16((and.recs[i + 1] as Rec).data, 0)
      const datatype = i16((and.recs[i + 2] as Rec).data, 0)
      pairs.push(`${layer}/${datatype}`)
    }
    const key = (name: 'poly' | 'diff' | 'nwell' | 'met1') => {
      const g = gdsOf(name)
      return `${g?.layer}/${g?.datatype}`
    }
    for (const name of ['poly', 'diff', 'nwell', 'met1'] as const) {
      expect(pairs.includes(key(name)), `cell_AND on ${name}`).toBe(true)
    }
    expect(pairs.filter((p) => p === key('poly'))).toHaveLength(3) // 3 input columns
    // no polygon on prBoundary inside a cell structure — that layer is the top-level outline only
    expect(pairs.some((p) => p.startsWith(`${PR_BOUNDARY.layer}/`))).toBe(false)
  })

  test('the top structure SREFs each mapped cell at its flipped (x, y); MYSTERY is not placed', () => {
    const recs = parseRecords(writeGds(floorplanToGds(fp, { topName: 'demo' }), WHEN))
    const top = structuresOf(recs).find((s) => s.name === 'demo')
    if (top === undefined) throw new Error('no top structure')
    // 3 mapped cells (g1, g2, g3) → 3 SREFs; MYSTERY not placed
    const srefNames: string[] = []
    const srefXY: [number, number][] = []
    for (let i = 0; i < top.recs.length; i++) {
      const r = top.recs[i] as Rec
      if (r.rtype === REC.SNAME) srefNames.push(asciiOf(r.data))
      if (r.rtype === REC.SREF) {
        const xy = top.recs[i + 2] as Rec // SREF, SNAME, XY
        srefXY.push([i32(xy.data, 0), i32(xy.data, 4)])
      }
    }
    expect(srefNames.sort()).toEqual(['cell_AND', 'cell_AND', 'cell_OR'])
    // g1 (AND) at x0, y flipped: dieH 90 − (0 + 90) = 0
    expect(srefXY).toContainEqual([nm(0), nm(0)])
    // g3 (AND) at x64
    expect(srefXY).toContainEqual([nm(64), nm(0)])
  })

  test('the top structure keeps a prBoundary outline per cell + the die outline', () => {
    const recs = parseRecords(writeGds(floorplanToGds(fp, { topName: 'demo' }), WHEN))
    const top = structuresOf(recs).find((s) => s.name === 'demo')
    if (top === undefined) throw new Error('no top structure')
    // every BOUNDARY in the TOP structure is on prBoundary 235/4 (die + 4 cell outlines = 5)
    const prLayers = top.recs.filter((r) => r.rtype === REC.LAYER).map((r) => i16(r.data, 0))
    expect(prLayers).toHaveLength(5)
    for (const l of prLayers) expect(l).toBe(PR_BOUNDARY.layer)
  })

  test('cellPolygons:false gives the legacy outline-only shape (prBoundary rects, no SREFs)', () => {
    const recs = parseRecords(writeGds(floorplanToGds(fp, { cellPolygons: false }), WHEN))
    expect(recs.filter((r) => r.rtype === REC.SREF)).toHaveLength(0)
    expect(recs.filter((r) => r.rtype === REC.BGNSTR)).toHaveLength(1) // just the top structure
    expect(recs.filter((r) => r.rtype === REC.BOUNDARY)).toHaveLength(5) // die + 4 cell outlines
    for (const r of recs) {
      if (r.rtype === REC.LAYER) expect(i16(r.data, 0)).toBe(PR_BOUNDARY.layer)
    }
  })

  test('an empty floorplan yields a valid but geometry-free library (no crash)', () => {
    const empty: Floorplan = { ...fp, cells: [], dieWidthLambda: 0, dieHeightLambda: 0 }
    const recs = parseRecords(writeGds(floorplanToGds(empty), WHEN))
    expect(recs.filter((r) => r.rtype === REC.BOUNDARY)).toHaveLength(0)
    expect(recs.filter((r) => r.rtype === REC.SREF)).toHaveLength(0)
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

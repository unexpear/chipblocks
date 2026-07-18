/**
 * The OASIS writer (chip-physical chapter, step 6b) — validated by PARSING the emitted bytes back with a
 * from-scratch decoder, the same rigor as the GDSII writer's test. Because OASIS records have no length
 * header (unlike GDSII), the decoder walking to the EXACT end is the thing that catches a wrong field
 * count, and the modal-variable reuse is pinned by decoding a rectangle that omits its layer/size.
 */
import { describe, expect, test } from 'vitest'
import { PROCESS } from '../src/renderer/cell-layout.ts'
import type { Floorplan } from '../src/renderer/cell-place.ts'
import { cellToStructure } from '../src/renderer/gds.ts'
import { floorplanToOasis, type OasisLayout, oasisName, writeOasis } from '../src/renderer/oasis.ts'
import { gdsOf, PR_BOUNDARY } from '../src/renderer/pdk.ts'

const MAGIC = [0x25, 0x53, 0x45, 0x4d, 0x49, 0x2d, 0x4f, 0x41, 0x53, 0x49, 0x53, 0x0d, 0x0a]

// ---- a minimal from-scratch OASIS decoder (validates the writer independently) ----
type Rect = {
  cell: string
  layer: number
  datatype: number
  w: number
  h: number
  x: number
  y: number
  info: number
}
type Placement = { cell: string; x: number; y: number; info: number }
type Parsed = {
  version: string
  unitPerMicron: number
  cells: Map<string, Rect[]>
  cellDefs: string[] // raw id-14 CELL names in file order — a Map collapses duplicates, so keep the sequence
  placements: Map<string, Placement[]>
  endLength: number
  cursor: number
}

type Cur = { i: number }
const readUInt = (b: Uint8Array, c: Cur): number => {
  let value = 0
  let shift = 1
  for (;;) {
    const byte = b[c.i] as number
    c.i += 1
    value += (byte & 0x7f) * shift
    if ((byte & 0x80) === 0) break
    shift *= 128
  }
  return value
}
const readSInt = (b: Uint8Array, c: Cur): number => {
  const u = readUInt(b, c)
  const mag = Math.floor(u / 2)
  return u & 1 ? -mag : mag
}
const readString = (b: Uint8Array, c: Cur): string => {
  const len = readUInt(b, c)
  let s = ''
  for (let i = 0; i < len; i++) s += String.fromCharCode(b[c.i + i] as number)
  c.i += len
  return s
}

function parseOasis(bytes: Uint8Array): Parsed {
  for (let i = 0; i < MAGIC.length; i++) expect(bytes[i], `magic byte ${i}`).toBe(MAGIC[i])
  const c: Cur = { i: MAGIC.length }
  expect(readUInt(bytes, c), 'START id').toBe(1)
  const version = readString(bytes, c)
  expect(readUInt(bytes, c), 'unit real type').toBe(0)
  const unitPerMicron = readUInt(bytes, c)
  expect(readUInt(bytes, c), 'offset-flag').toBe(0)
  for (let i = 0; i < 12; i++) expect(readUInt(bytes, c), `table offset ${i}`).toBe(0)

  const cells = new Map<string, Rect[]>()
  const cellDefs: string[] = []
  const placements = new Map<string, Placement[]>()
  let cell = ''
  let mLayer = 0
  let mDatatype = 0
  let mW = 0
  let mH = 0
  let endLength = 0
  for (;;) {
    const recStart = c.i
    const id = readUInt(bytes, c)
    if (id === 14) {
      cell = readString(bytes, c)
      cellDefs.push(cell)
      cells.set(cell, [])
      placements.set(cell, [])
      mLayer = 0
      mDatatype = 0
      mW = 0
      mH = 0
    } else if (id === 15) {
      // XYABSOLUTE — no operands
    } else if (id === 17) {
      const info = bytes[c.i] as number
      c.i += 1
      const pcell = readString(bytes, c) // C=1 N=0 → explicit cell-name string
      const px = readSInt(bytes, c) // X=1 → signed x
      const py = readSInt(bytes, c) // Y=1 → signed y
      ;(placements.get(cell) as Placement[]).push({ cell: pcell, x: px, y: py, info })
    } else if (id === 20) {
      const info = bytes[c.i] as number
      c.i += 1
      if (info & 0x01) mLayer = readUInt(bytes, c)
      if (info & 0x02) mDatatype = readUInt(bytes, c)
      if (info & 0x40) mW = readUInt(bytes, c)
      if (info & 0x20) mH = readUInt(bytes, c)
      const x = readSInt(bytes, c)
      const y = readSInt(bytes, c)
      ;(cells.get(cell) as Rect[]).push({
        cell,
        layer: mLayer,
        datatype: mDatatype,
        w: mW,
        h: mH,
        x,
        y,
        info,
      })
    } else if (id === 2) {
      readString(bytes, c) // padding b-string
      expect(readUInt(bytes, c), 'validation-scheme').toBe(0)
      endLength = c.i - recStart
      break
    } else {
      throw new Error(`unknown OASIS record id ${id}`)
    }
  }
  return { version, unitPerMicron, cells, cellDefs, placements, endLength, cursor: c.i }
}

describe('OASIS primitives (base-128 varints + modal encoding)', () => {
  // exercise the encoders indirectly through a hand-built layout so the pinned bytes are exact
  test('a hand-built layout round-trips, pinning the START, modal reuse, and the 256-byte END', () => {
    const layout: OasisLayout = {
      unitPerMicron: 1000,
      cells: [
        {
          name: 'TOP',
          rects: [
            { layer: 68, datatype: 20, x: 0, y: 0, w: 1000, h: 500 },
            { layer: 68, datatype: 20, x: 100, y: 200, w: 1000, h: 500 },
          ],
        },
      ],
    }
    const bytes = writeOasis(layout)
    const p = parseOasis(bytes)
    expect(p.version).toBe('1.0')
    expect(p.unitPerMicron).toBe(1000)
    const rects = p.cells.get('TOP') as Rect[]
    expect(rects).toHaveLength(2)
    // first rectangle forces every field: info-byte 0x7B (W|H|X|Y|D|L)
    expect(rects[0]?.info).toBe(0x7b)
    expect(rects[0]).toMatchObject({ layer: 68, datatype: 20, w: 1000, h: 500, x: 0, y: 0 })
    // second reuses layer/datatype/w/h via modal variables: info-byte 0x18 (X|Y only)
    expect(rects[1]?.info).toBe(0x18)
    expect(rects[1]).toMatchObject({ layer: 68, datatype: 20, w: 1000, h: 500, x: 100, y: 200 })
    // the decode lands EXACTLY on the end — the OASIS analog of walking record lengths to the exact end
    expect(p.cursor).toBe(bytes.length)
    expect(p.endLength).toBe(256)
  })
})

describe('floorplanToOasis — the placed floorplan becomes OASIS geometry', () => {
  const nm = (lambda: number) => Math.round(lambda * PROCESS.lambdaUm * 1000)
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

  test('λ is 0.3 µm — the conversion the coordinates below depend on', () => {
    expect(PROCESS.lambdaUm).toBe(0.3)
  })

  // canonical (layer/datatype/x/y/w/h) multiset — for comparing an OASIS cell to a GDS structure
  const canonRects = (
    rects: { layer: number; datatype: number; x: number; y: number; w: number; h: number }[],
  ) => rects.map((r) => `${r.layer}/${r.datatype} ${r.x},${r.y} ${r.w}x${r.h}`).sort()

  test('hierarchical: a top cell + one cell per gate type, placed by reference (MYSTERY unmapped)', () => {
    const bytes = writeOasis(floorplanToOasis(fp, { topName: 'demo' }))
    const p = parseOasis(bytes)
    // the top cell + a cell per UNIQUE mapped gate — AND appears twice but is DEFINED once (dedup); the
    // unmapped MYSTERY gets no cell of its own.
    expect(p.cells.has('demo')).toBe(true)
    expect(p.cells.has('cell_AND')).toBe(true)
    expect(p.cells.has('cell_OR')).toBe(true)
    expect(p.cells.has('cell_MYSTERY')).toBe(false)
    expect(p.cells.size).toBe(3) // demo + cell_AND + cell_OR
    // dedup pinned against the RAW id-14 sequence — a Map would silently collapse a duplicate CELL record,
    // so a dropped `seen` guard (emitting cell_AND twice — invalid OASIS) must fail HERE, not pass green.
    expect(p.cellDefs).toHaveLength(3)
    expect(p.cellDefs.filter((n) => n === 'cell_AND')).toHaveLength(1)
    expect(new Set(p.cellDefs).size).toBe(p.cellDefs.length) // no cell name defined twice

    // the TOP holds only the die + one prBoundary outline per placed cell (all 4, mapped or not) — no silicon
    const topRects = p.cells.get('demo') as Rect[]
    expect(topRects).toHaveLength(5) // die + 4 cell outlines
    for (const r of topRects) expect(r.layer).toBe(PR_BOUNDARY.layer)
    // the die is the first rect: full size at the origin
    expect(topRects[0]).toMatchObject({
      layer: 235,
      datatype: 4,
      x: 0,
      y: 0,
      w: nm(112),
      h: nm(90),
    })
    // the first cell outline reuses layer+datatype+height via modal (info 0x58 = W|X|Y)
    expect(topRects[1]?.info).toBe(0x58)
    expect(topRects[1]).toMatchObject({ layer: 235, datatype: 4, w: nm(32), h: nm(90) })

    // one PLACEMENT per MAPPED instance (AND, OR, AND — MYSTERY has none): 3 refs, 2 to cell_AND
    const places = p.placements.get('demo') as Placement[]
    expect(places).toHaveLength(3)
    expect(places.map((q) => q.cell).sort()).toEqual(['cell_AND', 'cell_AND', 'cell_OR'])
    for (const q of places) expect(q.info).toBe(0xb0) // C|X|Y, no flip
    // the placement origins are the cell's flipped bottom-left — g1 at x0/top, g3 at x=64
    expect(places[0]).toMatchObject({ cell: 'cell_AND', x: nm(0), y: nm(0) })
    expect(places[2]).toMatchObject({ cell: 'cell_AND', x: nm(64), y: nm(0) })

    // the GATE cell carries the real silicon polygons, cell-local — and is byte-for-byte the SAME geometry
    // the GDS hierarchy emits for that gate (cellToStructure), proving the two writers agree.
    const andCell = p.cells.get('cell_AND') as Rect[]
    const pairs = new Set(andCell.map((r) => `${r.layer}/${r.datatype}`))
    for (const name of ['poly', 'diff', 'nwell', 'met1'] as const) {
      const g = gdsOf(name)
      expect(pairs.has(`${g?.layer}/${g?.datatype}`), name).toBe(true)
    }
    const gdsAnd = cellToStructure('AND')
    const gdsRects = (gdsAnd?.elements ?? []).flatMap((el) => {
      if (el.kind !== 'boundary') return []
      const xs = el.points.map((pt) => pt.x)
      const ys = el.points.map((pt) => pt.y)
      const x = Math.min(...xs)
      const y = Math.min(...ys)
      return [
        {
          layer: el.layer,
          datatype: el.datatype,
          x,
          y,
          w: Math.max(...xs) - x,
          h: Math.max(...ys) - y,
        },
      ]
    })
    expect(canonRects(andCell)).toEqual(canonRects(gdsRects))

    expect(p.cursor).toBe(bytes.length)
    expect(p.endLength).toBe(256)
  })

  test('cellPolygons:false gives the top outline shell only (5 prBoundary rects, no gate cells)', () => {
    const p = parseOasis(writeOasis(floorplanToOasis(fp, { cellPolygons: false })))
    expect([...p.cells.keys()]).toEqual(['chipblocks_top'])
    const rects = p.cells.get('chipblocks_top') as Rect[]
    expect(rects).toHaveLength(5)
    for (const r of rects) expect(r.layer).toBe(PR_BOUNDARY.layer)
    // outline-only ⇒ no placements either
    expect(p.placements.get('chipblocks_top')).toHaveLength(0)
  })

  test('an empty floorplan yields a valid file: one cell, zero rectangles, END 256', () => {
    const empty: Floorplan = { ...fp, cells: [], dieWidthLambda: 0, dieHeightLambda: 0 }
    const bytes = writeOasis(floorplanToOasis(empty))
    const p = parseOasis(bytes)
    expect(p.cells.size).toBe(1)
    expect([...p.cells.values()][0]).toHaveLength(0)
    expect(p.cursor).toBe(bytes.length)
    expect(p.endLength).toBe(256)
  })

  test('is deterministic', () => {
    expect(writeOasis(floorplanToOasis(fp))).toEqual(writeOasis(floorplanToOasis(fp)))
  })
})

describe('oasisName', () => {
  test('whitespace → underscore, out-of-set dropped, never empty', () => {
    expect(oasisName('AND gate')).toBe('AND_gate')
    expect(oasisName('a\tb')).toBe('a_b')
    expect(oasisName('')).toBe('CELL')
    expect(oasisName('   ')).toBe('___')
  })
})

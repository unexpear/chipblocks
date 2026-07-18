import { describe, expect, test } from 'vitest'
import { PROCESS } from '../src/renderer/cell-layout.ts'
import type { Floorplan } from '../src/renderer/cell-place.ts'
import { cellBlock, cellPolygons } from '../src/renderer/cell-polygons.ts'
import { defName, floorplanToDef } from '../src/renderer/def.ts'
import { dbu, floorplanToLef } from '../src/renderer/lef.ts'

const width = (name: string) => {
  const b = cellBlock(name)
  return b ? cellPolygons(b).widthLambda : 16
}
const mkFloorplan = (
  cells: Floorplan['cells'],
  rows: number,
  wLambda: number,
  hLambda: number,
): Floorplan => ({
  cells,
  rows,
  dieWidthLambda: wLambda,
  dieHeightLambda: hLambda,
  dieWidthUm: wLambda * PROCESS.lambdaUm,
  dieHeightUm: hLambda * PROCESS.lambdaUm,
  cellAreaLambda2: wLambda * hLambda,
  dieAreaLambda2: wLambda * hLambda,
  utilization: 1,
  anyUnreliable: false,
})

const fp = mkFloorplan(
  [
    { id: 'u0', name: 'NOT', x: 0, y: 0, w: width('NOT'), h: 90, row: 0, reliable: true },
    { id: 'u1', name: 'NAND', x: 0, y: 90, w: width('NAND'), h: 90, row: 1, reliable: true },
  ],
  2,
  24,
  180,
)

describe('floorplanToDef', () => {
  test('has the required header, units and die area', () => {
    const { text } = floorplanToDef(fp)
    expect(text).toContain('VERSION 5.8 ;')
    expect(text).toContain('UNITS DISTANCE MICRONS 1000 ;')
    expect(text).toContain(`DIEAREA ( 0 0 ) ( ${dbu(24)} ${dbu(180)} ) ;`)
    expect(text.trimEnd().endsWith('END DESIGN')).toBe(true)
  })

  test('one COMPONENT per placed cell, each on the site grid and inside the die', () => {
    const { text, components } = floorplanToDef(fp)
    expect(components).toBe(fp.cells.length)
    const placed = [...text.matchAll(/- \S+ (\S+) \+ PLACED \( (\d+) (\d+) \) (N|FS) ;/g)]
    expect(placed).toHaveLength(fp.cells.length)
    for (const m of placed) {
      const x = Number(m[2])
      const y = Number(m[3])
      expect(x % dbu(PROCESS.polyPitch.lambda)).toBe(0) // on a 2400 dbu site step
      expect(x).toBeGreaterThanOrEqual(0)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(dbu(180))
    }
    // the COMPONENTS header count equals the actual number of - lines
    expect(text).toContain(`COMPONENTS ${fp.cells.length} ;`)
  })

  test('rows alternate orientation N / FS for a legal power grid', () => {
    const { text } = floorplanToDef(fp)
    const rows = [...text.matchAll(/^ROW ROW_(\d+) \S+ \d+ \d+ (N|FS) DO /gm)]
    expect(rows).toHaveLength(fp.rows)
    for (const m of rows) {
      const r = Number(m[1])
      expect(m[2]).toBe(r % 2 === 0 ? 'N' : 'FS') // even N, odd FS — rails abut same-net
    }
  })

  test('an FS (odd-row) component is placed at its row top; an N component at the row bottom', () => {
    const { text } = floorplanToDef(fp)
    const comp = (id: string) => {
      const m = text.match(new RegExp(`- ${id} \\S+ \\+ PLACED \\( \\d+ (\\d+) \\) (N|FS) ;`))
      if (!m) throw new Error(`no component ${id}`)
      return { y: Number(m[1]), orient: m[2] }
    }
    const u0 = comp('u0') // NOT, row 0 → N, at the row bottom = dieH − (0 + 90)
    expect(u0.orient).toBe('N')
    expect(u0.y).toBe(dbu(180 - (0 + 90)))
    const u1 = comp('u1') // NAND, row 1 → FS, at the row TOP = dieH − 90 (the N formula would give dieH−180)
    expect(u1.orient).toBe('FS')
    expect(u1.y).toBe(dbu(180 - 90))
    expect(u1.y).not.toBe(dbu(180 - (90 + 90)))
  })

  test('every DEF component master is a MACRO defined by the matching LEF (no dangling master)', () => {
    const def = floorplanToDef(fp).text
    const lef = floorplanToLef(fp).text
    const masters = new Set([...def.matchAll(/- \S+ (\S+) \+ PLACED/g)].map((m) => m[1] as string))
    const macros = new Set([...lef.matchAll(/MACRO (\S+)/g)].map((m) => m[1] as string))
    for (const master of masters) expect(macros.has(master), master).toBe(true)
  })

  test('instance ids are uniquified when two cell ids sanitize to the same token', () => {
    const clash = mkFloorplan(
      [
        { id: 'a/b', name: 'NOT', x: 0, y: 0, w: width('NOT'), h: 90, row: 0, reliable: true },
        { id: 'a_b', name: 'NOT', x: 16, y: 0, w: width('NOT'), h: 90, row: 0, reliable: true },
      ],
      1,
      32,
      90,
    )
    const ids = [...floorplanToDef(clash).text.matchAll(/- (\S+) \S+ \+ PLACED/g)].map((m) => m[1])
    expect(new Set(ids).size).toBe(2) // both survive, distinct
  })

  test('an empty floorplan yields a valid DEF (no throw)', () => {
    const empty = mkFloorplan([], 0, 0, 0)
    const { text, components } = floorplanToDef(empty)
    expect(components).toBe(0)
    expect(text).toContain('COMPONENTS 0 ;')
    expect(text).toContain('END DESIGN')
  })

  test('is deterministic', () => {
    expect(floorplanToDef(fp).text).toBe(floorplanToDef(fp).text)
  })
})

describe('defName', () => {
  test('sanitizes to a legal identifier, never empty', () => {
    expect(defName('a/b.c')).toBe('a_b_c')
    expect(defName('###')).toBe('___')
    expect(defName('')).toBe('inst')
  })
})

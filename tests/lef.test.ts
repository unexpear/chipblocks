import { describe, expect, test } from 'vitest'
import { STANDARD_CELL_BLOCKS } from '../src/renderer/cell-drc.ts'
import { cellGeometry, DESIGN_RULES, PROCESS } from '../src/renderer/cell-layout.ts'
import type { Floorplan } from '../src/renderer/cell-place.ts'
import { cellBlock, cellPolygons, extractNetlist } from '../src/renderer/cell-polygons.ts'
import {
  cellMacro,
  floorplanToLef,
  LEF_SITE,
  standardCellLef,
  techLef,
  um,
} from '../src/renderer/lef.ts'

const lambdaUm = PROCESS.lambdaUm

describe('the technology LEF', () => {
  const tech = techLef()
  test('has the required header + units + grid + site, all parseable', () => {
    expect(tech).toContain('VERSION 5.8 ;')
    expect(tech).toContain('DATABASE MICRONS 1000 ;')
    expect(tech).toContain('MANUFACTURINGGRID 0.005 ;')
    expect(tech).toMatch(
      /SITE cbcore\b[\s\S]*SIZE 2\.400 BY 27\.000 ;[\s\S]*SYMMETRY Y ;[\s\S]*END cbcore/,
    )
  })
  test('routing-layer widths are bound to the cited design rules (not literals)', () => {
    const met1 = (DESIGN_RULES.minMetal1Width as { lambda: number }).lambda * lambdaUm
    const li1 = (DESIGN_RULES.contactSize as { lambda: number }).lambda * lambdaUm
    expect(tech).toMatch(new RegExp(`LAYER met1 [^\\n]*WIDTH ${met1.toFixed(3)} `))
    expect(tech).toMatch(new RegExp(`LAYER li1 [^\\n]*WIDTH ${li1.toFixed(3)} `))
  })
  test('every routing/cut layer used by a cell RECT is declared', () => {
    const declared = new Set([...tech.matchAll(/LAYER (\w+) /g)].map((m) => m[1]))
    for (const b of STANDARD_CELL_BLOCKS) {
      for (const r of cellPolygons(b).rects) {
        if (r.layer === 'li1' || r.layer === 'met1')
          expect(declared.has(r.layer), r.layer).toBe(true)
      }
    }
  })
})

describe('the cell MACROs', () => {
  test('SIZE, height, pins, and OBS are correct for every primitive gate', () => {
    for (const b of STANDARD_CELL_BLOCKS) {
      const { text, fallback } = cellMacro(b.name)
      expect(fallback).toBe(false)
      const layout = cellPolygons(b)
      const net = extractNetlist(b)
      // MACRO name matches the GDS structure name (cell_<NAME>)
      expect(text).toContain(`MACRO cell_${b.name}`)
      // SIZE = cell width × 0.3 BY 27.000
      expect(text).toContain(`SIZE ${um(layout.widthLambda)} BY 27.000 ;`)
      // power pins by USE
      expect(text).toMatch(/PIN VDD[\s\S]*USE POWER ;/)
      expect(text).toMatch(/PIN VSS[\s\S]*USE GROUND ;/)
      // exactly one OUTPUT pin (Y)
      expect([...text.matchAll(/DIRECTION OUTPUT ;/g)]).toHaveLength(1)
      // input-pin count matches the schematic
      expect([...text.matchAll(/DIRECTION INPUT ;/g)]).toHaveLength(net.inputs.length)
      // every RECT coordinate is on the 0.005 µm manufacturing grid
      for (const m of text.matchAll(/RECT ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) ;/g)) {
        for (let i = 1; i <= 4; i++) {
          expect(Math.round(Number(m[i]) * 1000) % 5, `${b.name} coord ${m[i]} off grid`).toBe(0)
        }
      }
      // single-stage cells (stageCount 1) have no OBS; composites do
      const hasObs = /\n {2}OBS\n/.test(text)
      expect(hasObs, `${b.name} OBS`).toBe(layout.stageCount > 1)
    }
  })

  test('LEF SIZE width and DEF placement width come from the same number (guard against formula drift)', () => {
    for (const b of STANDARD_CELL_BLOCKS) {
      expect(cellGeometry(b).widthLambda, b.name).toBe(cellPolygons(b).widthLambda)
    }
  })

  test('an unknown cell name yields a black-box fallback MACRO', () => {
    const { text, fallback } = cellMacro('MYSTERY')
    expect(fallback).toBe(true)
    expect(text).toContain('MACRO cell_MYSTERY')
    expect(text).toContain('OBS')
    expect(text).not.toContain('PIN ')
  })

  test('standardCellLef covers all 8 gates + the tech LEF, deterministically', () => {
    const a = standardCellLef()
    expect(a).toBe(standardCellLef())
    for (const b of STANDARD_CELL_BLOCKS) expect(a).toContain(`MACRO cell_${b.name}`)
    expect(a).toContain(`SITE ${LEF_SITE}`)
  })
})

describe('floorplanToLef — a LEF for the cells a design uses', () => {
  const fp: Floorplan = {
    cells: [
      {
        id: 'g1',
        name: 'NAND',
        x: 0,
        y: 0,
        w: cellBlockWidth('NAND'),
        h: 90,
        row: 0,
        reliable: true,
      },
      {
        id: 'g2',
        name: 'NAND',
        x: 24,
        y: 0,
        w: cellBlockWidth('NAND'),
        h: 90,
        row: 0,
        reliable: true,
      },
      { id: 'g3', name: 'MYSTERY', x: 48, y: 0, w: 16, h: 90, row: 0, reliable: true },
    ],
    rows: 1,
    dieWidthLambda: 64,
    dieHeightLambda: 90,
    dieWidthUm: 64 * lambdaUm,
    dieHeightUm: 90 * lambdaUm,
    cellAreaLambda2: 64 * 90,
    dieAreaLambda2: 64 * 90,
    utilization: 1,
    anyUnreliable: false,
  }
  test('dedups cell types (NAND once) and black-boxes the unknown', () => {
    const { text, macros, fallbacks } = floorplanToLef(fp)
    expect(macros).toBe(2) // NAND + MYSTERY
    expect(fallbacks).toEqual(['MYSTERY'])
    expect([...text.matchAll(/MACRO cell_NAND\b/g)]).toHaveLength(1)
    expect(text).toContain('MACRO cell_MYSTERY')
    expect(text).toContain('VERSION 5.8 ;') // tech LEF prepended
  })
})

function cellBlockWidth(name: string): number {
  const b = cellBlock(name)
  return b ? cellPolygons(b).widthLambda : 16
}

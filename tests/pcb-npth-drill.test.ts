/**
 * NPTH (non-plated through-hole) drill files. A mounting/tooling hole has NO copper plating, and the fab
 * drills it in a SEPARATE non-plated Excellon file — plating a mounting hole (or leaving a real NPTH hole
 * in the plated file) is WRONG manufacturing data. This checks the whole path: a `plated: false` pad splits
 * out of the plated drill file into the NPTH file with the right FileFunction, a bare non-plated hole is
 * exempt from the plated-annular-ring DRC, and the manufacturing ZIP carries the NPTH file only when needed.
 */
import { afterAll, describe, expect, test } from 'vitest'
import { BUILTIN_FOOTPRINTS, type Footprint } from '../src/renderer/footprint.ts'
import type { Board } from '../src/renderer/pcb-board.ts'
import { runDrc } from '../src/renderer/pcb-drc.ts'
import { buildManufacturingZip, FAB_FILE_NAMES, type FabInputs } from '../src/renderer/pcb-fab.ts'
import { boardHasNonPlatedHoles, excellonDrill } from '../src/renderer/pcb-gerber.ts'
import { DEFAULT_ROUTE_CLASS } from '../src/renderer/pcb-route.ts'

const WHEN = new Date('2026-07-19T00:00:00Z')
const NO_ROUTING = { traces: [], vias: [], unrouted: [] }

// A connector-like footprint: one PLATED 0.8 mm hole (pad 1) + one NON-plated 3.2 mm mounting hole (MH).
const MIXED = '__TEST_MIXED_HOLES__'
// Plated-only variant (same but the mounting hole is plated) — for the "no NPTH file" case.
const PLATED_ONLY = '__TEST_PLATED_ONLY__'

const baseFp = (id: string): Omit<Footprint, 'pads'> => ({
  id,
  name: 't',
  description: 'a test footprint with mixed hole plating',
  silkscreen: [],
  fabrication: [{ from: { x: -1, y: -1 }, to: { x: 1, y: -1 }, width: 0.15 }],
  labels: { reference: { x: 0, y: 0 }, value: { x: 0, y: 0 }, fabReference: { x: 0, y: 0 } },
  courtyard: { x: -2, y: -2, w: 12, h: 5 },
  provenance: { source_type: 'reference', title: 't', citation: 't', confidence: 'high' },
})

BUILTIN_FOOTPRINTS[MIXED] = {
  ...baseFp(MIXED),
  pads: [
    {
      id: '1',
      center: { x: 0, y: 0 },
      size: { w: 1.6, h: 1.6 },
      shape: 'circle',
      type: 'through_hole',
      holeDiameter: 0.8,
    },
    // a bare mounting hole: pad = hole (no annular copper), plated: false
    {
      id: 'MH',
      center: { x: 5, y: 0 },
      size: { w: 3.2, h: 3.2 },
      shape: 'circle',
      type: 'through_hole',
      holeDiameter: 3.2,
      plated: false,
    },
  ],
}
BUILTIN_FOOTPRINTS[PLATED_ONLY] = {
  ...baseFp(PLATED_ONLY),
  pads: [
    {
      id: '1',
      center: { x: 0, y: 0 },
      size: { w: 1.6, h: 1.6 },
      shape: 'circle',
      type: 'through_hole',
      holeDiameter: 0.8,
    },
  ],
}
afterAll(() => {
  delete BUILTIN_FOOTPRINTS[MIXED]
  delete BUILTIN_FOOTPRINTS[PLATED_ONLY]
})

const boardOf = (footprintId: string): Board => ({
  outline: { x: -5, y: -5, w: 30, h: 20 },
  placements: [{ partId: 'J1', footprintId, x: 10, y: 10, rotation: 0, designator: 'J1' }],
})

const fabInputs = (board: Board): FabInputs => ({
  board,
  ratsnest: { airwires: [], padBoxes: [] },
  routing: NO_ROUTING,
  drc: [],
  offBoardPins: 0,
  bomRows: [],
  netlistText: '* test netlist\n.end\n',
  when: WHEN,
})

describe('NPTH split drill file', () => {
  test('boardHasNonPlatedHoles: true with a mounting hole, false without', () => {
    expect(boardHasNonPlatedHoles(boardOf(MIXED))).toBe(true)
    expect(boardHasNonPlatedHoles(boardOf(PLATED_ONLY))).toBe(false)
  })

  test('the plated drill file has the 0.8 mm plated hole but NOT the 3.2 mm mounting hole', () => {
    const pth = excellonDrill(boardOf(MIXED), NO_ROUTING, WHEN)
    expect(pth).toContain('TF.FileFunction,Plated,1,2,PTH')
    expect(pth).toContain('C0.800')
    expect(pth).not.toContain('C3.200')
  })

  test('the non-plated drill file has the mounting hole with the NonPlated/NPTH function, no plated holes', () => {
    const npth = excellonDrill(boardOf(MIXED), NO_ROUTING, WHEN, 2, true)
    expect(npth).toContain('TF.FileFunction,NonPlated,1,2,NPTH')
    expect(npth).toContain('C3.200')
    expect(npth).not.toContain('C0.800')
  })

  test('a bare non-plated hole is NOT flagged annular-ring (no plating, no ring requirement)', () => {
    const codes = runDrc(boardOf(MIXED), { airwires: [], padBoxes: [] }, NO_ROUTING).map(
      (v) => v.code,
    )
    // the MH pad has zero annular (pad = hole), but plated: false exempts it
    expect(codes).not.toContain('annular-ring')
  })

  test('a fine NON-plated hole on a thick board uses the 0.15 mm hard floor, not the plating aspect ratio', () => {
    // On a 2.4 mm board the plating aspect ratio floor is 0.30 mm — but an unplated hole isn't plated, so
    // only the 0.15 mm hard minimum applies. A 0.2 mm mounting hole must NOT be falsely blocked.
    const NPTH_FINE = '__TEST_FINE_NPTH__'
    const PTH_FINE = '__TEST_FINE_PTH__'
    const fine = (id: string, plated: boolean) => ({
      ...baseFp(id),
      pads: [
        {
          id: '1',
          center: { x: 0, y: 0 },
          size: { w: 3, h: 3 },
          shape: 'circle' as const,
          type: 'through_hole' as const,
          holeDiameter: 0.2,
          plated,
        },
      ],
    })
    BUILTIN_FOOTPRINTS[NPTH_FINE] = fine(NPTH_FINE, false)
    BUILTIN_FOOTPRINTS[PTH_FINE] = fine(PTH_FINE, true)
    const codesOf = (id: string) =>
      runDrc(boardOf(id), { airwires: [], padBoxes: [] }, NO_ROUTING, DEFAULT_ROUTE_CLASS, {
        boardThicknessMm: 2.4,
      }).map((v) => v.code)
    expect(codesOf(NPTH_FINE)).not.toContain('drill-size') // 0.2 ≥ 0.15 hard floor
    expect(codesOf(PTH_FINE)).toContain('drill-size') // 0.2 < 0.30 plated aspect floor
    delete BUILTIN_FOOTPRINTS[NPTH_FINE]
    delete BUILTIN_FOOTPRINTS[PTH_FINE]
  })

  test('the manufacturing ZIP carries the NPTH file only when the board has a mounting hole', () => {
    expect(buildManufacturingZip(fabInputs(boardOf(MIXED))).entries).toContain(
      FAB_FILE_NAMES.drillNpth,
    )
    expect(buildManufacturingZip(fabInputs(boardOf(PLATED_ONLY))).entries).not.toContain(
      FAB_FILE_NAMES.drillNpth,
    )
  })
})

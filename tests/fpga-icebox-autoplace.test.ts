/**
 * FPGA fabric — Stage 2, increment 6: auto-placement onto real cells (fpga-icebox-autoplace.ts).
 * The finale: NOTHING is hand-placed. Given a 2-LUT netlist and the pool of all 8 cells of tile (1,1), the
 * placer must DISCOVER that the only routable assignment is A→cell 0 (its output lutff_0/out = net 39 reaches
 * B) and B→cell 5 (it reads lutff_5/in_1 = net 1121) — every other of the 56 assignments fails to bind/route
 * on this real slice. It returns that placement's real bitstream, or an honest failure when none routes.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import type { KLut } from '../src/renderer/fpga-fabric.ts'
import { parseIceboxChipdb } from '../src/renderer/fpga-icebox.ts'
import { autoPlace, type Cell } from '../src/renderer/fpga-icebox-autoplace.ts'
import {
  decodeLc,
  expandTruth,
  type LcConfig,
  parseLogicTileBits,
} from '../src/renderer/fpga-icebox-logic.ts'

const DEVICE = parseIceboxChipdb(
  readFileSync(
    new URL('../fixtures/icebox-ice40-384-cell-to-cell.chipdb', import.meta.url),
    'utf8',
  ),
)
const LAYOUT = parseLogicTileBits(
  readFileSync(
    new URL('../fixtures/icebox-ice40-384-logic-tile-bits.chipdb', import.meta.url),
    'utf8',
  ),
)
const combinational = (truth: boolean[]): LcConfig => ({
  truth,
  carryEnable: false,
  dffEnable: false,
  setNoReset: false,
  asyncSetReset: false,
})

const A: KLut = {
  id: 'A',
  k: 2,
  config: [false, false, false, true],
  inputs: ['i0', 'i1'],
  output: 'nA',
}
const B: KLut = {
  id: 'B',
  k: 2,
  config: [false, false, true, true],
  inputs: ['i2', 'nA'],
  output: 'nB',
}
/** all 8 cells of tile (1,1) — the pool the placer chooses from (only cells 0 and 5 are routable-connected). */
const tile11Cells: Cell[] = Array.from({ length: 8 }, (_, cell) => ({ x: 1, y: 1, cell }))

describe('autoPlace — choose real cells with no hand-placement', () => {
  test('discovers the one routable assignment among all 8 cells and synthesizes its bitstream', () => {
    const placed = autoPlace(DEVICE, LAYOUT, [A, B], tile11Cells)
    expect(placed.placed).toBe(true)
    // it FOUND (not was told) that A must go on cell 0 and B on cell 5 for the design to route.
    expect(placed.placement.get('A')).toEqual({ x: 1, y: 1, cell: 0 })
    expect(placed.placement.get('B')).toEqual({ x: 1, y: 1, cell: 5 })
    expect(placed.result.routed).toBe(true)
    expect(placed.attempts).toBeGreaterThan(0)
    // and the chosen placement's bitstream is real: it decodes back to the two LUT functions.
    expect(decodeLc(LAYOUT, 0, 1, 1, placed.result.bitstream.bits)).toEqual(
      combinational(expandTruth(A.config)),
    )
    expect(decodeLc(LAYOUT, 5, 1, 1, placed.result.bitstream.bits)).toEqual(
      combinational(expandTruth(B.config)),
    )
    expect(placed.result.bitstream.conflicts).toEqual([])
  })

  test('is deterministic — the same netlist + pool always yields the same placement', () => {
    const a = autoPlace(DEVICE, LAYOUT, [A, B], tile11Cells)
    const b = autoPlace(DEVICE, LAYOUT, [A, B], tile11Cells)
    expect([...a.placement.entries()]).toEqual([...b.placement.entries()])
    expect(a.attempts).toBe(b.attempts)
  })
})

describe('autoPlace — honest failure, never a fabricated placement', () => {
  test('a cell pool with no routable assignment fails with a reason', () => {
    // cells 1/2/3 have no in-slice routing to each other, so no assignment of A→B binds+routes.
    const noRoute = autoPlace(
      DEVICE,
      LAYOUT,
      [A, B],
      [
        { x: 1, y: 1, cell: 1 },
        { x: 1, y: 1, cell: 2 },
        { x: 1, y: 1, cell: 3 },
      ],
    )
    expect(noRoute.placed).toBe(false)
    expect(noRoute.result.routed).toBe(false)
    expect(noRoute.reason).toMatch(/no routable placement/)
    expect(noRoute.attempts).toBeGreaterThan(0) // it actually tried
  })

  test('more LUTs than available cells fails immediately with a reason, routing nothing', () => {
    const C: KLut = { id: 'C', k: 1, config: [false, true], inputs: ['x'], output: 'nC' }
    const tooBig = autoPlace(
      DEVICE,
      LAYOUT,
      [A, B, C],
      [
        { x: 1, y: 1, cell: 0 },
        { x: 1, y: 1, cell: 5 },
      ],
    )
    expect(tooBig.placed).toBe(false)
    expect(tooBig.attempts).toBe(0)
    expect(tooBig.reason).toMatch(/3 LUTs but only 2 cells/)
  })
})

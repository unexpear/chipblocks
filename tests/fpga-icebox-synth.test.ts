/**
 * FPGA fabric — Stage 2, increment 5: synthesize a placed design's bitstream (fpga-icebox-synth.ts).
 * The payoff: a real 2-LUT netlist, placed on real iCE40 cells, becomes a full design bitstream — bound to
 * real cell pins, routed cell-to-cell on the real graph, and assembled. The design is genuine: LUT A on cell 0
 * of tile (1,1) drives LUT B on cell 5 (its output net 39 = lutff_0/out; B reads it on lutff_5/in_1 = net
 * 1121), routed through the real local track local_g0_0 (net 1057). Every wire, pin, and pip is real iCE40.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import type { KLut } from '../src/renderer/fpga-fabric.ts'
import { parseIceboxChipdb } from '../src/renderer/fpga-icebox.ts'
import {
  decodeLc,
  expandTruth,
  type LcConfig,
  parseLogicTileBits,
} from '../src/renderer/fpga-icebox-logic.ts'
import { rrgFromIcebox } from '../src/renderer/fpga-icebox-rrg.ts'
import {
  buildWireIndex,
  type Placement,
  synthesizeBitstream,
} from '../src/renderer/fpga-icebox-synth.ts'

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

// A real 2-LUT netlist (the shape coverToLuts produces): A computes i0 & i1 into net nA; B buffers nA (reads
// it on input pin 1) into net nB. B's pin-1 input is the internal net A drives.
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
// place A on cell 0 of tile (1,1) (its output is lutff_0/out = net 39) and B on cell 5 (reads lutff_5/in_1).
const placement: Placement = new Map([
  ['A', { x: 1, y: 1, cell: 0 }],
  ['B', { x: 1, y: 1, cell: 5 }],
])

describe('buildWireIndex — find a real net by (tile, wire name)', () => {
  test('locates the cell pins that make the design routable', () => {
    const index = buildWireIndex(DEVICE)
    expect(index.get('1_1_lutff_0/out')).toBe(39) // LUT A's output wire
    expect(index.get('1_1_lutff_5/in_1')).toBe(1121) // LUT B's input pin 1
    expect(index.get('1_1_local_g0_0')).toBe(1057) // the track between them
  })
})

describe('synthesizeBitstream — a placed 2-LUT design → real bitstream, routed cell-to-cell', () => {
  const result = synthesizeBitstream(DEVICE, LAYOUT, [A, B], placement)

  test('the internal net A→B binds to real cell pins and routes through real pips', () => {
    expect(result.unbound).toEqual([]) // every needed wire bound to a real net
    expect(result.nets).toHaveLength(1) // exactly one internal net: nA (A drives B); nB has no consumer
    expect(result.nets[0]).toMatchObject({ id: 'nA', source: 'w39', sinks: ['w1121'] })
    expect(result.routed).toBe(true)
    expect(result.route.onPips.size).toBe(2) // routed through the two real buffer pips (39→1057→1121)
  })

  test("the assembled bitstream carries BOTH cells' logic and the routing, with no conflicts", () => {
    expect(result.bitstream.conflicts).toEqual([])
    // the two real routing pips program these bits on tile (1,1): 39→1057 sets B0[14], 1057→1121 sets B10[29]
    expect(result.bitstream.bits).toContainEqual({ x: 1, y: 1, row: 0, col: 14, value: 1 })
    expect(result.bitstream.bits).toContainEqual({ x: 1, y: 1, row: 10, col: 29, value: 1 })
    expect(result.cells).toHaveLength(2) // both LUTs placed
  })

  test("decoding the bitstream recovers each LUT's real function — the design is faithfully programmed", () => {
    // cell 0 = LUT A (i0 & i1); cell 5 = LUT B (buffer of pin 1). Routing bits (cols 14-30) do not disturb the
    // LUT config bits (cols 36-45), so each cell decodes back to exactly what was synthesized.
    expect(decodeLc(LAYOUT, 0, 1, 1, result.bitstream.bits)).toEqual(
      combinational(expandTruth(A.config)),
    )
    expect(decodeLc(LAYOUT, 5, 1, 1, result.bitstream.bits)).toEqual(
      combinational(expandTruth(B.config)),
    )
  })
})

describe('synthesizeBitstream — honest failure reporting (a partial design is never reported legal)', () => {
  test('an unplaced LUT is reported in unbound, and the design is NOT routed (legal)', () => {
    const result = synthesizeBitstream(
      DEVICE,
      LAYOUT,
      [A, B],
      new Map([['A', { x: 1, y: 1, cell: 0 }]]),
    )
    expect(result.unbound).toContain('cell:B') // B has no placement
    expect(result.cells).toHaveLength(1) // only A placed
    expect(result.routed).toBe(false) // unbound ⇒ not a legal, fully-realized design
  })

  test('a net whose driver cell output wire is not on the device is reported, and routed is false', () => {
    // place A on a cell whose lutff/out is absent from this tiny slice (cell 3), but B still reads nA — so the
    // net has a real sink but no bindable source: reported as out:A, no fabricated route, and routed:false.
    const result = synthesizeBitstream(
      DEVICE,
      LAYOUT,
      [A, B],
      new Map([
        ['A', { x: 1, y: 1, cell: 3 }],
        ['B', { x: 1, y: 1, cell: 5 }],
      ]),
    )
    expect(result.unbound).toContain('out:A')
    expect(result.nets).toHaveLength(0) // nothing routed — the source could not bind
    expect(result.routed).toBe(false) // a clean route over a partially-bound netlist is NOT success
  })

  test('two LUTs on the same physical cell (one BLE) is flagged structurally, even with identical functions', () => {
    // A real iCE40 BLE holds one LUT. Two distinct LUTs (same truth table, unconsumed outputs) on (1,1,0) would
    // otherwise slip past the assembler's value-conflict check (identical bits ⇒ no differing bit). The
    // structural occupancy check catches it regardless of the encoded values.
    const C: KLut = { id: 'C', k: 2, config: A.config, inputs: ['i4', 'i5'], output: 'nC' }
    const result = synthesizeBitstream(
      DEVICE,
      LAYOUT,
      [A, C],
      new Map([
        ['A', { x: 1, y: 1, cell: 0 }],
        ['C', { x: 1, y: 1, cell: 0 }], // same BLE as A — illegal
      ]),
    )
    expect(result.unbound).toContain('cell-conflict:A:C')
    expect(result.routed).toBe(false)
  })
})

describe('synthesizeBitstream — real multi-source muxes: only the in-slice source connects', () => {
  test('each mux lists 16 real sources; 30 pips are excluded (source wire outside the slice), 2 routed', () => {
    // The fixture keeps each mux's full 16 source options verbatim. rrgFromIcebox excludes the 30 whose source
    // wire is not one of {39,1057,1121} and includes the 2 that form the real 39→1057→1121 path.
    const { report } = rrgFromIcebox(DEVICE)
    expect(report.pipsTotal).toBe(32) // 16 + 16 real mux source options
    expect(report.pipsIncluded).toBe(2) // only the two whose src+dst are both in the slice
    expect(report.excludedMissingSrc).toBe(30) // the other source options reference wires outside the slice
  })
})

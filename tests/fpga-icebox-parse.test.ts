/**
 * FPGA fabric — Stage 3a: parse a bitstream back into its design (fpga-icebox-parse.ts).
 * The headline round-trip: a real 2-LUT design synthesized to a bitstream (increments 5) is READ BACK — the
 * same placed cells (LUT + FF functions) and the same ON routing pips it was built from — proving the
 * bitstream faithfully carries the design and that we can recover it, the inverse of the encode flow.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import type { KLut } from '../src/renderer/fpga-fabric.ts'
import { parseIceboxChipdb } from '../src/renderer/fpga-icebox.ts'
import {
  decodeLc,
  expandTruth,
  type LcConfig,
  lcCramBits,
  parseLogicTileBits,
} from '../src/renderer/fpga-icebox-logic.ts'
import {
  decodeUsedCells,
  parseBitstream,
  pipsOnInBitstream,
} from '../src/renderer/fpga-icebox-parse.ts'
import { type Placement, synthesizeBitstream } from '../src/renderer/fpga-icebox-synth.ts'

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
const placement: Placement = new Map([
  ['A', { x: 1, y: 1, cell: 0 }],
  ['B', { x: 1, y: 1, cell: 5 }],
])
const design = synthesizeBitstream(DEVICE, LAYOUT, [A, B], placement)
const bits = design.bitstream.bits

describe('parseBitstream — recover a design from its bitstream (the round-trip)', () => {
  const parsed = parseBitstream(bits, DEVICE, LAYOUT)

  test('recovers exactly the placed cells and their LUT functions', () => {
    expect(design.routed).toBe(true) // the design we are parsing really was synthesized
    // two used cells: cell 0 (A = AND2) and cell 5 (B = buffer of pin 1); no other cell is configured.
    expect(parsed.cells.map((c) => ({ x: c.x, y: c.y, cell: c.cell }))).toEqual([
      { x: 1, y: 1, cell: 0 },
      { x: 1, y: 1, cell: 5 },
    ])
    const byCell = new Map(parsed.cells.map((c) => [c.cell, c.config]))
    expect(byCell.get(0)).toEqual(combinational(expandTruth(A.config))) // recovered A's function
    expect(byCell.get(5)).toEqual(combinational(expandTruth(B.config))) // recovered B's function
  })

  test('recovers exactly the ON routing pips — the two the design programmed, and no others', () => {
    const on = parsed.onPips.map((p) => ({ src: p.src, dst: p.dst })).sort((a, b) => a.dst - b.dst)
    expect(on).toEqual([
      { src: 39, dst: 1057 }, // 39 → 1057 (lutff_0/out → local_g0_0)
      { src: 1057, dst: 1121 }, // 1057 → 1121 (local_g0_0 → lutff_5/in_1)
    ])
    expect(parsed.onPips).toHaveLength(2) // NOT the other 30 mux source options
  })
})

describe('parseBitstream — the inverse never invents structure', () => {
  test('an all-zero bitstream recovers nothing — no used cells, no ON pips', () => {
    expect(decodeUsedCells([], LAYOUT)).toEqual([])
    expect(pipsOnInBitstream([], DEVICE.pips)).toEqual([])
  })

  test('pipsOnInBitstream is the exact inverse of the encoded routing — mux mutual-exclusion holds', () => {
    // Only the pip whose full condition the bits match is ON; a sibling mux source that shares some bits is NOT,
    // because the bits that select one source clear the others (verified against the real 16-source mux).
    const on = pipsOnInBitstream(bits, DEVICE.pips)
    for (const pip of on) {
      // every ON pip's condition is genuinely satisfied by the bitstream
      const value = new Map(bits.map((b) => [`${b.x}_${b.y}_${b.row}_${b.col}`, b.value]))
      expect(
        pip.condition.every(
          (c) => (value.get(`${pip.x}_${pip.y}_${c.bit.row}_${c.bit.col}`) ?? 0) === c.value,
        ),
      ).toBe(true)
    }
    // the 1057 mux has 16 sources but only one (src 39) is on
    expect(on.filter((p) => p.dst === 1057)).toHaveLength(1)
  })

  test('decodeUsedCells reads a constant-0 unprogrammed cell as unused', () => {
    // bits for cell 0 = AND2 (used); cell 1 has no bits set ⇒ constant-0 ⇒ not returned.
    const cells = decodeUsedCells(bits, LAYOUT)
    expect(cells.some((c) => c.cell === 0)).toBe(true)
    expect(cells.some((c) => c.cell === 1)).toBe(false)
    // and each recovered cell really decodes to what decodeLc says (self-consistent)
    for (const c of cells) expect(c.config).toEqual(decodeLc(LAYOUT, c.cell, c.x, c.y, bits))
  })
})

describe('parseBitstream — flip-flops and multiple tiles', () => {
  test("recovers a registered cell's flip-flop config, not just the LUT — each sequential bit round-trips", () => {
    // The demo cells are combinational; program a REAL register and confirm all four sequential bits read back.
    for (const ff of [
      { carryEnable: true, dffEnable: false, setNoReset: false, asyncSetReset: false },
      { carryEnable: false, dffEnable: true, setNoReset: false, asyncSetReset: false },
      { carryEnable: false, dffEnable: false, setNoReset: true, asyncSetReset: false },
      { carryEnable: false, dffEnable: false, setNoReset: false, asyncSetReset: true },
    ]) {
      const config: LcConfig = { truth: expandTruth(A.config), ...ff }
      const recovered = decodeUsedCells(lcCramBits(LAYOUT, 3, 2, 4, config), LAYOUT)
      expect(recovered.find((c) => c.cell === 3)?.config).toEqual(config) // FF fields recovered exactly
    }
  })

  test('a registered cell with a constant-0 LUT is still "used" — the flip-flop branch of used, not just the LUT', () => {
    const config: LcConfig = {
      truth: Array.from({ length: 16 }, () => false), // constant-0 LUT…
      carryEnable: false,
      dffEnable: true, // …but a real register, so the cell IS used, not unprogrammed
      setNoReset: false,
      asyncSetReset: false,
    }
    const cells = decodeUsedCells(lcCramBits(LAYOUT, 0, 1, 1, config), LAYOUT)
    expect(cells).toHaveLength(1)
    expect(cells[0]?.config).toEqual(config)
  })

  test('recovers cells across MULTIPLE tiles — not just the first tile the bits touch', () => {
    const onTileA = lcCramBits(LAYOUT, 0, 1, 1, combinational(expandTruth(A.config))) // tile (1,1) cell 0
    const onTileB = lcCramBits(LAYOUT, 2, 2, 4, combinational(expandTruth(B.config))) // tile (2,4) cell 2
    const cells = decodeUsedCells([...onTileA, ...onTileB], LAYOUT)
    expect(cells.map((c) => `${c.x}_${c.y}_${c.cell}`).sort()).toEqual(['1_1_0', '2_4_2'])
  })
})

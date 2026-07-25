/**
 * FPGA fabric — Stage 2, increment 3: the iCE40 logic-cell (BLE) bit model (fpga-icebox-logic.ts).
 * Proves a real logic cell's function encodes to / decodes from the GENUINE CRAM positions an iCE40 logic
 * tile uses. The layout fixture is verbatim Project IceStorm data (device "384", ISC), and the LUT bit
 * permutation + sequential-bit positions asserted here were cross-checked by running the real icebox.py tool
 * (get_lutff_lut_bits / get_lutff_seq_bits), so these are ground-truth facts, not a restated constant.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  decodeLc,
  evalLut4,
  expandTruth,
  type LcConfig,
  lcCramBits,
  parseLogicTileBits,
} from '../src/renderer/fpga-icebox-logic.ts'

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

// A couple of real KLut.config truth tables (this project's own little-endian order — see fpga-fabric.ts).
const AND2 = [false, false, false, true] // out = in0 & in1
const XOR2 = [false, true, true, false] // out = in0 ^ in1

/** The four input booleans of a 0..15 combination (in0 = bit 0). */
const inputs = (combo: number): [boolean, boolean, boolean, boolean] => [
  (combo & 1) !== 0,
  (combo & 2) !== 0,
  (combo & 4) !== 0,
  (combo & 8) !== 0,
]

describe('parseLogicTileBits — the real .logic_tile_bits CRAM layout', () => {
  test('parses 8 cells of 20 bits each at their genuine coordinates, plus the tile-shared bits', () => {
    expect(LAYOUT.cols).toBe(54)
    expect(LAYOUT.rows).toBe(16)
    expect(LAYOUT.cells.length).toBe(8)
    expect(LAYOUT.cells.every((c) => c.length === 20)).toBe(true)
    // LC_0 = B0[36..45] then B1[36..45]; LC_3 starts at B6[36] (rows 2·3, 2·3+1).
    expect(LAYOUT.cells[0]?.[0]).toEqual({ row: 0, col: 36 })
    expect(LAYOUT.cells[0]?.[10]).toEqual({ row: 1, col: 36 })
    expect(LAYOUT.cells[0]?.[19]).toEqual({ row: 1, col: 45 })
    expect(LAYOUT.cells[3]?.[0]).toEqual({ row: 6, col: 36 })
    expect(LAYOUT.carryInSet).toEqual({ row: 1, col: 50 })
    expect(LAYOUT.negClk).toEqual({ row: 0, col: 0 })
  })
})

describe('evalLut4 / expandTruth — the iCE40 LUT4 evaluation', () => {
  test('output is truth[8·in3 + 4·in2 + 2·in1 + in0] for every input combination', () => {
    // a truth table that is true at exactly one index (11 = 0b1011 ⇒ in0,in1,in3 high, in2 low)
    const truth = Array.from({ length: 16 }, (_, i) => i === 11)
    for (let combo = 0; combo < 16; combo++) {
      const [i0, i1, i2, i3] = inputs(combo)
      expect(evalLut4(truth, i0, i1, i2, i3)).toBe(combo === 11)
    }
  })

  test('expandTruth lifts a k-input table to 16 entries with the high inputs ignored', () => {
    const and = expandTruth(AND2) // 4 → 16
    expect(and.length).toBe(16)
    for (let combo = 0; combo < 16; combo++) {
      const [i0, i1, i2, i3] = inputs(combo)
      expect(evalLut4(and, i0, i1, i2, i3)).toBe(i0 && i1) // in2/in3 never change the result
    }
    expect(expandTruth([true]).every((b) => b === true)).toBe(true) // k=0 constant
    expect(() => expandTruth([true, false, true])).toThrow() // not a power of two
  })
})

describe('lcCramBits — encode a cell to GENUINE, tool-verified CRAM positions', () => {
  test('LUT bit 0 and each sequential bit land at the exact coordinates icebox.py reports', () => {
    // truth true only at index 0 ⇒ LUT bit 0 = 1; enable every sequential bit to place all four.
    const truth = Array.from({ length: 16 }, (_, i) => i === 0)
    const bits = lcCramBits(LAYOUT, 0, 1, 1, {
      truth,
      carryEnable: true,
      dffEnable: true,
      setNoReset: true,
      asyncSetReset: true,
    })
    // cross-checked against get_lutff_lut_bits / get_lutff_seq_bits on the real tool:
    expect(bits).toContainEqual({ x: 1, y: 1, row: 0, col: 40, value: 1 }) // lut[0] at LC-bit 4 = B0[40]
    expect(bits).toContainEqual({ x: 1, y: 1, row: 0, col: 44, value: 1 }) // carryEnable  at LC-bit 8  = B0[44]
    expect(bits).toContainEqual({ x: 1, y: 1, row: 0, col: 45, value: 1 }) // dffEnable    at LC-bit 9  = B0[45]
    expect(bits).toContainEqual({ x: 1, y: 1, row: 1, col: 44, value: 1 }) // setNoReset   at LC-bit 18 = B1[44]
    expect(bits).toContainEqual({ x: 1, y: 1, row: 1, col: 45, value: 1 }) // asyncSetReset at LC-bit 19 = B1[45]
    expect(bits.length).toBe(20) // 16 LUT + 4 sequential, every bit emitted with its value
  })

  test('a cell is placed on its own rows: cell 3 uses rows 6 and 7', () => {
    const bits = lcCramBits(LAYOUT, 3, 2, 4, combinational(expandTruth(AND2)))
    expect(bits.every((b) => b.x === 2 && b.y === 4)).toBe(true)
    expect(bits.every((b) => b.row === 6 || b.row === 7)).toBe(true) // 2·3 and 2·3+1
  })
})

describe('decodeLc — the exact inverse of lcCramBits', () => {
  test('round-trips every config, including the flip-flop bits', () => {
    const configs: LcConfig[] = [
      combinational(expandTruth(AND2)),
      combinational(expandTruth(XOR2)),
      combinational(Array.from({ length: 16 }, (_, i) => i % 3 === 0)),
      {
        truth: Array.from({ length: 16 }, (_, i) => (i & 5) === 5),
        carryEnable: true,
        dffEnable: true,
        setNoReset: false,
        asyncSetReset: true,
      },
    ]
    for (const cell of [0, 1, 7]) {
      for (const config of configs) {
        const decoded = decodeLc(LAYOUT, cell, 3, 5, lcCramBits(LAYOUT, cell, 3, 5, config))
        expect(decoded).toEqual(config)
      }
    }
  })

  test('an all-zero tile decodes to an empty cell (constant-0 LUT, no flip-flop)', () => {
    const decoded = decodeLc(LAYOUT, 0, 1, 1, [])
    expect(decoded.truth.every((b) => b === false)).toBe(true)
    expect(decoded).toMatchObject({ carryEnable: false, dffEnable: false })
  })

  test('bits from a DIFFERENT tile are ignored (decode reads only its own tile coordinates)', () => {
    const onTile11 = lcCramBits(LAYOUT, 0, 1, 1, combinational(expandTruth(AND2)))
    const noise = lcCramBits(LAYOUT, 0, 2, 2, combinational(expandTruth(XOR2)))
    const decoded = decodeLc(LAYOUT, 0, 1, 1, [...onTile11, ...noise])
    expect(decoded.truth).toEqual(expandTruth(AND2)) // tile (2,2)'s XOR bits did not bleed in
  })
})

describe('END-TO-END: a real mapped LUT function survives encode → decode → evaluate', () => {
  for (const { name, config } of [
    { name: 'AND2', config: AND2 },
    { name: 'XOR2', config: XOR2 },
  ]) {
    test(`${name} (a KLut.config) programs a real cell and computes correctly`, () => {
      const truth = expandTruth(config)
      const decoded = decodeLc(LAYOUT, 2, 1, 1, lcCramBits(LAYOUT, 2, 1, 1, combinational(truth)))
      for (let combo = 0; combo < 4; combo++) {
        const [i0, i1] = inputs(combo)
        const expected = name === 'AND2' ? i0 && i1 : i0 !== i1
        expect(evalLut4(decoded.truth, i0, i1, false, false)).toBe(expected)
      }
    })
  }
})

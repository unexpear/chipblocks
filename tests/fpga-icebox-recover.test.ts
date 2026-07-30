/**
 * FPGA fabric — Stage 3a: recover logic-cell functions from a whole real-format .bin (fpga-icebox-recover.ts).
 *
 * The headline test reads fixtures/icebox-ice40-384-cells.bin — a GENUINE icepack-packed 384 bitstream — and
 * recovers the three logic cells it was built from (a registered AND2, a buffer, and an XOR2 in a top-right tile),
 * each with its exact LUT4 + flip-flop config. The whole real chain runs: parse the .bin → CRAM banks → per-tile
 * bits via the geometry → decode each logic tile's cells. The fixture was produced by writing those cells' bits
 * (via lcCramBits) into a .asc and packing it with the real icepack tool ("CRC Check OK / Chip type '384'").
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { type BinBanks, parseBinFile } from '../src/renderer/fpga-icebox-bin.ts'
import { cramIndex, tileType } from '../src/renderer/fpga-icebox-cram-index.ts'
import {
  expandTruth,
  type LcConfig,
  lcCramBits,
  parseLogicTileBits,
} from '../src/renderer/fpga-icebox-logic.ts'
import { recoverLogicCells } from '../src/renderer/fpga-icebox-recover.ts'

const LAYOUT = parseLogicTileBits(
  readFileSync(
    new URL('../fixtures/icebox-ice40-384-logic-tile-bits.chipdb', import.meta.url),
    'utf8',
  ),
)
const comb = (t: boolean[]): LcConfig => ({
  truth: expandTruth(t),
  carryEnable: false,
  dffEnable: false,
  setNoReset: false,
  asyncSetReset: false,
})
const reg = (t: boolean[]): LcConfig => ({ ...comb(t), dffEnable: true })

describe('recoverLogicCells — read a real vendor .bin and recover its logic-cell functions', () => {
  const BIN = new Uint8Array(
    readFileSync(new URL('../fixtures/icebox-ice40-384-cells.bin', import.meta.url)),
  )
  const cells = recoverLogicCells('384', parseBinFile(BIN).cram, LAYOUT)

  test('recovers exactly the three encoded cells with their LUT4 + FF configs', () => {
    const byKey = new Map(cells.map((c) => [`${c.x}_${c.y}_${c.cell}`, c.config]))
    expect(byKey.get('1_1_0')).toEqual(reg([false, false, false, true])) // registered AND2
    expect(byKey.get('1_1_5')).toEqual(comb([false, true])) // buffer
    expect(byKey.get('4_6_2')).toEqual(comb([false, true, true, false])) // XOR2 (top-right bank)
    expect(cells).toHaveLength(3)
  })

  test('every recovered cell sits on a logic tile — the real .bin decodes to no phantom cells', () => {
    expect(cells.every((c) => tileType('384', c.x, c.y) === 'logic')).toBe(true)
  })
})

describe('recoverLogicCells — the logic-tile filter (1k, which has RAM tiles that can hold cell-like bits)', () => {
  // On the 1k, tiles x=3 and x=10 are RAM (ramb/ramt, 42 bits wide) — wide enough to hold LC bit positions, so a
  // ram tile with the right bits WOULD decode into a phantom cell. The filter must exclude it. (On the 384 the
  // filter is inert: io tiles are only 18 bits wide and cannot hold any LC bit, so they never phantom.)
  const set1k = (
    cram: BinBanks,
    tileX: number,
    tileY: number,
    bitX: number,
    bitY: number,
  ): void => {
    const { bank, x, y } = cramIndex('1k', tileX, tileY, bitX, bitY)
    ;((cram[bank] as boolean[][])[x] as boolean[])[y] = true
  }

  test('bits in a non-logic (ram) tile are not decoded as cells; a real logic cell survives', () => {
    const cram: BinBanks = Array.from({ length: 4 }, () =>
      Array.from({ length: 332 }, () => Array.from({ length: 144 }, () => false)),
    )
    // stamp cell-like bits into RAM tile (3,1) — without the filter decodeUsedCells phantoms it as a ramb cell
    for (const b of lcCramBits(LAYOUT, 0, 3, 1, comb([false, false, false, true])))
      if (b.value === 1 && b.col < 42) set1k(cram, 3, 1, b.col, b.row)
    // and a genuine logic cell at (1,1)
    for (const b of lcCramBits(LAYOUT, 0, 1, 1, reg([false, false, false, true])))
      if (b.value === 1) set1k(cram, 1, 1, b.col, b.row)

    const cells = recoverLogicCells('1k', cram, LAYOUT)
    expect(cells.every((c) => tileType('1k', c.x, c.y) === 'logic')).toBe(true) // the ram-tile phantom is filtered out
    expect(cells.some((c) => c.x === 3 && c.y === 1)).toBe(false) // nothing decoded from the RAM tile
    expect(cells.find((c) => c.x === 1 && c.y === 1 && c.cell === 0)?.config).toEqual(
      reg([false, false, false, true]),
    ) // the real logic cell survives
  })
})

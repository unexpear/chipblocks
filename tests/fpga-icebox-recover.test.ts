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
import { parseIceboxChipdb } from '../src/renderer/fpga-icebox.ts'
import { type BinBanks, parseBinFile } from '../src/renderer/fpga-icebox-bin.ts'
import { cramIndex, tileType } from '../src/renderer/fpga-icebox-cram-index.ts'
import {
  expandTruth,
  type LcConfig,
  lcCramBits,
  parseLogicTileBits,
} from '../src/renderer/fpga-icebox-logic.ts'
import { recoverLogicCells, recoverNetlist } from '../src/renderer/fpga-icebox-recover.ts'
import { simulateCombinational } from '../src/renderer/fpga-icebox-run.ts'

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

describe('recoverLogicCells — a real NON-384 vendor .bin (1k) with set/reset + carry cells', () => {
  // A GENUINE icepack-packed 1k bitstream (cells authored via lcCramBits -> .asc -> real icepack -> .bin). Covers a
  // different device geometry, the set/reset + carry flip-flop bits, and a top-right (bank 3) tile — none of which
  // the 384 fixture exercises. It also has real RAM tiles present, so the logic-tile filter runs on real data.
  const BIN = new Uint8Array(
    readFileSync(new URL('../fixtures/icebox-ice40-1k-cells.bin', import.meta.url)),
  )
  const cells = recoverLogicCells('1k', parseBinFile(BIN).cram, LAYOUT)

  test('recovers the three cells with their full FF config (async-set, carry+dff, comb) — no phantoms', () => {
    const byKey = new Map(cells.map((c) => [`${c.x}_${c.y}_${c.cell}`, c.config]))
    expect(byKey.get('1_1_0')).toEqual({
      truth: expandTruth([false, false, false, true]),
      carryEnable: false,
      dffEnable: true,
      setNoReset: true,
      asyncSetReset: true, // async SET registered AND2
    })
    expect(byKey.get('1_1_3')).toEqual({
      truth: expandTruth([false, true]),
      carryEnable: true,
      dffEnable: true,
      setNoReset: false,
      asyncSetReset: false, // buffer, carry + dff
    })
    expect(byKey.get('8_14_2')).toEqual(comb([false, true, true, false])) // XOR2 in a top-right (bank 3) tile
    expect(cells).toHaveLength(3)
    expect(cells.every((c) => tileType('1k', c.x, c.y) === 'logic')).toBe(true) // ram tiles produce no phantoms
  })
})

describe('recoverNetlist — load a real routed vendor .bin and simulate it (384, full chipdb)', () => {
  // The capstone: fixtures/icebox-ice40-384-routed.bin is a GENUINE icepack-packed 384 bitstream of a real
  // routed design (A = i0 & i1 in cell 0, feeding B = buffer(A) in cell 5, wired through the chip's REAL routing),
  // and fixtures/icebox-ice40-384-chipdb.txt is the full Project IceStorm chip database. This loads the .bin like
  // a user's own file — device detected from it — then rebuilds the whole netlist (cells + routing) and runs it.
  const DEVICE = parseIceboxChipdb(
    readFileSync(new URL('../fixtures/icebox-ice40-384-chipdb.txt', import.meta.url), 'utf8'),
  )
  const BIN = new Uint8Array(
    readFileSync(new URL('../fixtures/icebox-ice40-384-routed.bin', import.meta.url)),
  )

  test('rebuilds A→B connectivity from the recovered routing and computes B = A = i0 & i1', () => {
    const parsed = parseBinFile(BIN)
    expect(parsed.device).toBe('384') // device auto-detected from the loaded file, not assumed
    const netlist = recoverNetlist('384', DEVICE, LAYOUT, parsed.cram)

    const a = netlist.cells.find((c) => c.ref.cell === 0)
    const b = netlist.cells.find((c) => c.ref.cell === 5)
    // B's input traces back to A (cell 0) through the routing recovered from the real bitstream
    expect(b?.inputs.some((i) => i.kind === 'cell' && i.driver.cell === 0)).toBe(true)
    // A reads two external primary inputs (i0, i1)
    const primNets = (a?.inputs ?? [])
      .filter((i) => i.kind === 'primary')
      .map((i) => (i as { net: number }).net)
    expect(primNets).toHaveLength(2)

    // simulate the whole thing straight from the loaded bitstream: B (cell 5) = A (cell 0) = i0 & i1
    for (const i0 of [false, true])
      for (const i1 of [false, true]) {
        const sim = simulateCombinational(
          netlist,
          new Map([
            [primNets[0] as number, i0],
            [primNets[1] as number, i1],
          ]),
        )
        expect(sim.outputs.get('1_1_5')).toBe(i0 && i1)
      }
  })
})

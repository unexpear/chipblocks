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
  // The capstone: fixtures/icebox-ice40-384-vendor-xor5.bin is a GENUINE icepack-packed 384 bitstream, built by
  // the vendor toolchain (yosys -> nextpnr-ice40 --lp384 --package qn32 -> icepack) from
  // `module top(input [4:0] i, output y); assign y = ^i; endmodule` — so its five inputs are really routed in
  // from IO blocks and its LUTs are really wired to each other. fixtures/icebox-ice40-384-chipdb.txt is the full
  // Project IceStorm chip database. This loads the .bin like a user's own file — device detected from it — then
  // rebuilds the whole netlist (cells + routing) and runs it.
  //
  // It used to run on icebox-ice40-384-routed.bin, a bitstream from our OWN place-and-route, and drove that
  // design's two LUT input pins to assert `B = A = i0 & i1`. Our flow leaves primary inputs at the fabric edge
  // (see `synthesizeBitstream`), so those pins carry no routing at all — on silicon they read LOW, and the
  // assertion was about a design the bitstream does not describe. That fixture's honest reading is checked in
  // fpga-icebox-unrouted-pins.test.ts; the end-to-end proof belongs on a file whose inputs exist.
  const DEVICE = parseIceboxChipdb(
    readFileSync(new URL('../fixtures/icebox-ice40-384-chipdb.txt', import.meta.url), 'utf8'),
  )
  const BIN = new Uint8Array(
    readFileSync(new URL('../fixtures/icebox-ice40-384-vendor-xor5.bin', import.meta.url)),
  )

  test('rebuilds cell-to-cell connectivity from the recovered routing and computes the design (parity of 5)', () => {
    const parsed = parseBinFile(BIN)
    expect(parsed.device).toBe('384') // device auto-detected from the loaded file, not assumed
    const netlist = recoverNetlist('384', DEVICE, LAYOUT, parsed.cram)

    // one cell's input traces back to another cell through the routing recovered from the real bitstream
    expect(netlist.cells.some((c) => c.inputs.some((i) => i.kind === 'cell'))).toBe(true)
    // and the design's five external inputs come back — five, exactly what the vendor's own module header says
    const primNets = [
      ...new Set(
        netlist.cells.flatMap((c) =>
          c.inputs.filter((i) => i.kind === 'primary').map((i) => i.net),
        ),
      ),
    ]
    expect(primNets).toHaveLength(5)

    // simulate the whole thing straight from the loaded bitstream: exactly one cell is `y = ^i`
    const parityCells = netlist.cells
      .map((c) => `${c.ref.x}_${c.ref.y}_${c.ref.cell}`)
      .filter((key) => {
        for (let pattern = 0; pattern < 32; pattern++) {
          const stimulus = new Map(primNets.map((net, k) => [net, ((pattern >> k) & 1) === 1]))
          let parity = false
          for (let k = 0; k < 5; k++) parity = parity !== (((pattern >> k) & 1) === 1)
          if (simulateCombinational(netlist, stimulus).outputs.get(key) !== parity) return false
        }
        return true
      })
    expect(parityCells).toHaveLength(1)
  })
})

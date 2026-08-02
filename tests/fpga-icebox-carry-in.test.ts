/**
 * FPGA fabric — iCE40: the tile's CarryInSet bit on the REAL-FILE path.
 *
 * A carry chain starts at zero or at one, and the tile's CarryInSet bit is what says which. That is the whole
 * difference between an adder and a subtractor or an incrementer.
 *
 * `recoverNetlist` — the path `loadIce40Bitstream` uses, and therefore the path any real `.bin` takes — used to
 * build the netlist without passing the tile data at all, so the constant carry-in was always zero however the
 * bitstream was programmed. The decoder for the bit existed and worked; only hand-built tests ever reached it.
 * A real 4-bit `a - b` came back with 128 of its 256 outputs wrong. Adders were unaffected, which is why every
 * test in the repo was content.
 *
 * This builds a 4-bit incrementer out of the real chipdb's own pips, packs it, and loads it back the way a user
 * would. Counting is the cheapest thing that can only work if the carry starts at one.
 *
 * Adopted from the reproduction an adversarial audit produced.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { cramBitsForRoute, parseIceboxChipdb } from '../src/renderer/fpga-icebox.ts'
import { type BinBanks, parseBinFile, serializeBinFile } from '../src/renderer/fpga-icebox-bin.ts'
import { cramIndex, cramToProgrammedBits } from '../src/renderer/fpga-icebox-cram-index.ts'
import { loadIce40Bitstream } from '../src/renderer/fpga-icebox-load.ts'
import { type LcConfig, lcCramBits, parseLogicTileBits } from '../src/renderer/fpga-icebox-logic.ts'
import { parseBitstream } from '../src/renderer/fpga-icebox-parse.ts'
import { reconstructNetlist, simulateCombinational } from '../src/renderer/fpga-icebox-run.ts'
import { buildWireIndex } from '../src/renderer/fpga-icebox-synth.ts'

const DEVICE = parseIceboxChipdb(
  readFileSync(new URL('../fixtures/icebox-ice40-384-chipdb.txt', import.meta.url), 'utf8'),
)
const LAYOUT = parseLogicTileBits(
  readFileSync(
    new URL('../fixtures/icebox-ice40-384-logic-tile-bits.chipdb', import.meta.url),
    'utf8',
  ),
)
const REF = parseBinFile(
  new Uint8Array(readFileSync(new URL('../fixtures/icebox-ice40-384-routed.bin', import.meta.url))),
)

const TX = 1
const TY = 1
const carryLc = (truth: boolean[]): LcConfig => ({
  truth,
  carryEnable: true,
  dffEnable: false,
  setNoReset: false,
  asyncSetReset: false,
})
const NOT_IN1 = Array.from({ length: 16 }, (_, i) => ((i >> 1) & 1) === 0)
const XOR_IN1_IN3 = Array.from({ length: 16 }, (_, i) => Boolean(((i >> 1) & 1) ^ ((i >> 3) & 1)))

/** build a fresh all-zero 384 CRAM of the real fixture's dimensions */
function blankCram(): BinBanks {
  return Array.from({ length: 4 }, () =>
    Array.from({ length: REF.cramWidth }, () =>
      Array.from({ length: REF.cramHeight }, () => false),
    ),
  )
}

/** the 4-bit incrementer: cells 0..3 of tile (1,1), carry chain started by the tile's CarryInSet bit */
function buildIncrementerCram(setCarryInSet: boolean): BinBanks {
  const cram = blankCram()
  const set = (bitX: number, bitY: number): void => {
    const { bank, x, y } = cramIndex('384', TX, TY, bitX, bitY)
    ;((cram[bank] as boolean[][])[x] as boolean[])[y] = true
  }
  for (let cell = 0; cell < 4; cell++) {
    const cfg = carryLc(cell === 0 ? NOT_IN1 : XOR_IN1_IN3)
    for (const b of lcCramBits(LAYOUT, cell, TX, TY, cfg)) if (b.value === 1) set(b.col, b.row)
  }
  // the REAL cout(n) -> in_3(n+1) pips out of the chipdb
  const idx = buildWireIndex(DEVICE)
  const chainPips = []
  for (let cell = 0; cell < 3; cell++) {
    const cout = idx.get(`${TX}_${TY}_lutff_${cell}/cout`)
    const in3 = idx.get(`${TX}_${TY}_lutff_${cell + 1}/in_3`)
    const pip = DEVICE.pips.find((p) => p.x === TX && p.y === TY && p.src === cout && p.dst === in3)
    expect(pip).toBeDefined()
    chainPips.push(pip as (typeof DEVICE.pips)[number])
  }
  const { bits, conflicts } = cramBitsForRoute(chainPips)
  expect(conflicts).toEqual([])
  for (const b of bits) if (b.value === 1) set(b.col, b.row)
  // the tile's CarryInSet bit (icebox get_carry_bit, B1[50] per the chipdb)
  if (setCarryInSet) {
    const at = LAYOUT.carryInSet as { row: number; col: number }
    expect(at).toEqual({ row: 1, col: 50 })
    set(at.col, at.row)
  }
  return cram
}

/** run the netlist over a=0..15 driving each stage's in_1, read cells 0..3 as the sum bits */
function runIncrementer(netlist: ReturnType<typeof reconstructNetlist>): number[] {
  const idx = buildWireIndex(DEVICE)
  const inNet = (cell: number): number => idx.get(`${TX}_${TY}_lutff_${cell}/in_1`) as number
  const got: number[] = []
  for (let a = 0; a < 16; a++) {
    const primary = new Map<number, boolean>()
    for (let bit = 0; bit < 4; bit++) primary.set(inNet(bit), ((a >> bit) & 1) === 1)
    const sim = simulateCombinational(netlist, primary)
    got.push(
      [0, 1, 2, 3].reduce((acc, i) => acc + (sim.outputs.get(`${TX}_${TY}_${i}`) ? 1 << i : 0), 0),
    )
  }
  return got
}

describe('ADVERSARIAL VERIFY: CarryInSet on the real .bin path', () => {
  const cram = buildIncrementerCram(true)
  const expected = Array.from({ length: 16 }, (_, a) => (a + 1) & 15)

  test('the hand-built parseBitstream path decodes the CarryInSet bit', () => {
    const parsed = parseBitstream(cramToProgrammedBits('384', cram), DEVICE, LAYOUT)
    const netlist = reconstructNetlist(parsed, DEVICE)
    const cell0 = netlist.cells.find((c) => c.ref.cell === 0)
    console.log('parseBitstream path : cells =', netlist.cells.length)
    console.log('parseBitstream path : cell0.carryInConst =', cell0?.carryInConst)
    console.log('parseBitstream path : cell0.carryInSource =', JSON.stringify(cell0?.carryInSource))
    console.log('parseBitstream path : result =', runIncrementer(netlist).join(' '))
    expect(cell0?.carryInConst).toBe(true)
    expect(runIncrementer(netlist)).toEqual(expected)
  })

  test('the real .bin path (serialize -> loadIce40Bitstream -> recoverNetlist)', () => {
    const bytes = serializeBinFile({
      cramWidth: REF.cramWidth,
      cramHeight: REF.cramHeight,
      cram,
    })
    const loaded = loadIce40Bitstream(bytes, { '384': { device: DEVICE, layout: LAYOUT } })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    console.log('loadIce40Bitstream  : device', loaded.device, 'crcOk', loaded.crcOk)
    const cell0 = loaded.netlist.cells.find((c) => c.ref.cell === 0)
    console.log('loadIce40Bitstream  : cells =', loaded.netlist.cells.length)
    console.log('loadIce40Bitstream  : cell0.carryInConst =', cell0?.carryInConst)
    console.log('expected a+1        :', expected.join(' '))
    console.log('loadIce40 gave      :', runIncrementer(loaded.netlist).join(' '))
    expect(cell0?.carryInConst).toBe(true)
    expect(runIncrementer(loaded.netlist)).toEqual(expected)
  })
})

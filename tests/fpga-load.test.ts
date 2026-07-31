/**
 * FPGA fabric — one front door for both families (fpga-load.ts).
 *
 * A user picks a file and gets a simulatable netlist or an honest refusal, with the FAMILY detected from the
 * file's own sync pattern. Both supported families are exercised with real data: the committed genuine iCE40
 * bitstream, and an ECP5 bitstream assembled to Trellis's own container spec carrying a real LUT at real device
 * coordinates.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { parseIceboxChipdb } from '../src/renderer/fpga-icebox.ts'
import type { Ice40ChipDb } from '../src/renderer/fpga-icebox-load.ts'
import { parseLogicTileBits } from '../src/renderer/fpga-icebox-logic.ts'
import { simulateCombinational } from '../src/renderer/fpga-icebox-run.ts'
import {
  type BitstreamReferences,
  detectBitstreamFamily,
  type Ecp5ChipDb,
  loadBitstream,
} from '../src/renderer/fpga-load.ts'
import { crc16Trellis } from '../src/renderer/fpga-trellis-bit.ts'
import {
  type Ecp5Tile,
  parseEcp5TileBits,
  parseEcp5TileGrid,
} from '../src/renderer/fpga-trellis-tiles.ts'

const ICE40: Record<string, Ice40ChipDb> = {
  '384': {
    device: parseIceboxChipdb(
      readFileSync(new URL('../fixtures/icebox-ice40-384-chipdb.txt', import.meta.url), 'utf8'),
    ),
    layout: parseLogicTileBits(
      readFileSync(
        new URL('../fixtures/icebox-ice40-384-logic-tile-bits.chipdb', import.meta.url),
        'utf8',
      ),
    ),
  },
}
const GRID = parseEcp5TileGrid(
  readFileSync(
    new URL('../fixtures/trellis-ecp5-LFE5U-25F-tilegrid.json', import.meta.url),
    'utf8',
  ),
)
const PLC2 = parseEcp5TileBits(
  readFileSync(new URL('../fixtures/trellis-ecp5-PLC2-bits.db', import.meta.url), 'utf8'),
)
const ECP5: Record<string, Ecp5ChipDb> = {
  'LFE5U-25F': { grid: GRID, tileDb: (t) => (t === 'PLC2' ? PLC2 : null) },
}
const REFS: BitstreamReferences = { ice40: ICE40, ecp5: ECP5 }
const read = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)))

const AND2 = Array.from({ length: 16 }, (_, i) => (i & 1) === 1 && ((i >> 1) & 1) === 1)

/** Build a real-format ECP5 bitstream for the LFE5U-25F carrying one programmed LUT. */
function buildEcp5(idcode = 0x41111043): Uint8Array {
  const FRAMES = 7562
  const BITS = 592
  const frames = Array.from({ length: FRAMES }, () => new Uint8Array(BITS / 8))
  // stamp SLICEC.K1.INIT (LUT index 5) of tile R20C30 with AND2, through the real database bit positions
  const tile = GRID.get('R20C30:PLC2') as Ecp5Tile
  const word = PLC2.words.get('SLICEC.K1.INIT')
  if (word === undefined) throw new Error('missing INIT word')
  word.bits.forEach((group, i) => {
    for (const { frame, bit, inv } of group) {
      if (((AND2[i] as boolean) !== inv) === false) continue
      const absBit = tile.startBit + bit
      const row = frames[tile.startFrame + frame] as Uint8Array
      // a frame's bits are packed so that bit j lives at byte (len-1-j/8), bit j%8 (Trellis LSC_PROG_INCR_RTI)
      const idx = row.length - 1 - Math.floor(absBit / 8)
      row[idx] = (row[idx] as number) | (1 << (absBit % 8))
    }
  })

  const out: number[] = []
  let crc = 0
  const w = (b: number): void => {
    out.push(b & 0xff)
    crc = crc16Trellis(crc, b & 0xff)
  }
  const finalise = (c: number): number => {
    let x = c & 0xffff
    for (let i = 0; i < 16; i++) {
      const bit = (x >> 15) & 1
      x = (x << 1) & 0xffff
      if (bit) x ^= 0x8005
    }
    return x
  }
  const wCrc = (): void => {
    const v = finalise(crc)
    out.push((v >> 8) & 0xff, v & 0xff)
    crc = 0
  }
  out.push(0xff, 0xff, 0xbd, 0xb3) // preamble
  w(0xe2) // VERIFY_ID
  w(0)
  w(0)
  w(0)
  for (const shift of [24, 16, 8, 0]) w((idcode >>> shift) & 0xff)
  w(0x82) // LSC_PROG_INCR_RTI, check CRC after every frame
  w(0x80)
  w((FRAMES >> 8) & 0xff)
  w(FRAMES & 0xff)
  for (const row of frames) {
    for (const b of row) w(b)
    wCrc()
  }
  w(0x5e) // ISC_PROGRAM_DONE with check
  w(0x80)
  w(0)
  w(0)
  wCrc()
  return Uint8Array.from(out)
}

describe('detectBitstreamFamily — tells the two families apart by their sync pattern', () => {
  test('recognises a real iCE40 bitstream, a real-format ECP5 one, and neither in junk', () => {
    expect(detectBitstreamFamily(read('icebox-ice40-384-routed.bin'))).toBe('ice40')
    expect(detectBitstreamFamily(buildEcp5())).toBe('ecp5')
    const junk = Uint8Array.from(Array.from({ length: 64 }, (_, i) => (i * 7 + 1) & 0x7d))
    expect(detectBitstreamFamily(junk)).toBeNull()
  })
})

describe('loadBitstream — one door, both families, same netlist type', () => {
  test('an iCE40 file loads and simulates through the shared engine', () => {
    const result = loadBitstream(read('icebox-ice40-384-routed.bin'), REFS)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    expect([result.family, result.device, result.crcOk]).toEqual(['ice40', '384', true])
    const a = result.netlist.cells.find((c) => c.ref.cell === 0)
    const nets = (a?.inputs ?? [])
      .filter((i) => i.kind === 'primary')
      .map((i) => (i as { net: number }).net)
    for (const i0 of [false, true])
      for (const i1 of [false, true]) {
        const sim = simulateCombinational(
          result.netlist,
          new Map([
            [nets[0] as number, i0],
            [nets[1] as number, i1],
          ]),
        )
        expect(sim.outputs.get('1_1_5')).toBe(i0 && i1)
      }
  })

  test('an ECP5 file loads through the very same door and yields the same kind of netlist', () => {
    const result = loadBitstream(buildEcp5(), REFS)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    expect([result.family, result.device, result.crcOk]).toEqual(['ecp5', 'LFE5U-25F', true])
    // the LUT we programmed came back, at the device's own coordinates (R20C30 → x=30, y=20, cell 5)
    const lut = result.netlist.cells.find(
      (c) => c.ref.x === 30 && c.ref.y === 20 && c.ref.cell === 5,
    )
    expect(lut?.config.truth).toEqual(AND2)
  }, 60000)
})

describe('loadBitstream — refuses honestly', () => {
  test('a file of neither family is refused, naming what cannot be read', () => {
    const junk = Uint8Array.from(Array.from({ length: 64 }, (_, i) => (i * 7 + 1) & 0x7d))
    const result = loadBitstream(junk, REFS)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('junk should be refused')
    expect(result.reason).toMatch(/neither the iCE40 sync pattern/)
    expect(result.reason).toMatch(/encrypted/)
  })

  test('an ECP5 device with no chip database loaded is reported, not guessed at', () => {
    const result = loadBitstream(buildEcp5(), { ice40: ICE40 }) // ECP5 references deliberately absent
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('should refuse without an ECP5 database')
    expect(result.reason).toMatch(/LFE5U-25F/)
    expect(result.reason).toMatch(/no chip database/i)
  }, 60000)

  test('an unknown ECP5 IDCODE is reported rather than mapped to some other part', () => {
    const result = loadBitstream(buildEcp5(0x12345678), REFS)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unknown IDCODE should be refused')
    // the parser refuses first: without a known part it has no frame geometry to read the payload with. Either
    // way the reason names the unknown device and its IDCODE rather than silently using some other part.
    expect(result.reason).toMatch(/unknown device/)
    expect(result.reason).toMatch(/12345678/)
  }, 60000)

  test('an iCE40 device with no database loaded is reported by the iCE40 path', () => {
    const result = loadBitstream(read('icebox-ice40-5k-oddbanks.bin'), REFS)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('should refuse a 5k without its database')
    expect(result.reason).toMatch(/5k/)
  })
})

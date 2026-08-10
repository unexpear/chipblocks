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
  // ECP5 streams frames in REVERSE (the device's last frame goes first), so a realistic bitstream must too
  for (let i = frames.length - 1; i >= 0; i--) {
    for (const b of frames[i] as Uint8Array) w(b)
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
    // A vendor-built bitstream (`assign y = ^i` over 5 bits, lp384), so its inputs are really routed and the
    // shared door really has something to drive. It replaced our own flow's icebox-ice40-384-routed.bin, whose
    // LUT input pins carry no routing and therefore read LOW on silicon rather than being drivable inputs.
    const result = loadBitstream(read('icebox-ice40-384-vendor-xor5.bin'), REFS)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    expect([result.family, result.device, result.crcOk]).toEqual(['ice40', '384', true])
    const nets = [
      ...new Set(
        result.netlist.cells.flatMap((c) =>
          c.inputs.filter((i) => i.kind === 'primary').map((i) => i.net),
        ),
      ),
    ]
    expect(nets).toHaveLength(5)
    const parityCells = result.netlist.cells
      .map((c) => `${c.ref.x}_${c.ref.y}_${c.ref.cell}`)
      .filter((key) => {
        for (let pattern = 0; pattern < 32; pattern++) {
          const stimulus = new Map(nets.map((net, k) => [net, ((pattern >> k) & 1) === 1]))
          let parity = false
          for (let k = 0; k < 5; k++) parity = parity !== (((pattern >> k) & 1) === 1)
          if (simulateCombinational(result.netlist, stimulus).outputs.get(key) !== parity)
            return false
        }
        return true
      })
    expect(parityCells).toHaveLength(1)
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

  test('a design the decoder cannot fully model says so AT THE DOOR, not only inside the netlist', () => {
    // `RecoveredNetlist` carries nothing but `cells`, so the ECP5 netlist's `unfaithful` list used to stop at
    // this boundary: a caller loading a distributed-RAM bitstream got six cells presented as ordinary lookup
    // tables and no way to learn that a written memory is not a settled function. The real 16x4 distributed-RAM
    // bitstream (`MODE DPRAM` x2 + `MODE RAMW`, per ecpunpack) is the case that proves it comes through.
    const result = loadBitstream(read('trellis-ecp5-dpram.bit'), REFS)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    expect(result.unfaithful).toHaveLength(6)
    for (const listed of result.unfaithful ?? []) expect(listed.reason).toMatch(/distributed-RAM/)
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

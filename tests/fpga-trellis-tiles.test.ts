/**
 * FPGA fabric — ECP5 (Project Trellis): frames → tiles → SLICE LUT4s (fpga-trellis-tiles.ts).
 *
 * Everything here runs against REAL Project Trellis reference data, vendored unmodified:
 *   - fixtures/trellis-ecp5-LFE5U-25F-tilegrid.json — the LFE5U-25F tile grid (4312 tiles, 3036 of them PLC2)
 *   - fixtures/trellis-ecp5-PLC2-bits.db           — the PLC2 tile-type bit database
 * The decode is exercised end to end: take known LUT truth tables, ENCODE them into a frame array through the
 * real database's bit positions (honouring each bit's inversion), then decode with `decodeEcp5Luts` and require
 * the original truth tables back — at the real frame/bit coordinates of a real device.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { evalLut4 } from '../src/renderer/fpga-icebox-logic.ts'
import {
  decodeEcp5Luts,
  type Ecp5Tile,
  parseEcp5TileBits,
  parseEcp5TileGrid,
  readTileWord,
} from '../src/renderer/fpga-trellis-tiles.ts'

const GRID = parseEcp5TileGrid(
  readFileSync(
    new URL('../fixtures/trellis-ecp5-LFE5U-25F-tilegrid.json', import.meta.url),
    'utf8',
  ),
)
const PLC2 = parseEcp5TileBits(
  readFileSync(new URL('../fixtures/trellis-ecp5-PLC2-bits.db', import.meta.url), 'utf8'),
)
/** LFE5U-25F geometry (Trellis devices.json): 7562 frames of 592 bits. */
const FRAMES = 7562
const BITS_PER_FRAME = 592

/** A blank configuration-frame array for the LFE5U-25F. */
const blankFrames = (): boolean[][] =>
  Array.from({ length: FRAMES }, () => Array.from({ length: BITS_PER_FRAME }, () => false))

/** Write one LUT's truth table into the frames, through the real database bit positions. */
function writeLut(
  frames: boolean[][],
  tile: Ecp5Tile,
  slice: string,
  lut: number,
  truth: boolean[],
): void {
  const word = PLC2.words.get(`SLICE${slice}.K${lut}.INIT`)
  if (word === undefined) throw new Error(`no INIT word for SLICE${slice}.K${lut}`)
  word.bits.forEach((group, i) => {
    for (const { frame, bit, inv } of group) {
      // logical value = stored XOR inv, so stored = value XOR inv
      const row = frames[tile.startFrame + frame] as boolean[]
      row[tile.startBit + bit] = (truth[i] as boolean) !== inv
    }
  })
}

describe('parseEcp5TileGrid — the real LFE5U-25F tile grid', () => {
  test('reads every tile, with the frame/bit window Trellis uses', () => {
    expect(GRID.size).toBe(4312) // every tile — keyed by name:type, since 97 names are shared by two tiles
    const plc2 = [...GRID.values()].filter((t) => t.type === 'PLC2')
    expect(plc2).toHaveLength(3036) // the device's logic tiles

    const tile = GRID.get('R10C10:PLC2') as Ecp5Tile
    expect(tile.type).toBe('PLC2')
    // Trellis's Database.cpp reads "cols" as num_frames and "rows" as bits_per_frame — the JSON names are the
    // transpose of their meaning. Getting this backwards would put every tile's bits in the wrong place.
    expect([tile.numFrames, tile.bitsPerFrame]).toEqual([106, 12])
    expect([tile.startFrame, tile.startBit]).toEqual([990, 109])

    // every tile's window must fit inside the device's frame array
    for (const t of GRID.values()) {
      expect(t.startFrame + t.numFrames).toBeLessThanOrEqual(FRAMES)
      expect(t.startBit + t.bitsPerFrame).toBeLessThanOrEqual(BITS_PER_FRAME)
    }
  })
})

describe('parseEcp5TileBits — the real PLC2 bit database', () => {
  test('has all eight SLICE LUT INIT words, each 16 bits inside the tile window', () => {
    for (const slice of ['A', 'B', 'C', 'D'])
      for (const lut of [0, 1]) {
        const word = PLC2.words.get(`SLICE${slice}.K${lut}.INIT`)
        expect(word, `SLICE${slice}.K${lut}.INIT`).toBeDefined()
        expect(word?.bits).toHaveLength(16) // a LUT4 truth table
        for (const group of word?.bits ?? [])
          for (const b of group) {
            expect(b.frame).toBeLessThan(106) // within a PLC2's 106 frames
            expect(b.bit).toBeLessThan(12) // within its 12 bits per frame
          }
      }
  })

  test('every config default in this tile type is the all-ones word', () => {
    const word = PLC2.words.get('SLICEA.K0.INIT')
    expect(word?.defaultValue).toHaveLength(16)
    expect(word?.defaultValue.every((b) => b)).toBe(true) // ".config SLICEA.K0.INIT 1111111111111111"
    // NOTE: every `.config` default in PLC2 is all-ones, i.e. symmetric — so this fixture CANNOT distinguish the
    // word's bit order. That order (Trellis prints a word reversed, so entry 0 is the last character) is taken
    // from Trellis's `to_string(vector<bool>)` / `operator>>` in Util.hpp, not confirmed by these fixtures.
    const defaults = [...PLC2.words.values()].map((w) => w.defaultValue)
    expect(defaults.every((d) => d.every((b) => b))).toBe(true)
  })
})

describe('decodeEcp5Luts — real tiles, real bit positions, round-tripped truth tables', () => {
  const AND2 = Array.from({ length: 16 }, (_, i) => (i & 1) === 1 && ((i >> 1) & 1) === 1)
  const XOR3 = Array.from({ length: 16 }, (_, i) =>
    Boolean((i & 1) ^ ((i >> 1) & 1) ^ ((i >> 2) & 1)),
  )
  const MUX = Array.from({ length: 16 }, (_, i) =>
    ((i >> 2) & 1) === 1 ? (i & 1) === 1 : ((i >> 1) & 1) === 1,
  )

  test('encodes LUTs into real frames and decodes exactly those truth tables back', () => {
    const frames = blankFrames()
    const a = GRID.get('R10C10:PLC2') as Ecp5Tile
    const b = GRID.get('R20C30:PLC2') as Ecp5Tile
    expect([a.type, b.type]).toEqual(['PLC2', 'PLC2'])

    writeLut(frames, a, 'A', 0, AND2)
    writeLut(frames, a, 'C', 1, XOR3)
    writeLut(frames, b, 'D', 0, MUX)

    const luts = decodeEcp5Luts(frames, GRID, PLC2)
    const found = new Map(luts.map((l) => [`${l.tile}.${l.slice}.K${l.lut}`, l.truth]))
    expect(found.get('R10C10.A.K0')).toEqual(AND2)
    expect(found.get('R10C10.C.K1')).toEqual(XOR3)
    expect(found.get('R20C30.D.K0')).toEqual(MUX)
    expect(luts).toHaveLength(3) // untouched LUTs sit at their all-ones default and are not reported

    // and the recovered truth table drives our existing LUT evaluator directly
    for (let i = 0; i < 16; i++) {
      const [i0, i1, i2, i3] = [i & 1, (i >> 1) & 1, (i >> 2) & 1, (i >> 3) & 1].map(Boolean) as [
        boolean,
        boolean,
        boolean,
        boolean,
      ]
      expect(evalLut4(found.get('R10C10.A.K0') as boolean[], i0, i1, i2, i3)).toBe(i0 && i1)
      expect(evalLut4(found.get('R10C10.C.K1') as boolean[], i0, i1, i2, i3)).toBe(
        Boolean(Number(i0) ^ Number(i1) ^ Number(i2)),
      )
    }
  })

  test('a blank bitstream decodes to no LUTs, and includeDefault surfaces every one', () => {
    const frames = blankFrames()
    expect(decodeEcp5Luts(frames, GRID, PLC2)).toEqual([])
    // 3036 PLC2 tiles × 4 SLICEs × 2 LUTs — every LUT position the device has
    expect(decodeEcp5Luts(frames, GRID, PLC2, { includeDefault: true })).toHaveLength(3036 * 4 * 2)
  })

  test('a LUT is read from its own tile only — the same word in another tile is unaffected', () => {
    const frames = blankFrames()
    const a = GRID.get('R10C10:PLC2') as Ecp5Tile
    writeLut(frames, a, 'A', 0, AND2)
    const luts = decodeEcp5Luts(frames, GRID, PLC2)
    expect(luts).toHaveLength(1)
    expect(luts[0]?.tile).toBe('R10C10')
  })
})

describe('readTileWord — the inversion and window rules', () => {
  test('a stored bit reads through its inversion flag (value = stored XOR inv)', () => {
    const frames = blankFrames()
    const tile = GRID.get('R10C10:PLC2') as Ecp5Tile
    const word = PLC2.words.get('SLICEA.K0.INIT')
    if (word === undefined) throw new Error('missing INIT word')
    // every SLICEA.K0.INIT bit is inverted in the database, so all-zero storage reads as all-ones
    expect(word.bits.every((g) => g.every((b) => b.inv))).toBe(true)
    expect(readTileWord(frames, tile, word).every((v) => v)).toBe(true)
  })
})

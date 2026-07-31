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
  decodeEcp5Routing,
  decodeEcp5Slices,
  type Ecp5Bit,
  type Ecp5Tile,
  globaliseEcp5Wire,
  parseEcp5TileBits,
  parseEcp5TileGrid,
  readTileEnum,
  readTileMux,
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

/** Stamp a group of database bits into the frames so it MATCHES (stored = value XOR inv). */
function writeGroup(frames: boolean[][], tile: Ecp5Tile, bits: readonly Ecp5Bit[]): void {
  for (const { frame, bit, inv } of bits) {
    const row = frames[tile.startFrame + frame] as boolean[]
    row[tile.startBit + bit] = !inv
  }
}

describe('parseEcp5TileBits — the enum / mux / fixed-conn sections', () => {
  test('reads all four section kinds out of the real PLC2 database', () => {
    expect(PLC2.enums.size).toBe(91)
    expect(PLC2.muxes.size).toBe(128)
    expect(PLC2.fixedConns).toHaveLength(124)

    // the SLICE mode + flip-flop settings we need to know how a SLICE behaves
    expect(PLC2.enums.get('SLICEA.MODE')).toBeDefined()
    expect(PLC2.enums.get('SLICEA.REG0.SD')).toBeDefined()
    expect(PLC2.enums.get('SLICEA.REG0.REGSET')).toBeDefined()
    // an option with no bits is recorded as an empty group (it matches vacuously — hence the longest-match rule)
    const a0mux = PLC2.enums.get('SLICEA.A0MUX')
    expect(a0mux?.options.get('A0')).toEqual([])
    expect((a0mux?.options.get('1') ?? []).length).toBeGreaterThan(0)
  })
})

describe('readTileEnum / readTileMux — longest match wins (Trellis get_value / get_driver)', () => {
  test('an enum resolves to the option whose bits are set, not to the empty option', () => {
    const tile = GRID.get('R10C10:PLC2') as Ecp5Tile
    const setting = PLC2.enums.get('SLICEA.A0MUX')
    if (setting === undefined) throw new Error('missing A0MUX')
    const frames = blankFrames()
    // nothing programmed: the winning option IS the declared default, which Trellis reports as unset
    expect(readTileEnum(frames, tile, setting)).toBeNull()
    // program the "1" option's bits and it must win, because it matches with MORE bits
    writeGroup(frames, tile, setting.options.get('1') as Ecp5Bit[])
    expect(readTileEnum(frames, tile, setting)).toBe('1')
  })

  test('a mux reports the source its bits select, and nothing when unprogrammed', () => {
    const tile = GRID.get('R10C10:PLC2') as Ecp5Tile
    const mux = [...PLC2.muxes.values()].find((m) => m.arcs.size > 2)
    if (mux === undefined) throw new Error('no multi-source mux')
    const frames = blankFrames()
    expect(readTileMux(frames, tile, mux)).toBeNull() // no arc selected on a blank device
    const [source, bits] = [...mux.arcs.entries()].find(([, b]) => b.length > 0) as [
      string,
      Ecp5Bit[],
    ]
    writeGroup(frames, tile, bits)
    expect(readTileMux(frames, tile, mux)).toBe(source)
  })
})

describe('decodeEcp5Slices — LUTs and flip-flop modes together', () => {
  test('recovers a SLICE mode and its register settings alongside the LUTs', () => {
    const frames = blankFrames()
    const tile = GRID.get('R10C10:PLC2') as Ecp5Tile
    const AND2 = Array.from({ length: 16 }, (_, i) => (i & 1) === 1 && ((i >> 1) & 1) === 1)
    writeLut(frames, tile, 'A', 0, AND2)
    // put SLICEA into carry mode and make REG0 a SET flip-flop
    const mode = PLC2.enums.get('SLICEA.MODE') as NonNullable<ReturnType<typeof PLC2.enums.get>>
    writeGroup(frames, tile, mode.options.get('CCU2') as Ecp5Bit[])
    const regset = PLC2.enums.get('SLICEA.REG0.REGSET') as NonNullable<
      ReturnType<typeof PLC2.enums.get>
    >
    // RESET, not SET: SET is this enum's declared DEFAULT, and Trellis reports a default as unset
    writeGroup(frames, tile, regset.options.get('RESET') as Ecp5Bit[])

    const slices = decodeEcp5Slices(frames, GRID, PLC2)
    const a = slices.find((s) => s.tile === 'R10C10' && s.slice === 'A')
    expect(a?.luts[0]).toEqual(AND2)
    expect(a?.mode).toBe('CCU2') // the SLICE is in carry mode, not plain LOGIC
    expect(a?.regs[0]?.regset).toBe('RESET')
    expect(slices.every((s) => s.tile === 'R10C10' && s.slice === 'A')).toBe(true) // nothing else touched
  })

  test('a blank device yields no slices; includeDefault surfaces every SLICE position', () => {
    const frames = blankFrames()
    expect(decodeEcp5Slices(frames, GRID, PLC2)).toEqual([])
    expect(decodeEcp5Slices(frames, GRID, PLC2, { includeDefault: true })).toHaveLength(3036 * 4)
  })
})

describe('decodeEcp5Routing — the muxes become real connections', () => {
  test('a programmed mux is recovered as an arc in its own tile only', () => {
    const frames = blankFrames()
    const tile = GRID.get('R10C10:PLC2') as Ecp5Tile
    const mux = [...PLC2.muxes.values()].find((m) => [...m.arcs.values()].some((b) => b.length > 0))
    if (mux === undefined) throw new Error('no mux with bits')
    const [source, bits] = [...mux.arcs.entries()].find(([, b]) => b.length > 0) as [
      string,
      Ecp5Bit[],
    ]
    writeGroup(frames, tile, bits)

    const arcs = decodeEcp5Routing(frames, GRID, (t) => (t === 'PLC2' ? PLC2 : null))
    const mine = arcs.filter((a) => a.tile === 'R10C10' && a.sink === mux.sink)
    expect(mine).toHaveLength(1)
    expect(mine[0]?.source).toBe(source)
    // the bits we set select this source in OUR tile only — no other tile reports this sink/source pair
    expect(arcs.filter((a) => a.sink === mux.sink && a.source === source)).toEqual(mine)
  })

  test('tile types with no database loaded are skipped, never guessed at', () => {
    const frames = blankFrames()
    const arcs = decodeEcp5Routing(frames, GRID, () => null)
    expect(arcs).toEqual([])
  })

  test('fixed connections are reported on request', () => {
    const frames = blankFrames()
    const arcs = decodeEcp5Routing(frames, GRID, (t) => (t === 'PLC2' ? PLC2 : null), {
      includeFixed: true,
    })
    // every PLC2 tile's always-present connections are reported, alongside any programmed mux arcs
    expect(arcs.filter((a) => a.fixed)).toHaveLength(3036 * 124)
  })
})

describe('globaliseEcp5Wire — one physical wire, different names per tile', () => {
  test('N/S/E/W prefixes shift the tile coordinate (Trellis globalise_net_ecp5)', () => {
    // seen from tile (row 20, col 30): E1_ means the wire belongs to the tile one column EAST
    expect(globaliseEcp5Wire(20, 30, 'E1_H01E0001')).toEqual({ x: 31, y: 20, name: 'H01E0001' })
    expect(globaliseEcp5Wire(20, 30, 'W2_H02W0501')).toEqual({ x: 28, y: 20, name: 'H02W0501' })
    expect(globaliseEcp5Wire(20, 30, 'N1_V01N0001')).toEqual({ x: 30, y: 19, name: 'V01N0001' })
    expect(globaliseEcp5Wire(20, 30, 'S3_V02S0701')).toEqual({ x: 30, y: 23, name: 'V02S0701' })
    // both prefixes at once, and a bare name that belongs to the tile itself
    expect(globaliseEcp5Wire(20, 30, 'N1E2_X')).toEqual({ x: 32, y: 19, name: 'X' })
    expect(globaliseEcp5Wire(20, 30, 'F5')).toEqual({ x: 30, y: 20, name: 'F5' })
  })

  test('the SAME physical wire resolves identically from either tile that names it', () => {
    // tile (20,30) calling it "E1_H01E0001" and tile (20,31) calling it "H01E0001" are the same wire
    expect(globaliseEcp5Wire(20, 30, 'E1_H01E0001')).toEqual(globaliseEcp5Wire(20, 31, 'H01E0001'))
    // and a west-looking name from the far side agrees too
    expect(globaliseEcp5Wire(20, 32, 'W1_H01E0001')).toEqual(globaliseEcp5Wire(20, 31, 'H01E0001'))
  })

  test('global nets sit at a nominal (0,0), except spine/tap wires which stay in their tile', () => {
    expect(globaliseEcp5Wire(20, 30, 'G_PCLKT0')).toEqual({ x: 0, y: 0, name: 'G_PCLKT0' })
    expect(globaliseEcp5Wire(20, 30, 'G_HPBX0000')).toEqual({ x: 30, y: 20, name: 'G_HPBX0000' })
  })

  test('a wire that leaves the device is null, not a bogus coordinate', () => {
    expect(globaliseEcp5Wire(0, 0, 'W1_H01E0001')).toBeNull() // off the west edge
    expect(globaliseEcp5Wire(0, 0, 'N1_V01N0001')).toBeNull() // off the north edge
    expect(globaliseEcp5Wire(20, 30, 'E9_X', { maxRow: 50, maxCol: 32 })).toBeNull() // past the east edge
  })
})

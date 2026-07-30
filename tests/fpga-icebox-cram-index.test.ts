/**
 * FPGA fabric — Stage 3a: the CRAM bank ↔ tile geometry (fpga-icebox-cram-index.ts).
 *
 * The headline test proves the geometry against the REAL tool: fixtures/icebox-ice40-384-dense.asc is icepack's
 * own per-tile rendering (`icepack -u`) of a DENSE 384 bitstream (a distinct bit set in every tile row, so every
 * region carries data), and reconstructing every one of the device's 76 tiles (48 logic + 28 io) out of the parsed
 * .bin via tileBitsFromCram reproduces that .asc byte-for-byte. Because the fixture is dense, a wrong coordinate in
 * ANY branch of cramIndex — right-half X mirror, top/bottom-half Y flip, the bank quadrant, or the IO permutation —
 * makes some tile row diverge from icepack's (verified by mutation).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { parseBinFile } from '../src/renderer/fpga-icebox-bin.ts'
import {
  cramIndex,
  cramToProgrammedBits,
  tileBitsFromCram,
  tileType,
  tileWidth,
} from '../src/renderer/fpga-icebox-cram-index.ts'

const BIN = new Uint8Array(
  readFileSync(new URL('../fixtures/icebox-ice40-384-dense.bin', import.meta.url)),
)
const ASC = readFileSync(
  new URL('../fixtures/icebox-ice40-384-dense.asc', import.meta.url),
  'utf8',
).split('\n')
const CRAM = parseBinFile(BIN).cram

describe("cramIndex geometry — reconstructs icepack's own .asc from a parsed .bin (384)", () => {
  test("every one of the 384 device's 76 tiles matches icepack byte-for-byte", () => {
    const header = /^\.(logic_tile|io_tile|ramb_tile|ramt_tile) (\d+) (\d+)$/
    let tiles = 0
    const mismatches: string[] = []
    for (let i = 0; i < ASC.length; i++) {
      const m = ASC[i]?.match(header)
      if (!m) continue
      const x = Number(m[2])
      const y = Number(m[3])
      const grid = tileBitsFromCram('384', x, y, CRAM)
      for (let r = 0; r < 16; r++) {
        const got = grid[r]?.map((b) => (b ? '1' : '0')).join('')
        if (got !== ASC[i + 1 + r])
          mismatches.push(`${m[1]} ${x} ${y} row ${r}: want ${ASC[i + 1 + r]} got ${got}`)
      }
      tiles++
    }
    expect(mismatches).toEqual([])
    expect(tiles).toBe(76) // 48 logic + 28 io = every non-corner tile of the 8×10 grid
  })
})

describe('cramToProgrammedBits + cramIndex', () => {
  const countSetCram = (): number => {
    let n = 0
    for (const bank of CRAM) for (const col of bank) n += col.filter(Boolean).length
    return n
  }

  test('turns the parsed CRAM into per-tile ProgrammedBits: complete and self-consistent', () => {
    const bits = cramToProgrammedBits('384', CRAM)
    expect(bits.length).toBeGreaterThan(0)
    // completeness: every set CRAM bit is recovered exactly once (the tile map is a bijection over set bits)
    expect(bits.length).toBe(countSetCram())
    // self-consistency: each emitted bit really is set at the CRAM coordinate cramIndex computes for it
    for (const b of bits) {
      const { bank, x, y } = cramIndex('384', b.x, b.y, b.col, b.row)
      expect(CRAM[bank]?.[x]?.[y]).toBe(true)
    }
  })

  test('mirrors a right-half tile into the +2 bank of its left-half counterpart', () => {
    const left = cramIndex('384', 1, 1, 0, 0) // left half ⇒ bank bit 2 clear
    const right = cramIndex('384', 6, 1, 0, 0) // right half ⇒ bank bit 2 set
    expect(right.bank).toBe(left.bank | 2)
  })

  test('classifies the 384 grid: corners, the io border, the logic interior', () => {
    expect(tileType('384', 0, 0)).toBe('corner')
    expect(tileType('384', 1, 0)).toBe('io')
    expect(tileType('384', 1, 1)).toBe('logic')
    expect([tileWidth('logic'), tileWidth('io'), tileWidth('corner')]).toEqual([54, 18, 0])
  })
})

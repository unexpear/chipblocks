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

  test('turns the parsed CRAM into per-tile ProgrammedBits, self-consistent with the geometry', () => {
    const bits = cramToProgrammedBits('384', CRAM)
    expect(bits.length).toBeGreaterThan(0)
    // this dense fixture has zero out-of-tile (.extra_bit) cells, so every set CRAM bit IS in a tile and recovered
    expect(bits.length).toBe(countSetCram())
    // self-consistency: each emitted bit really is set at the CRAM coordinate cramIndex computes for it
    for (const b of bits) {
      const { bank, x, y } = cramIndex('384', b.x, b.y, b.col, b.row)
      expect(CRAM[bank]?.[x]?.[y]).toBe(true)
    }
  })

  test('emits only IN-TILE bits: an out-of-tile CRAM cell (an icepack .extra_bit) is dropped', () => {
    // an all-false 384 CRAM with one bit set INSIDE tile (1,1) at bit (col 1, row 0) — which cramIndex maps to
    // (bank 0, x 19, y 16) — and one bit set OUTSIDE any tile (col 180 is a padding column icepack calls .extra_bit).
    const cram = Array.from({ length: 4 }, (_, b) =>
      Array.from({ length: 182 }, (_, x) =>
        Array.from(
          { length: 80 },
          (_, y) => b === 0 && ((x === 19 && y === 16) || (x === 180 && y === 0)),
        ),
      ),
    )
    const bits = cramToProgrammedBits('384', cram)
    expect(bits).toContainEqual({ x: 1, y: 1, row: 0, col: 1, value: 1 }) // the in-tile bit is recovered
    expect(bits).toHaveLength(1) // the out-of-tile (col-180) bit is dropped — it belongs to no tile
  })

  test('mirrors a right-half tile into the +2 bank of its left-half counterpart', () => {
    const left = cramIndex('384', 1, 1, 0, 0) // left half ⇒ bank bit 2 clear
    const right = cramIndex('384', 6, 1, 0, 0) // right half ⇒ bank bit 2 set
    expect(right.bank).toBe(left.bank | 2)
  })

  test('matches icepack-derived golden coordinates for the branches the 384 fixture cannot reach', () => {
    // Each golden was obtained by placing ONE bit in that tile with the real icepack tool and reading where it
    // landed in the parsed CRAM — an independent oracle for the ram-width-42, 5k top-half (×2/3), and 8k branches.
    expect(cramIndex('1k', 3, 1, 0, 0)).toEqual({ bank: 0, x: 126, y: 16 }) // 1k ramb column (width 42)
    // 5k tileY 18 is BOTTOM half under icepack's ×2/3 rule (18 ≤ 20) but would be TOP under a naive /2 (18 > 15),
    // so this golden pins the 5k-specific boundary: bank 0, no Y flip, bank_ty 18 ⇒ y 288.
    expect(cramIndex('5k', 1, 18, 0, 0)).toEqual({ bank: 0, x: 54, y: 288 })
    expect(cramIndex('8k', 1, 1, 0, 0)).toEqual({ bank: 0, x: 18, y: 16 }) // 8k logic
  })

  test('classifies the 384 grid: corners, the io border, the logic interior', () => {
    expect(tileType('384', 0, 0)).toBe('corner')
    expect(tileType('384', 1, 0)).toBe('io')
    expect(tileType('384', 1, 1)).toBe('logic')
    expect([tileWidth('logic'), tileWidth('io'), tileWidth('corner')]).toEqual([54, 18, 0])
  })
})

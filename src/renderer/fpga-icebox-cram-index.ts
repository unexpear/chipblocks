/**
 * FPGA fabric — Stage 3a (real iCE40): the CRAM bank ↔ tile geometry. `fpga-icebox-bin.ts` parses a vendor `.bin`
 * into raw CRAM BANK bit-images (`cram[bank][x][y]`); this maps those bank coordinates back to per-TILE bits —
 * the missing link that lets a real vendor bitstream feed the existing tile-level flow (`decodeUsedCells` /
 * `pipsOnInBitstream` → `reconstructNetlist` → simulate).
 *
 * It is a faithful port of Project IceStorm's `icepack.cc` `CramIndexConverter` (its constructor + `get_cram_index`)
 * plus the device geometry it depends on (`chip_width`/`chip_height`/`chip_cols`/`tile_type`/`tile_width`, ISC).
 * `cramIndex(device, tileX, tileY, bitX, bitY)` returns the `(bank, x, y)` CRAM coordinate of one within-tile bit;
 * `tileBitsFromCram` reads a whole tile's 16 × tile-width bit grid out of parsed banks; `cramToProgrammedBits`
 * turns every in-tile set CRAM bit into the `ProgrammedBit`s the tile-level decoders consume. Cross-checked against
 * the real tool: `fixtures/icebox-ice40-384-dense.asc` is icepack's own per-tile rendering of a DENSE 384 bitstream,
 * and reconstructing every tile from the parsed `.bin` via this geometry reproduces that `.asc` exactly (see the
 * test); the same reconstruction was verified byte-for-byte against genuine icepack output for all six devices.
 *
 * Honest scope: this is the coordinate GEOMETRY for all six devices (384 / 1k / 8k / 5k / u4k / lm4k) and all tile
 * types (logic / io / ramb / ramt / dsp / ipcon). Turning the recovered per-tile bits into a simulatable netlist
 * still needs the target device's full chipdb (the logic-tile bit layout + routing pips), which the vendored
 * fixtures only carry in tiny slices — the remaining step to run a whole real vendor design.
 */

import type { ProgrammedBit } from './fpga-icebox.ts'
import type { BinBanks } from './fpga-icebox-bin.ts'

const CHIP_DIMS: Record<string, { width: number; height: number }> = {
  '384': { width: 6, height: 8 },
  '1k': { width: 12, height: 16 },
  '5k': { width: 24, height: 30 },
  u4k: { width: 24, height: 20 },
  lm4k: { width: 24, height: 20 },
  '8k': { width: 32, height: 32 },
}

// icepack chip_cols(): the bit-width of each tile-COLUMN (indexed by the mirrored bank_tx), per device.
const CHIP_COLS: Record<string, number[]> = {
  '384': [18, 54, 54, 54, 54],
  '1k': [18, 54, 54, 42, 54, 54, 54],
  u4k: [54, 54, 54, 54, 54, 54, 42, 54, 54, 54, 54, 54, 54],
  lm4k: [18, 54, 54, 54, 54, 54, 42, 54, 54, 54, 54, 54, 54],
  '5k': [54, 54, 54, 54, 54, 54, 42, 54, 54, 54, 54, 54, 54],
  '8k': [18, 54, 54, 54, 54, 54, 54, 54, 42, 54, 54, 54, 54, 54, 54, 54, 54],
}

function dims(device: string): { width: number; height: number } {
  const d = CHIP_DIMS[device]
  if (!d) throw new Error(`Unknown device '${device}'`)
  return d
}

export function chipWidth(device: string): number {
  return dims(device).width
}
export function chipHeight(device: string): number {
  return dims(device).height
}

/** The tile type at grid position (x, y): corner / io / logic / ramb / ramt / dsp0-3 / ipcon (icepack tile_type). */
export function tileType(device: string, x: number, y: number): string {
  const { width, height } = dims(device)
  const leftRight = x === 0 || x === width + 1
  const topBottom = y === 0 || y === height + 1
  if (leftRight && topBottom) return 'corner'
  if (device === '5k' && leftRight) {
    if (y === 5 || y === 10 || y === 15 || y === 23) return 'dsp0'
    if (y === 6 || y === 11 || y === 16 || y === 24) return 'dsp1'
    if (y === 7 || y === 12 || y === 17 || y === 25) return 'dsp2'
    if (y === 8 || y === 13 || y === 18 || y === 26) return 'dsp3'
    return 'ipcon'
  }
  if (device === 'u4k' && leftRight) {
    if (y === 5 || y === 13) return 'dsp0'
    if (y === 6 || y === 14) return 'dsp1'
    if (y === 7 || y === 15) return 'dsp2'
    if (y === 8 || y === 16) return 'dsp3'
    return 'ipcon'
  }
  if (leftRight || topBottom) return 'io'
  if (device === '384') return 'logic'
  if (device === '1k') return x === 3 || x === 10 ? (y % 2 === 1 ? 'ramb' : 'ramt') : 'logic'
  if (device === '5k' || device === 'u4k' || device === 'lm4k')
    return x === 6 || x === 19 ? (y % 2 === 1 ? 'ramb' : 'ramt') : 'logic'
  if (device === '8k') return x === 8 || x === 25 ? (y % 2 === 1 ? 'ramb' : 'ramt') : 'logic'
  throw new Error(`Unknown device '${device}'`)
}

/** The number of bit-columns a tile of `type` carries (icepack tile_width); every tile is 16 bit-rows tall. */
export function tileWidth(type: string): number {
  if (type === 'corner') return 0
  if (type === 'logic') return 54
  if (type === 'ramb' || type === 'ramt') return 42
  if (type === 'io') return 18
  if (type.startsWith('dsp')) return 54
  if (type === 'ipcon') return 54
  throw new Error(`Unknown tile type '${type}'`)
}

type Geometry = {
  type: string
  width: number
  leftRightIo: boolean
  rightHalf: boolean
  topHalf: boolean
  bankNum: number
  bankXoff: number
  bankYoff: number
  columnWidth: number
}

// The CramIndexConverter constructor: which bank quadrant a tile is in, and its bit offset within that bank.
function geometry(device: string, tileX: number, tileY: number): Geometry {
  const { width: chipW, height: chipH } = dims(device)
  const cols = CHIP_COLS[device] as number[]
  const type = tileType(device, tileX, tileY)
  const leftRightIo = tileX === 0 || tileX === chipW + 1
  const rightHalf = tileX > Math.floor(chipW / 2)
  const topHalf =
    device === '5k' ? tileY > Math.floor((chipH * 2) / 3) : tileY > Math.floor(chipH / 2)
  const bankNum = (topHalf ? 1 : 0) | (rightHalf ? 2 : 0)
  const bankTx = rightHalf ? chipW + 1 - tileX : tileX
  const bankTy = topHalf ? chipH + 1 - tileY : tileY
  let bankXoff = 0
  for (let i = 0; i < bankTx; i++) bankXoff += cols[i] as number
  return {
    type,
    width: tileWidth(type),
    leftRightIo,
    rightHalf,
    topHalf,
    bankNum,
    bankXoff,
    bankYoff: 16 * bankTy,
    columnWidth: cols[bankTx] as number,
  }
}

// The IO tiles on the top/bottom edges permute their bit rows/columns before mapping (icepack get_cram_index).
const IO_PERMX = [23, 25, 26, 27, 16, 17, 18, 19, 20, 14, 32, 33, 34, 35, 36, 37, 4, 5]
const IO_PERMY = [0, 1, 3, 2, 4, 5, 7, 6, 8, 9, 11, 10, 12, 13, 15, 14]

/** The CRAM coordinate `(bank, x, y)` of within-tile bit `(bitX, bitY)` of tile `(tileX, tileY)` — get_cram_index. */
export function cramIndex(
  device: string,
  tileX: number,
  tileY: number,
  bitX: number,
  bitY: number,
): { bank: number; x: number; y: number } {
  const g = geometry(device, tileX, tileY)
  let x: number
  let y: number
  if (g.type === 'io') {
    if (g.leftRightIo) {
      x = g.bankXoff + g.columnWidth - 1 - bitX
      y = g.topHalf ? g.bankYoff + 15 - bitY : g.bankYoff + bitY
    } else {
      y = g.bankYoff + 15 - (IO_PERMY[bitY] as number)
      x = g.rightHalf
        ? g.bankXoff + g.columnWidth - 1 - (IO_PERMX[bitX] as number)
        : g.bankXoff + (IO_PERMX[bitX] as number)
    }
  } else {
    x = g.rightHalf ? g.bankXoff + g.columnWidth - 1 - bitX : g.bankXoff + bitX
    y = g.topHalf ? g.bankYoff + (15 - bitY) : g.bankYoff + bitY
  }
  return { bank: g.bankNum, x, y }
}

/** A tile's 16 × tileWidth bit grid (`grid[bitY][bitX]`) read out of parsed CRAM banks via `cramIndex`. */
export function tileBitsFromCram(
  device: string,
  tileX: number,
  tileY: number,
  cram: BinBanks,
): boolean[][] {
  const width = tileWidth(tileType(device, tileX, tileY))
  const grid: boolean[][] = []
  for (let bitY = 0; bitY < 16; bitY++) {
    const row: boolean[] = []
    for (let bitX = 0; bitX < width; bitX++) {
      const { bank, x, y } = cramIndex(device, tileX, tileY, bitX, bitY)
      row.push(cram[bank]?.[x]?.[y] ?? false)
    }
    grid.push(row)
  }
  return grid
}

/**
 * Every set IN-TILE CRAM bit, attributed to its tile as a `ProgrammedBit` (`{x, y, row: bitY, col: bitX, value: 1}`)
 * — the per-tile representation the tile-level decoders (`decodeUsedCells`, `pipsOnInBitstream`) consume. Corner
 * tiles (zero width) are skipped. Note: CRAM cells that map to NO tile — icepack's `.extra_bit`s, e.g. padding
 * columns; ~8704 exist on the 384 alone — are intentionally NOT emitted: they belong to no tile and the tile-level
 * decoders cannot consume them. So the emitted count equals the number of set IN-TILE cells, not every set CRAM cell.
 */
export function cramToProgrammedBits(device: string, cram: BinBanks): ProgrammedBit[] {
  const { width: chipW, height: chipH } = dims(device)
  const bits: ProgrammedBit[] = []
  for (let tileY = 0; tileY <= chipH + 1; tileY++) {
    for (let tileX = 0; tileX <= chipW + 1; tileX++) {
      const width = tileWidth(tileType(device, tileX, tileY))
      for (let bitY = 0; bitY < 16; bitY++) {
        for (let bitX = 0; bitX < width; bitX++) {
          const { bank, x, y } = cramIndex(device, tileX, tileY, bitX, bitY)
          if (cram[bank]?.[x]?.[y])
            bits.push({ x: tileX, y: tileY, row: bitY, col: bitX, value: 1 })
        }
      }
    }
  }
  return bits
}

/**
 * FPGA fabric — Stage 3a (real iCE40): parse a bitstream back into its design.
 * The full staging is FPGA-FABRIC-RESEARCH.md §5, where this is the "headline payoff": load a bitstream and
 * recover what it programs. It is the exact REVERSE of the encode flow — where increment 3 turned a cell's
 * function into CRAM bits (`lcCramBits`) and increment 2/5 turned a routing into CRAM bits (`cramBitsForRoute`),
 * this reads those bits back:
 *   - `pipsOnInBitstream` — which routing switches the bits turn on (a pip is ON iff the bits hold exactly its
 *     activation condition), the inverse of `cramBitsForRoute`.
 *   - `decodeUsedCells` — which logic cells the bits configure and to what LUT4 + flip-flop function (via
 *     `decodeLc`), the inverse of `lcCramBits`.
 * So a design assembled to a bitstream (increments 4–6) round-trips: bitstream → the same placed cells + the
 * same ON pips it was built from. That is the same primitive a real-`.bin` reader needs for its documented
 * logic + routing bits.
 *
 * Honest scope: this recovers the PLACED CELLS (their LUT + FF configs) and the ON ROUTING PIPS from the CRAM
 * bits. It does NOT yet reconstruct the full logical netlist connectivity into a simulatable form ("watch it
 * run" — tracing the ON-pip paths from cell outputs to cell inputs and feeding the fast logic engine — is the
 * next increment), nor parse a whole vendor `.bin` FILE (its frame format, CRC, IO / PLL / BRAM and
 * unused-tile default bits are unmodeled; this reads the CRAM-bit representation our own flow produces, and the
 * documented logic/routing bits of a real one). A cell configured to a constant-0 LUT with no flip-flop is
 * indistinguishable from an unprogrammed cell and is read as unused — disclosed, not guessed. And
 * `decodeUsedCells` treats every tile the bits touch as a LOGIC tile (our own bitstreams only put bits on
 * logic tiles): parsing an arbitrary real image would first need a logic-tile filter (from the chipdb's
 * `.logic_tile` list) so routing- or IO-tile bits can't decode into phantom cells.
 */

import type { CramBit, IceboxDevice, IceboxPip, ProgrammedBit } from './fpga-icebox.ts'
import type { PlacedCell } from './fpga-icebox-bitstream.ts'
import { decodeLc, type LcConfig, type LogicTileBits } from './fpga-icebox-logic.ts'

const bitKey = (x: number, y: number, row: number, col: number): string => `${x}_${y}_${row}_${col}`

/**
 * The routing switches a bitstream turns on: a pip is ON iff the bits hold EVERY bit of its activation
 * `condition` at the required value (an unset bit defaults to 0). A condition with no bit required to be 1 is
 * never considered on — the all-default (all-zero) state programs nothing. The inverse of `cramBitsForRoute`.
 */
export function pipsOnInBitstream(
  bits: Iterable<ProgrammedBit>,
  pips: readonly IceboxPip[],
): IceboxPip[] {
  const value = new Map<string, 0 | 1>()
  for (const bit of bits) value.set(bitKey(bit.x, bit.y, bit.row, bit.col), bit.value)
  const on: IceboxPip[] = []
  for (const pip of pips) {
    if (!pip.condition.some((c) => c.value === 1)) continue // an all-zero condition is the default, never "on"
    const satisfied = pip.condition.every(
      (c) => (value.get(bitKey(pip.x, pip.y, c.bit.row, c.bit.col)) ?? 0) === c.value,
    )
    if (satisfied) on.push(pip)
  }
  return on
}

/** A configured cell is "used" if its LUT is not the constant-0 function or any of its flip-flop bits is set. */
function isUsed(config: LcConfig): boolean {
  return (
    config.truth.some((b) => b) ||
    config.carryEnable ||
    config.dffEnable ||
    config.setNoReset ||
    config.asyncSetReset
  )
}

/**
 * The logic cells a bitstream configures: for every logic tile the bits touch, each cell whose decoded config
 * is non-trivial (a non-constant-0 LUT, or any flip-flop bit set) is returned with its recovered `LcConfig`.
 * The inverse of `lcCramBits`. (Which tiles are logic tiles is inferred from which tiles the bits touch.)
 */
export function decodeUsedCells(
  bits: readonly ProgrammedBit[],
  layout: LogicTileBits,
): PlacedCell[] {
  const tiles = new Map<string, { x: number; y: number }>()
  for (const bit of bits) tiles.set(`${bit.x}_${bit.y}`, { x: bit.x, y: bit.y })
  const cells: PlacedCell[] = []
  for (const { x, y } of tiles.values()) {
    for (let cell = 0; cell < layout.cells.length; cell++) {
      const config = decodeLc(layout, cell, x, y, bits)
      if (isUsed(config)) cells.push({ x, y, cell, config })
    }
  }
  return cells
}

/** A design recovered from a bitstream: the configured logic cells, the ON routing pips, and each logic tile's
 *  shared config — the CarryInSet bit (the constant carry-in of cell 0 when nothing is cascaded in) and the
 *  NegClk bit (the whole tile's flip-flops clock on the FALLING edge). */
export type ParsedDesign = {
  cells: PlacedCell[]
  onPips: IceboxPip[]
  /** `"x_y"` → that tile's shared config. Absent for hand-built designs (carry-in 0, rising edge). */
  tiles?: Map<string, TileShared>
}

/** The config bits a logic tile shares across all eight of its cells. */
export type TileShared = {
  carryInSet: boolean
  /** the tile's flip-flops clock on the FALLING edge (icebox `get_negclk_bit`, B0[0]). */
  negClk: boolean
}

/**
 * Each logic tile's shared config bits.
 *
 * `CarryInSet` (icebox `get_carry_bit`, B1[50]) is the CONSTANT carry-in fed to cell 0 of the tile's chain when
 * no carry is cascaded in from the tile below — an adder that starts at 1 (a subtractor, or `a + 1`) sets it.
 *
 * `NegClk` (icebox `get_negclk_bit`, B0[0]) makes every flip-flop in the tile clock on the FALLING edge. It was
 * decoded into the layout and then read by nobody, so a design built with negative-edge flip-flops decoded to a
 * config identical to the positive-edge one and simulated a full clock period late — silently, with no warning.
 * icebox itself treats it as load-bearing: `icebox_vlog` writes `always @(negedge …)` when it is set.
 */
export function decodeTileShared(
  bits: readonly ProgrammedBit[],
  layout: LogicTileBits,
): Map<string, TileShared> {
  const tiles = new Map<string, TileShared>()
  const carryAt = layout.carryInSet
  const negClkAt = layout.negClk
  if (carryAt === null && negClkAt === null) return tiles
  const isSet = (bit: ProgrammedBit, at: CramBit | null): boolean =>
    at !== null && bit.row === at.row && bit.col === at.col && bit.value === 1
  for (const bit of bits) {
    const key = `${bit.x}_${bit.y}`
    // `bits` holds only the value-1 positions, so a tile whose bit is 0 never appears here — every tile seen at
    // all starts from both-false and is upgraded, rather than being assumed present.
    const tile = tiles.get(key) ?? { carryInSet: false, negClk: false }
    if (isSet(bit, carryAt)) tile.carryInSet = true
    if (isSet(bit, negClkAt)) tile.negClk = true
    tiles.set(key, tile)
  }
  return tiles
}

/**
 * Parse a bitstream back into its design: the configured logic cells (`decodeUsedCells`) and the ON routing
 * pips (`pipsOnInBitstream` over the device's switches). The inverse of assembling a design's bitstream.
 */
export function parseBitstream(
  bits: readonly ProgrammedBit[],
  device: IceboxDevice,
  layout: LogicTileBits,
): ParsedDesign {
  return {
    cells: decodeUsedCells(bits, layout),
    onPips: pipsOnInBitstream(bits, device.pips),
    tiles: decodeTileShared(bits, layout),
  }
}

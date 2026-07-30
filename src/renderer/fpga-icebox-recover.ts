/**
 * FPGA fabric — Stage 3a (real iCE40): recover the used LOGIC CELLS (their LUT4 + flip-flop functions) from a whole
 * real-format `.bin`. This is the join of the pieces built across the arc: parse the vendor file to CRAM banks
 * (`fpga-icebox-bin.ts`), map bank coordinates to per-tile bits (`fpga-icebox-cram-index.ts`), and decode each logic
 * tile's cells (`fpga-icebox-parse.ts` `decodeUsedCells`). It also closes the "logic-tile filter" gap that
 * `decodeUsedCells` documented: because a whole `.bin` sets bits in IO / RAM / (on some parts) DSP tiles too, the
 * per-tile bits are filtered to `tileType === 'logic'` first, so non-logic tiles can't decode into phantom cells.
 *
 * Honest scope: this recovers the CELL FUNCTIONS a real bitstream programs — which cells are used and their LUT4 +
 * FF config — for any of the six devices. It does NOT recover ROUTING (who drives whom): the on-pip trace that
 * `reconstructNetlist` needs requires the target device's full routing table (the chipdb's `.buffer`/`.routing`
 * pips), which the vendored fixtures carry only in tiny slices. So this is "read a real vendor bitstream and see
 * what its cells compute", the step before "reconnect and simulate it".
 */

import type { BinBanks } from './fpga-icebox-bin.ts'
import type { PlacedCell } from './fpga-icebox-bitstream.ts'
import { cramToProgrammedBits, tileType } from './fpga-icebox-cram-index.ts'
import type { LogicTileBits } from './fpga-icebox-logic.ts'
import { decodeUsedCells } from './fpga-icebox-parse.ts'

/**
 * The used logic cells recovered from a parsed `.bin`'s CRAM banks: every logic tile's non-trivial cells with their
 * decoded `LcConfig`. `layout` is the device's logic-tile bit layout (`parseLogicTileBits`). Only `logic` tiles are
 * decoded — IO / RAM / DSP tiles are filtered out so their bits never become phantom cells.
 */
export function recoverLogicCells(
  device: string,
  cram: BinBanks,
  layout: LogicTileBits,
): PlacedCell[] {
  const logicBits = cramToProgrammedBits(device, cram).filter(
    (bit) => tileType(device, bit.x, bit.y) === 'logic',
  )
  return decodeUsedCells(logicBits, layout)
}

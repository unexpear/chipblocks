/**
 * FPGA fabric — Stage 3a (real iCE40): recover a design from a whole real-format `.bin` — the join of the pieces
 * built across the arc: parse the vendor file to CRAM banks (`fpga-icebox-bin.ts`), map bank coordinates to
 * per-tile bits (`fpga-icebox-cram-index.ts`), decode each logic tile's cells (`fpga-icebox-parse.ts`
 * `decodeUsedCells`), and (given the device's full routing table) trace the wiring (`reconstructNetlist`). Two
 * entry points:
 *   - `recoverLogicCells` — the used cells and their LUT4 + FF functions (no routing needed).
 *   - `recoverNetlist` — the whole SIMULATABLE netlist: cells AND the routing that connects them, ready to run.
 * Both close the "logic-tile filter" gap `decodeUsedCells` documented: because a whole `.bin` sets bits in IO /
 * RAM / (on some parts) DSP tiles too, the per-tile bits are filtered to `tileType === 'logic'` first, so
 * non-logic tiles can't decode into phantom cells.
 *
 * Honest scope: recovering cell functions needs only the device's logic-tile bit layout; recovering the routing
 * additionally needs the device's full chipdb (its `.buffer`/`.routing` switch table). Only routing that switch
 * table describes is recovered — global networks, IO, and BRAM/DSP data paths are not traced — and an input that
 * cannot be traced to a driver is reported as a primary, never guessed.
 */

import type { IceboxDevice } from './fpga-icebox.ts'
import type { BinBanks } from './fpga-icebox-bin.ts'
import type { PlacedCell } from './fpga-icebox-bitstream.ts'
import { cramToProgrammedBits, tileType } from './fpga-icebox-cram-index.ts'
import type { LogicTileBits } from './fpga-icebox-logic.ts'
import { decodeUsedCells, pipsOnInBitstream } from './fpga-icebox-parse.ts'
import { type RecoveredNetlist, reconstructNetlist } from './fpga-icebox-run.ts'

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

/**
 * Recover a whole SIMULATABLE netlist from a parsed `.bin`'s CRAM banks: the used logic cells AND the routing that
 * connects them. This is the full "load a real vendor bitstream and reconstruct the design" step — cell functions
 * (`recoverLogicCells`) plus the ON routing pips (`pipsOnInBitstream` over the device's switch table), fed to
 * `reconstructNetlist` which traces who-drives-whom. The result is ready for `simulateCombinational` /
 * `simulateClocked`.
 *
 * The user's bitstream and the device reference data are kept cleanly separate, so loading someone else's `.bin`
 * cannot get "confused" with our own fixtures: `cram` + `deviceName` come from THEIR file (parseBinFile detects the
 * device from the CRAM dimensions), while `device` (a parsed chipdb) and `layout` (its logic-tile bit layout) are
 * the reference data for THAT device — the caller supplies the chipdb matching the detected device. Nothing about
 * the recovery is specific to any one design.
 *
 * Honest scope: this recovers what a real bitstream's cells compute AND how they are wired, for a device whose
 * chipdb you have. It inherits the recover/reconstruct limits — only routing the chipdb's switch table describes is
 * recovered (global networks, IO, BRAM/DSP data paths are not traced), and unrecovered inputs are reported as
 * primaries, never guessed.
 */
export function recoverNetlist(
  deviceName: string,
  device: IceboxDevice,
  layout: LogicTileBits,
  cram: BinBanks,
): RecoveredNetlist {
  const bits = cramToProgrammedBits(deviceName, cram)
  const cells = decodeUsedCells(
    bits.filter((bit) => tileType(deviceName, bit.x, bit.y) === 'logic'),
    layout,
  )
  const onPips = pipsOnInBitstream(bits, device.pips)
  return reconstructNetlist({ cells, onPips }, device)
}

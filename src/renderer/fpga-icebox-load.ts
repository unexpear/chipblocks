/**
 * FPGA fabric — Stage 3a (real iCE40): the "load your own bitstream" front door. This is the single, safe entry a
 * UI calls with the bytes of a `.bin` file a user picked. It DETECTS what the file is and either hands back a
 * fully simulatable netlist (ready for `simulateCombinational` / `simulateClocked`) or refuses with a plain-English
 * reason — so a foreign-vendor, encrypted, corrupt, or wrong-device file fails LOUDLY and honestly instead of
 * being silently mis-parsed into garbage.
 *
 * It supports the open iCE40 family (Project IceStorm), which is the flow the rest of this arc reverse-engineered
 * and built. Other vendors' bitstreams (Xilinx `.bit`, Intel `.sof`/`.pof`, …) do not carry the iCE40 preamble and
 * are rejected up front; encrypted/proprietary formats cannot be read at all (by design — see FPGA-FABRIC-RESEARCH).
 * Extending to another OPEN family (ECP5/Trellis, Gowin/Apicula, Xilinx-7/prjxray) means adding that family's own
 * container parser + chip-database + tile geometry — a separate, per-family effort, not a config switch.
 *
 * The user's file and our reference data stay cleanly separate: the DEVICE is detected from the file itself
 * (`parseBinFile`, from the CRAM dimensions); the caller supplies the chip databases it has (`chipdbs`, keyed by
 * device name). If the file's device isn't among them, that is reported — never guessed.
 */

import type { IceboxDevice } from './fpga-icebox.ts'
import { type BinBanks, parseBinFile } from './fpga-icebox-bin.ts'
import type { LogicTileBits } from './fpga-icebox-logic.ts'
import { recoverNetlist } from './fpga-icebox-recover.ts'
import type { RecoveredNetlist } from './fpga-icebox-run.ts'

/** The reference data for one iCE40 device: its parsed chip database and logic-tile bit layout. */
export type Ice40ChipDb = { device: IceboxDevice; layout: LogicTileBits }

/** The result of loading a user's bitstream: a simulatable netlist, or an honest reason it could not be read. */
export type LoadResult =
  | {
      ok: true
      family: 'ice40'
      /** the detected device, e.g. '384' / '1k' / '8k' / '5k' / 'u4k' / 'lm4k'. */
      device: string
      /** the reconstructed, simulatable netlist (feed to `simulateCombinational` / `simulateClocked`). */
      netlist: RecoveredNetlist
      /** the recovered CRAM banks, in case the caller wants to inspect raw bits. */
      cram: BinBanks
      /** whether the file's own CRC check passed (a corrupt-but-parseable file loads with this false). */
      crcOk: boolean
    }
  | { ok: false; reason: string }

/**
 * Load a user-supplied `.bin` as an iCE40 bitstream, given the chip databases we have. Returns a simulatable
 * netlist on success, or `{ ok: false, reason }` for anything we cannot faithfully read — a non-iCE40 / encrypted
 * / corrupt file, an unrecognised device, or a device whose chip database was not supplied.
 */
export function loadIce40Bitstream(
  bytes: Uint8Array,
  chipdbs: Record<string, Ice40ChipDb>,
): LoadResult {
  let parsed: ReturnType<typeof parseBinFile>
  try {
    parsed = parseBinFile(bytes)
  } catch (err) {
    // No 7E AA 99 7E preamble, truncated, or an unknown command ⇒ not an iCE40 bitstream (another vendor's format,
    // an encrypted image, or not a bitstream at all). icepack/nextpnr .bin files always carry the preamble.
    const detail = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      reason: `Not a readable iCE40 bitstream (${detail}). Other vendors' formats (Xilinx .bit, Intel .sof/.pof) and encrypted bitstreams cannot be read.`,
    }
  }

  const device = parsed.device
  if (device === null)
    return {
      ok: false,
      reason: `Parsed an iCE40-style bitstream, but its ${parsed.cramWidth}×${parsed.cramHeight} CRAM matches no known iCE40 device.`,
    }

  const chipdb = chipdbs[device]
  if (chipdb === undefined) {
    const have = Object.keys(chipdbs).sort().join(', ') || 'none'
    return {
      ok: false,
      reason: `Recognised a ${device} bitstream, but no chip database for ${device} is loaded (have: ${have}). Load the ${device} chip database to inspect it.`,
    }
  }

  const netlist = recoverNetlist(device, chipdb.device, chipdb.layout, parsed.cram)
  return { ok: true, family: 'ice40', device, netlist, cram: parsed.cram, crcOk: parsed.crcOk }
}

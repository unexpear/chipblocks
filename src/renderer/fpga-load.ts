/**
 * FPGA fabric — the one front door for "load a bitstream". A user picks a file; this decides what it IS and hands
 * back a simulatable netlist, or refuses with a plain-English reason. It supports both families the project has
 * reverse-engineered — Lattice iCE40 (Project IceStorm) and Lattice ECP5 (Project Trellis) — and tells them apart
 * by their sync pattern, so nothing has to be declared up front:
 *
 *   iCE40 `.bin` : `7E AA 99 7E`   → CRAM banks   → fpga-icebox-load.ts
 *   ECP5  `.bit` : `FF FF BD B3`   → frames       → fpga-trellis-netlist.ts
 *
 * Anything else — another vendor's format (Xilinx `.bit`, Intel `.sof`/`.pof`), an encrypted image, or a file that
 * is not a bitstream at all — carries neither pattern and is refused. That refusal is the honest answer: a
 * proprietary or encrypted bitstream cannot be read at all, by us or anyone without the vendor's keys.
 *
 * Whichever family it is, the result is the SAME `RecoveredNetlist` the rest of the app already runs, so a loaded
 * design goes straight into `simulateCombinational` / `simulateClocked` / `lowerNetlistToCanvas`.
 *
 * The user's file and our reference data stay separate: the device is detected FROM the file, and the caller
 * supplies whatever chip databases it has. A file for a device we hold no database for is reported as exactly
 * that — never guessed at.
 */

import { type Ice40ChipDb, loadIce40Bitstream } from './fpga-icebox-load.ts'
import type { RecoveredNetlist } from './fpga-icebox-run.ts'
import { parseEcp5Bitstream } from './fpga-trellis-bit.ts'
import { reconstructEcp5Netlist } from './fpga-trellis-netlist.ts'
import type { Ecp5Tile, Ecp5TileDb } from './fpga-trellis-tiles.ts'

/** The reference data an ECP5 device needs: its tile grid, and a bit database per tile type. */
export type Ecp5ChipDb = {
  grid: Map<string, Ecp5Tile>
  /** return null for a tile type whose database is not loaded — those tiles are skipped, never guessed at. */
  tileDb: (tileType: string) => Ecp5TileDb | null
}

/** The chip databases the app has available, per family and device. */
export type BitstreamReferences = {
  ice40?: Record<string, Ice40ChipDb>
  /** keyed by ECP5 device name, e.g. `LFE5U-25F`. */
  ecp5?: Record<string, Ecp5ChipDb>
}

/** What loading a user's bitstream produced. */
export type BitstreamLoad =
  | {
      ok: true
      family: 'ice40' | 'ecp5'
      /** the device the FILE declares, e.g. `384` or `LFE5U-25F`. */
      device: string
      /** ready for `simulateCombinational` / `simulateClocked` / `lowerNetlistToCanvas`. */
      netlist: RecoveredNetlist
      /** whether the file's own checksum verified. */
      crcOk: boolean
    }
  | { ok: false; reason: string }

const startsWith = (bytes: Uint8Array, at: number, pattern: readonly number[]): boolean =>
  pattern.every((b, i) => bytes[at + i] === b)

/** Which family a bitstream belongs to, by its sync pattern, or null if it carries neither. */
export function detectBitstreamFamily(bytes: Uint8Array): 'ice40' | 'ecp5' | null {
  const ICE40 = [0x7e, 0xaa, 0x99, 0x7e]
  const ECP5 = [0xff, 0xff, 0xbd, 0xb3]
  for (let i = 0; i + 4 <= bytes.length; i++) {
    if (startsWith(bytes, i, ICE40)) return 'ice40'
    if (startsWith(bytes, i, ECP5)) return 'ecp5'
  }
  return null
}

/**
 * Load a user-supplied bitstream of either supported family. Returns a simulatable netlist, or an honest reason
 * it could not be read.
 */
export function loadBitstream(
  bytes: Uint8Array,
  references: BitstreamReferences = {},
): BitstreamLoad {
  const family = detectBitstreamFamily(bytes)
  if (family === null)
    return {
      ok: false,
      reason:
        'Not a bitstream we can read: it carries neither the iCE40 sync pattern (7E AA 99 7E) nor the ECP5 one (FF FF BD B3). Other vendors’ formats (Xilinx .bit, Intel .sof/.pof) and encrypted bitstreams cannot be read.',
    }

  if (family === 'ice40') {
    const result = loadIce40Bitstream(bytes, references.ice40 ?? {})
    return result.ok
      ? {
          ok: true,
          family: 'ice40',
          device: result.device,
          netlist: result.netlist,
          crcOk: result.crcOk,
        }
      : result
  }

  let parsed: ReturnType<typeof parseEcp5Bitstream>
  try {
    parsed = parseEcp5Bitstream(bytes)
  } catch (err) {
    return { ok: false, reason: `Could not read this ECP5 bitstream: ${(err as Error).message}` }
  }
  const device = parsed.device
  if (device === null)
    return {
      ok: false,
      reason: `Recognised an ECP5 bitstream, but its IDCODE ${parsed.idcode === null ? '(absent)' : `0x${parsed.idcode.toString(16)}`} matches no known ECP5 part.`,
    }
  const chipdb = references.ecp5?.[device.name]
  if (chipdb === undefined) {
    const have =
      Object.keys(references.ecp5 ?? {})
        .sort()
        .join(', ') || 'none'
    return {
      ok: false,
      reason: `Recognised a ${device.name} bitstream, but no chip database for ${device.name} is loaded (have: ${have}). Load the ${device.name} database to inspect it.`,
    }
  }
  return {
    ok: true,
    family: 'ecp5',
    device: device.name,
    netlist: reconstructEcp5Netlist(parsed.frames, chipdb.grid, chipdb.tileDb),
    crcOk: parsed.crcOk,
  }
}

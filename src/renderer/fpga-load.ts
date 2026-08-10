/**
 * FPGA fabric — the one front door for "load a bitstream". A user picks a file; this decides what it IS and hands
 * back a simulatable netlist, or refuses with a plain-English reason. It supports the three families the project
 * has reverse-engineered — Lattice iCE40 (Project IceStorm), Lattice ECP5 (Project Trellis) and Gowin (Project
 * Apicula) — and tells them apart from the file itself, so nothing has to be declared up front:
 *
 *   iCE40 `.bin` : `7E AA 99 7E`   → CRAM banks   → fpga-icebox-load.ts
 *   ECP5  `.bit` : `FF FF BD B3`   → frames       → fpga-trellis-netlist.ts
 *   Gowin `.fs`  : TEXT, no marker → frames       → fpga-apicula-netlist.ts
 *
 * The Gowin one is the odd one out and is why this is not simply a two-way marker test. A `.fs` is a text file of
 * ones and zeros with no sync pattern anywhere in it, so scanning for markers can never find it — which is
 * exactly why this door refused every Gowin file for as long as the scan was the whole test. It is recognised by
 * its own header STRUCTURE instead (`readGowinFsHeader`).
 *
 * Anything else — another vendor's format (Xilinx `.bit`, Intel `.sof`/`.pof`), an encrypted image, or a file that
 * is not a bitstream at all — matches none of the three and is refused. That refusal is the honest answer: a
 * proprietary or encrypted bitstream cannot be read at all, by us or anyone without the vendor's keys.
 *
 * Whichever family it is, the result is the SAME `RecoveredNetlist` the rest of the app already runs, so a loaded
 * design goes straight into `simulateCombinational` / `simulateClocked` / `lowerNetlistToCanvas`.
 *
 * The user's file and our reference data stay separate: the device is detected FROM the file, and the caller
 * supplies whatever chip databases it has. A file for a device we hold no database for is reported as exactly
 * that — never guessed at.
 */

import type { GowinAttributeDatabase } from './fpga-apicula-attributes.ts'
import type { GowinChipdb } from './fpga-apicula-chipdb.ts'
import { parseGowinBitstream, readGowinFsHeader } from './fpga-apicula-fs.ts'
import { reconstructGowinNetlist } from './fpga-apicula-netlist.ts'
import type { GowinPipDatabase } from './fpga-apicula-routing.ts'
import { type Ice40ChipDb, loadIce40Bitstream } from './fpga-icebox-load.ts'
import type { CellRef, RecoveredNetlist } from './fpga-icebox-run.ts'
import { parseEcp5Bitstream } from './fpga-trellis-bit.ts'
import { reconstructEcp5Netlist } from './fpga-trellis-netlist.ts'
import type { Ecp5Tile, Ecp5TileDb } from './fpga-trellis-tiles.ts'

/** The families this door reads. */
export type FpgaFamily = 'ice40' | 'ecp5' | 'gowin'

/** The reference data an ECP5 device needs: its tile grid, and a bit database per tile type. */
export type Ecp5ChipDb = {
  grid: Map<string, Ecp5Tile>
  /** return null for a tile type whose database is not loaded — those tiles are skipped, never guessed at. */
  tileDb: (tileType: string) => Ecp5TileDb | null
}

/**
 * The reference data a Gowin device needs. It is four separate things rather than one, because Apicula keeps
 * them apart: what the fabric IS, which routing switches each kind of tile has, what its configuration
 * attributes mean, and which differently-named wires are the same piece of copper.
 */
export type GowinChipDb = {
  fabric: GowinChipdb
  pips: GowinPipDatabase
  attributes: GowinAttributeDatabase
  /**
   * Wire equivalences. Supplied whole, with the geometric ones already merged in by the caller — the decoder
   * treats a missing table as "no equivalences at all", which changes its verdict on real registers, so there
   * is deliberately no way to ask for the design without it.
   */
  aliases: ReadonlyMap<string, string>
}

/** The chip databases the app has available, per family and device. */
export type BitstreamReferences = {
  ice40?: Record<string, Ice40ChipDb>
  /** keyed by ECP5 device name, e.g. `LFE5U-25F`. */
  ecp5?: Record<string, Ecp5ChipDb>
  /** keyed by Gowin device name, e.g. `GW1N-1`. */
  gowin?: Record<string, GowinChipDb>
}

/** What loading a user's bitstream produced. */
export type BitstreamLoad =
  | {
      ok: true
      family: FpgaFamily
      /** the device the FILE declares, e.g. `384` or `LFE5U-25F`. */
      device: string
      /** ready for `simulateCombinational` / `simulateClocked` / `lowerNetlistToCanvas`. */
      netlist: RecoveredNetlist
      /**
       * Cells the decoder recovered but whose FUNCTION is not to be trusted, with the reason — an arithmetic or
       * distributed-RAM slice, or a cell whose output wire carries the SLICE's wide-function multiplexer.
       *
       * This has to be here, not only on the family-specific netlist: `RecoveredNetlist` carries nothing but
       * `cells`, so a caller coming through this door used to be handed a bitstream's untrustworthy cells with
       * no way to learn they were untrustworthy. Empty for a design with nothing to declare, and absent for the
       * iCE40 path, which has no such list.
       */
      unfaithful?: { ref: CellRef; reason: string }[]
      /** whether the file's own checksum verified. */
      crcOk: boolean
    }
  | { ok: false; reason: string }

const startsWith = (bytes: Uint8Array, at: number, pattern: readonly number[]): boolean =>
  pattern.every((b, i) => bytes[at + i] === b)

/** The bytes as the text a Gowin `.fs` is, or null when they are not a Gowin chip file. */
export function gowinFsText(bytes: Uint8Array): string | null {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  return readGowinFsHeader(text) === null ? null : text
}

/**
 * Which family a bitstream belongs to, or null if it belongs to none of them.
 *
 * The two Lattice families are found by their sync pattern; Gowin has none to find, so it is recognised last and
 * from its own header structure. Order is what keeps that safe — a binary file that happens to decode into
 * something text-shaped is claimed by its marker first.
 */
export function detectBitstreamFamily(bytes: Uint8Array): FpgaFamily | null {
  const ICE40 = [0x7e, 0xaa, 0x99, 0x7e]
  const ECP5 = [0xff, 0xff, 0xbd, 0xb3]
  for (let i = 0; i + 4 <= bytes.length; i++) {
    if (startsWith(bytes, i, ICE40)) return 'ice40'
    if (startsWith(bytes, i, ECP5)) return 'ecp5'
  }
  return gowinFsText(bytes) === null ? null : 'gowin'
}

/**
 * Load a user-supplied bitstream of any supported family. Returns a simulatable netlist, or an honest reason
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
        'Not a bitstream we can read: it carries neither the iCE40 sync pattern (7E AA 99 7E) nor the ECP5 one (FF FF BD B3), and it is not a Gowin .fs either. Other vendors’ formats (Xilinx .bit, Intel .sof/.pof) and encrypted bitstreams cannot be read.',
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

  if (family === 'gowin') return loadGowinBitstream(bytes, references.gowin ?? {})

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
  const netlist = reconstructEcp5Netlist(parsed.frames, chipdb.grid, chipdb.tileDb)
  return {
    ok: true,
    family: 'ecp5',
    device: device.name,
    netlist,
    unfaithful: netlist.unfaithful,
    crcOk: parsed.crcOk,
  }
}

/**
 * The Gowin half, kept whole rather than threaded through the Lattice branches above.
 *
 * Its shape is the same as theirs — identify the part from the file, refuse if no database for that part is
 * held, otherwise reconstruct — but every step is different underneath: the file is text, the parse can throw on
 * a compressed stream, and the reference data is four tables instead of one.
 */
function loadGowinBitstream(
  bytes: Uint8Array,
  databases: Record<string, GowinChipDb>,
): BitstreamLoad {
  const text = gowinFsText(bytes)
  if (text === null) return { ok: false, reason: 'Not a Gowin .fs bitstream.' }
  let parsed: ReturnType<typeof parseGowinBitstream>
  try {
    parsed = parseGowinBitstream(text)
  } catch (err) {
    return { ok: false, reason: `Could not read this Gowin bitstream: ${(err as Error).message}` }
  }
  const device = parsed.device
  if (device === null)
    return {
      ok: false,
      reason: `Recognised a Gowin bitstream, but its IDCODE ${parsed.idcode === null ? '(absent)' : `0x${parsed.idcode.toString(16)}`} matches no known Gowin part.`,
    }
  const chipdb = databases[device.name]
  if (chipdb === undefined) {
    const have = Object.keys(databases).sort().join(', ') || 'none'
    return {
      ok: false,
      reason: `Recognised a ${device.name} bitstream, but no chip database for ${device.name} is loaded (have: ${have}). Load the ${device.name} database to inspect it.`,
    }
  }
  const design = reconstructGowinNetlist(
    parsed.frames,
    chipdb.fabric,
    chipdb.pips,
    chipdb.attributes,
    chipdb.aliases,
  )
  return {
    ok: true,
    family: 'gowin',
    device: device.name,
    netlist: design.netlist,
    unfaithful: design.distrusted,
    crcOk: parsed.crcOk,
  }
}

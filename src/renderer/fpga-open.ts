/**
 * FPGA fabric — the door a PERSON walks through. `fpga-load.ts` is the programmatic front door: hand it bytes and
 * the chip databases you happen to hold, get a netlist. Nothing in the app called it, so the whole decoder was
 * reachable by no button. This module is what the menu item talks to.
 *
 * It does the three things a UI needs and the programmatic door deliberately does not:
 *
 *  1. IDENTIFY FIRST, DECODE SECOND. A bitstream names its own chip — the iCE40 CRAM dimensions, the ECP5 and
 *     Gowin identifying numbers — and that needs no chip database at all. So the app can tell the user WHICH chip
 *     description to go and find instead of failing with "no database loaded" and leaving them to guess.
 *
 *  2. TURN THE FILES A USER CAN ACTUALLY PICK INTO CHIP DATABASES. The databases are the open-source projects'
 *     own files (IceStorm's `chipdb-<device>.txt`, Trellis's `tilegrid.json` + per-tile-type `.db`, and the four
 *     converted Apicula tables for a Gowin part), which are megabytes and are not shipped. The user points at the
 *     ones they have; this sorts them out by what they CONTAIN, checks the chip description is for the same chip
 *     as the bitstream, and says plainly which picked files were not used — and, where a description is made of
 *     several files, which of them is still missing.
 *
 *  3. SAY WHAT COULD NOT BE READ, IN WORDS. The decoders' caveats are accurate but written for someone who knows
 *     what a CCU2 is. `plainEnglish` restates the ones that can reach this door and passes anything else through
 *     verbatim — an unrecognised caveat is shown in the decoder's own words, never dropped and never invented.
 *
 * The result is an ordinary `CircuitFile`, so a recovered FPGA design lands on the canvas by exactly the path a
 * SPICE or Verilog import takes, and every tool that works on a canvas works on it.
 */

import { BUILTIN_BLOCKS } from './builtin-blocks.ts'
import type { CircuitFile, SavedNode, SavedWire } from './circuit-file.ts'
import { CIRCUIT_FILE_FORMAT, CIRCUIT_FILE_VERSION } from './circuit-file.ts'
import {
  type GowinAttributeDatabase,
  parseGowinAttributeDatabase,
} from './fpga-apicula-attributes.ts'
import { type GowinChipdb, parseGowinChipdb } from './fpga-apicula-chipdb.ts'
import { readGowinFsHeader } from './fpga-apicula-fs.ts'
import { gowinFixedAliases, gowinPartPlace, parseGowinWireAliases } from './fpga-apicula-netlist.ts'
import { type GowinPipDatabase, parseGowinPipDatabase } from './fpga-apicula-routing.ts'
import { type IceboxDevice, parseIceboxChipdb } from './fpga-icebox.ts'
import {
  ascHasBlockMemoryContents,
  isIceboxAscText,
  type ParsedAsc,
  parseIceboxAsc,
} from './fpga-icebox-asc.ts'
import { parseBinFile } from './fpga-icebox-bin.ts'
import { type LoweredCanvas, lowerNetlistToCanvas } from './fpga-icebox-canvas.ts'
import { cramToProgrammedBits, tileType } from './fpga-icebox-cram-index.ts'
import { type Ice40ChipDb, loadIce40AscDesign } from './fpga-icebox-load.ts'
import { parseLogicTileBits } from './fpga-icebox-logic.ts'
import type { CellCaveat, CellRef, RecoveredNetlist } from './fpga-icebox-run.ts'
import { buildWireIndex } from './fpga-icebox-synth.ts'
import {
  type BitstreamReferences,
  type Ecp5ChipDb,
  type FpgaFamily,
  type GowinChipDb,
  loadBitstream,
} from './fpga-load.ts'
import { ECP5_DEVICES, NEXUS_DEVICES, readLatticeIdcode } from './fpga-trellis-bit.ts'
import { type Ecp5Tile, parseEcp5TileBits, parseEcp5TileGrid } from './fpga-trellis-tiles.ts'
import { isLogicGate } from './logic-sim.ts'
import { listPhrase, plural } from './plain-words.ts'

/** One file the user picked as chip-description reference data, read as text by the main process. */
export type ChipDescriptionFile = { name: string; text: string }

/**
 * Which chip a file is for, read out of the file itself — no chip database needed.
 *
 * `form` says which KIND of file arrived, because a family can have more than one and they are not
 * interchangeable. An iCE40 design comes in two files holding the same thing: the binary `.bin` that is
 * programmed into the chip, and the text `.asc` the place-and-route tool writes on the way there. They are read
 * by different readers and only one of them carries a checksum, so what can honestly be said about the file
 * depends on which one arrived. A Gowin `.fs` is text too — but, unlike an `.asc`, it does carry a checksum on
 * every frame, so "text" does not by itself mean "unchecked".
 */
export type BitstreamIdentity =
  | { ok: true; family: 'ice40'; device: string; form: 'binary' | 'text' }
  | { ok: true; family: 'ecp5'; device: string; form: 'binary' }
  | { ok: true; family: 'gowin'; device: string; form: 'text' }
  | { ok: false; reason: string }

/** The families this door can read, in the words the user sees. */
export const SUPPORTED_FPGA_FAMILIES =
  'Lattice iCE40 (a .bin or .asc file), Lattice ECP5 (a .bit file) and Gowin (a .fs file)'

/** The plain name of a chip, for every message about it. */
export function chipName(family: FpgaFamily, device: string): string {
  if (family === 'ice40') return `Lattice iCE40 ${device}`
  if (family === 'gowin') return `Gowin ${device}`
  return `Lattice ${device}`
}

/** A chip's own identifying number as a person would read it back off a screen — no `0x`, no lower case. */
const chipCode = (idcode: number): string => idcode.toString(16).toUpperCase().padStart(8, '0')

/**
 * The bytes as text, if they are an IceStorm TEXT chip file (`.asc`).
 *
 * Binary files are ruled out first by their own markers, so this only ever runs on something that is not one,
 * and `isIceboxAscText` then demands both a chip name and at least one tile before calling it a chip file —
 * which is what keeps a chip DESCRIPTION file (which also names a chip) from being mistaken for one.
 */
function iceboxAscText(bytes: Uint8Array): string | null {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  return isIceboxAscText(text) ? text : null
}

/**
 * Read which chip a file is for, without any reference data.
 *
 * This is the step that makes the whole flow askable: the app can name the chip, and therefore name the
 * description file to go and find, before it holds any database at all.
 */
export function identifyBitstream(bytes: Uint8Array): BitstreamIdentity {
  const unreadable = {
    ok: false as const,
    reason: `This file is not an FPGA chip file ChipBlocks can read. It can read ${SUPPORTED_FPGA_FAMILIES}. Other makers' files (Xilinx .bit, Intel .sof and .pof) and scrambled files cannot be read here.`,
  }
  // The two BINARY families are told apart by the marker each one puts at the start of its data. Trying each
  // parser and keeping whichever succeeds would be the same test done twice, less clearly.
  const ICE40 = [0x7e, 0xaa, 0x99, 0x7e]
  const LATTICE_FFFFBDB3 = [0xff, 0xff, 0xbd, 0xb3]
  const at = (i: number, pattern: readonly number[]): boolean =>
    pattern.every((b, k) => bytes[i + k] === b)
  let marker: 'ice40' | 'ffffbdb3' | null = null
  for (let i = 0; i + 4 <= bytes.length && marker === null; i++) {
    if (at(i, ICE40)) marker = 'ice40'
    else if (at(i, LATTICE_FFFFBDB3)) marker = 'ffffbdb3'
  }

  if (marker === null) {
    // Not a binary chip file of either Lattice family. Two of the formats this door reads are TEXT and carry no
    // marker at all, so each is now asked in turn whether the file is one of its own. The iCE40 text form goes
    // first because it says outright which chip it is for; a Gowin file has to be recognised by its structure,
    // which is the looser test of the two.
    const asc = iceboxAscText(bytes)
    if (asc !== null) {
      try {
        const device = parseIceboxAsc(asc).device
        if (device === null) return unreadable
        return { ok: true, family: 'ice40', device, form: 'text' }
      } catch (error) {
        return {
          ok: false,
          reason: `This looks like a Lattice iCE40 chip file written as text, but it could not be read: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    }
    const gowin = readGowinFsHeader(new TextDecoder('utf-8', { fatal: false }).decode(bytes))
    if (gowin === null) return unreadable
    if (gowin.device === null)
      return {
        ok: false,
        reason: `This is a Gowin chip file, but the chip's own identifying number in it (${chipCode(gowin.idcode)}) matches none of the Gowin chips ChipBlocks knows, so there is no way to tell which chip it is for.`,
      }
    return { ok: true, family: 'gowin', device: gowin.device.name, form: 'text' }
  }

  if (marker === 'ice40') {
    let parsed: ReturnType<typeof parseBinFile>
    try {
      parsed = parseBinFile(bytes)
    } catch (error) {
      return {
        ok: false,
        reason: `This looks like a Lattice iCE40 chip file, but it could not be read: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
    if (parsed.device === null)
      return {
        ok: false,
        reason: `This is a Lattice iCE40 chip file, but the size of the settings it carries (${parsed.cramWidth} by ${parsed.cramHeight}) matches none of the iCE40 chips ChipBlocks knows, so there is no way to tell which chip it is for.`,
      }
    return { ok: true, family: 'ice40', device: parsed.device, form: 'binary' }
  }

  // Lattice's ECP5 and its NEXUS chips open their files with the very same marker, so the marker alone names no
  // family. The chip's own identifying number is what separates them — and it is read on its own here, BEFORE
  // the ECP5 decoder runs, because handing a Nexus file to that decoder makes it fail somewhere in the middle
  // and report the wrong family's name back to the user.
  const idcode = readLatticeIdcode(bytes)
  const ecp5 = ECP5_DEVICES.find((device) => device.idcode === idcode)
  if (ecp5 !== undefined) return { ok: true, family: 'ecp5', device: ecp5.name, form: 'binary' }

  const nexus = NEXUS_DEVICES.find((device) => device.idcode === idcode)
  if (nexus !== undefined)
    return {
      ok: false,
      reason: `This is a chip file for a Lattice Nexus chip, a ${nexus.name}. ChipBlocks cannot read Nexus chip files — it can read ${SUPPORTED_FPGA_FAMILIES}. (Nexus files begin with the same marker as ECP5 ones, which is why the two have to be told apart by the chip's own identifying number.)`,
    }
  return {
    ok: false,
    reason: `This file begins with the marker that Lattice's ECP5 chips and Lattice's Nexus chips both use, so it is a chip file for one of those two families — but ${idcode === null ? 'it does not say which chip it is for' : `the chip's own identifying number in it (${chipCode(idcode)}) matches none of the chips ChipBlocks knows`}, so there is no way to tell which. ChipBlocks can read ECP5 chip files; it cannot read Nexus ones at all.`,
  }
}

/** What to go and find, in plain English, once the chip is known. */
export function chipDescriptionRequest(family: FpgaFamily, device: string): string {
  if (family === 'ice40')
    return `To turn this back into a circuit, ChipBlocks needs the description of what is inside a ${chipName(family, device)} chip. That is one file, "chipdb-${device}.txt", which comes with the open-source Project IceStorm (it is usually in a "share/icestorm/chipdb" folder). Choose it and ChipBlocks will remember it for next time.`
  if (family === 'gowin')
    return `To turn this back into a circuit, ChipBlocks needs the description of what is inside a ${chipName(family, device)} chip. That is four files, and they are ones ChipBlocks prepared itself: the open-source Project Apicula holds this description, but it ships it packed up in a form ChipBlocks cannot open directly, so it was unpacked once and written out as four plain files. They come with the ChipBlocks source, in its "fixtures" folder, and their names end "-chipdb.json" (${GOWIN_DESCRIPTION_PIECES.fabric}), "-pips.json" (${GOWIN_DESCRIPTION_PIECES.pips}), "-attributes.json" (${GOWIN_DESCRIPTION_PIECES.attributes}) and "-nodes.json" (${GOWIN_DESCRIPTION_PIECES.aliases}). Choose all four at once and ChipBlocks will remember them for next time.`
  return `To turn this back into a circuit, ChipBlocks needs the description of what is inside a ${chipName(family, device)} chip. Those are the files of the open-source Project Trellis: "tilegrid.json" for this chip, and the ".db" files naming the kinds of tile it uses. Choose them all at once and ChipBlocks will remember them for next time.`
}

/** Chip databases assembled from the user's picked files, and what happened to each file. */
export type BuiltReferences = {
  references: BitstreamReferences
  /** files that became part of the chip description, in the order given. */
  used: string[]
  /** files that were not used, each with the plain-English reason — never silently ignored. */
  unused: { name: string; reason: string }[]
  /**
   * The kinds of ECP5 tile a description was supplied for. Empty for iCE40, whose one file covers the chip.
   *
   * This is stated to the user because it BOUNDS what was read: the decoder skips a tile it has no description
   * of, so wiring that runs through one is missing from the recovered design. Naming the kinds that WERE
   * described is the useful half — the LFE5U-25F tile map lists 134 kinds (measured), nearly all of them pads
   * and clocking that no logic design touches, so listing what was NOT described cries wolf 131 times over.
   */
  describedTileKinds: string[]
  /**
   * The pieces of the chip description that are still missing, in plain words. Empty when it is complete.
   *
   * Only the Gowin path fills this, and it fills it because a Gowin description is FOUR files rather than one:
   * "no description" is the wrong thing to tell someone who chose three of them, and telling them which one is
   * absent is the difference between a dead end and a next step.
   */
  missingPieces: string[]
}

/** The four things a Gowin chip description is made of, each said as what it holds rather than what it is called. */
const GOWIN_DESCRIPTION_PIECES = {
  fabric: 'what the chip is made of',
  pips: 'the switches the chip’s wiring is made of',
  attributes: 'what the chip’s own settings mean',
  aliases: 'which differently-named wires are the same piece of copper',
} as const

type GowinDescriptionPiece = keyof typeof GOWIN_DESCRIPTION_PIECES

/**
 * Which of the four a picked file is, decided by what it CONTAINS.
 *
 * All four are JSON and none of them says what it is, so each is recognised by a shape no other one has: the
 * fabric names a chip and holds a grid, the attribute tables are the only one with both a table set and a
 * meaning set, every entry of the switch database holds switches, and every entry of the wire table is a list.
 * A file matching none of them is reported, never loaded on the chance that it fits.
 */
function gowinDescriptionPieceOf(text: string): GowinDescriptionPiece | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if ('device' in record && 'grid' in record) return 'fabric'
  if ('tables' in record && 'logicinfo' in record) return 'attributes'
  const values = Object.values(record)
  if (values.length === 0) return null
  const isEntry = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
  if (values.every((value) => isEntry(value) && 'pips' in value)) return 'pips'
  if (values.every((value) => Array.isArray(value))) return 'aliases'
  return null
}

const iceboxDeviceName = (text: string): string | null => {
  for (const raw of text.split(String.fromCharCode(10))) {
    const line = raw.trim()
    if (!line.startsWith('.device ')) continue
    return line.split(/\s+/)[1] ?? null
  }
  return null
}

/**
 * Sort the user's picked files into the chip databases the decoders need.
 *
 * Sorted by CONTENT, not by what the file is called: the same data ships under different names in a Project
 * IceStorm checkout, a packaged oss-cad-suite, and this repository's own fixtures. The one place a name is
 * consulted is which TILE KIND an ECP5 `.db` file describes, and even that is matched against the tile kinds the
 * chip's own tile map lists, so a file naming a kind this chip does not have is reported rather than loaded.
 */
export function buildReferences(
  family: FpgaFamily,
  device: string,
  files: readonly ChipDescriptionFile[],
): BuiltReferences {
  const used: string[] = []
  const unused: { name: string; reason: string }[] = []

  if (family === 'gowin') return buildGowinReferences(device, files, used, unused)

  if (family === 'ice40') {
    const ice40: Record<string, Ice40ChipDb> = {}
    for (const file of files) {
      const named = iceboxDeviceName(file.text)
      if (named === null) {
        unused.push({
          name: file.name,
          reason: 'this is not an iCE40 chip description — it does not say which chip it describes',
        })
        continue
      }
      if (named !== device) {
        unused.push({
          name: file.name,
          reason: `this describes a ${chipName('ice40', named)} chip, and the file you opened is for a ${chipName('ice40', device)}`,
        })
        continue
      }
      const layout = parseLogicTileBits(file.text)
      if (layout.cells.length === 0) {
        unused.push({
          name: file.name,
          reason:
            'this describes the right chip but is missing the part that says where a logic cell keeps its settings, so nothing could be read from it',
        })
        continue
      }
      ice40[device] = { device: parseIceboxChipdb(file.text), layout }
      used.push(file.name)
    }
    return { references: { ice40 }, used, unused, describedTileKinds: [], missingPieces: [] }
  }

  // ECP5: one tile map for the chip, then one description per kind of tile in it.
  let grid: Map<string, Ecp5Tile> | null = null
  let gridFile: ChipDescriptionFile | null = null
  const rest: ChipDescriptionFile[] = []
  for (const file of files) {
    if (grid === null && file.text.trimStart().startsWith('{')) {
      let parsed: Map<string, Ecp5Tile> | null = null
      try {
        parsed = parseEcp5TileGrid(file.text)
      } catch {
        parsed = null
      }
      if (parsed !== null && parsed.size > 0) {
        grid = parsed
        gridFile = file
        continue
      }
    }
    rest.push(file)
  }
  if (grid === null || gridFile === null) {
    for (const file of files)
      unused.push({
        name: file.name,
        reason:
          'the chip’s tile map (tilegrid.json) was not among the files chosen, so nothing could be used',
      })
    return { references: {}, used, unused, describedTileKinds: [], missingPieces: [] }
  }
  used.push(gridFile.name)

  const tileKinds = [...new Set([...grid.values()].map((tile) => tile.type))]
  const dbs = new Map<string, ReturnType<typeof parseEcp5TileBits>>()
  for (const file of rest) {
    // Longest match wins: CIB_EBR must not be taken for CIB.
    const kind = tileKinds
      .filter((k) => file.name.includes(k))
      .sort((a, b) => b.length - a.length)[0]
    if (kind === undefined) {
      unused.push({
        name: file.name,
        reason: `its name does not match any kind of tile a ${chipName('ecp5', device)} contains, so there is no way to tell which tiles it describes`,
      })
      continue
    }
    dbs.set(kind, parseEcp5TileBits(file.text))
    used.push(file.name)
  }
  const ecp5: Record<string, Ecp5ChipDb> = {
    [device]: { grid, tileDb: (tileType: string) => dbs.get(tileType) ?? null },
  }
  return {
    references: { ecp5 },
    used,
    unused,
    describedTileKinds: [...dbs.keys()].sort(),
    missingPieces: [],
  }
}

/**
 * The Gowin half of `buildReferences`: sort the picked files into the four pieces of a Gowin chip description.
 *
 * All four are needed and none of them is optional. The wire table looks the most skippable and is not — the
 * decoder without it treats every differently-named piece of one wire as a separate wire, and upstream's own
 * comments record a real register that came back combinational that way. Offering a reading that is quietly
 * worse would be the placeholder this project does not allow, so a missing piece is a refusal that NAMES it.
 */
function buildGowinReferences(
  device: string,
  files: readonly ChipDescriptionFile[],
  used: string[],
  unused: { name: string; reason: string }[],
): BuiltReferences {
  const chosen = new Map<GowinDescriptionPiece, ChipDescriptionFile>()
  for (const file of files) {
    const piece = gowinDescriptionPieceOf(file.text)
    if (piece === null) {
      unused.push({
        name: file.name,
        reason:
          'this is none of the four files that describe a Gowin chip — what is inside it matches none of them',
      })
      continue
    }
    const already = chosen.get(piece)
    if (already !== undefined) {
      unused.push({
        name: file.name,
        reason: `"${already.name}" already said ${GOWIN_DESCRIPTION_PIECES[piece]}, so this one was not needed`,
      })
      continue
    }
    chosen.set(piece, file)
  }

  const empty = (missingPieces: string[]): BuiltReferences => ({
    references: {},
    used: [],
    unused,
    describedTileKinds: [],
    missingPieces,
  })

  const missingPieces = (Object.keys(GOWIN_DESCRIPTION_PIECES) as GowinDescriptionPiece[])
    .filter((piece) => !chosen.has(piece))
    .map((piece) => GOWIN_DESCRIPTION_PIECES[piece])

  let parsed: {
    fabric: GowinChipdb
    pips: GowinPipDatabase
    attributes: GowinAttributeDatabase
    aliases: Map<string, string>
  } | null = null
  const fabricFile = chosen.get('fabric')
  const pipsFile = chosen.get('pips')
  const attributesFile = chosen.get('attributes')
  const aliasesFile = chosen.get('aliases')
  if (
    fabricFile !== undefined &&
    pipsFile !== undefined &&
    attributesFile !== undefined &&
    aliasesFile !== undefined
  ) {
    try {
      const fabric = parseGowinChipdb(fabricFile.text)
      if (fabric.device !== device) {
        unused.push({
          name: fabricFile.name,
          reason: `this describes a ${chipName('gowin', fabric.device)} chip, and the file you opened is for a ${chipName('gowin', device)}`,
        })
        return empty([GOWIN_DESCRIPTION_PIECES.fabric])
      }
      parsed = {
        fabric,
        pips: parseGowinPipDatabase(pipsFile.text),
        attributes: parseGowinAttributeDatabase(attributesFile.text),
        aliases: new Map([
          ...parseGowinWireAliases(aliasesFile.text),
          ...gowinFixedAliases(fabric.rows, fabric.cols),
        ]),
      }
    } catch (error) {
      // A file of the right SHAPE whose contents the parser rejects. Which one it was is the useful half, and
      // the shape test above has already told us that much.
      for (const [piece, file] of chosen)
        unused.push({
          name: file.name,
          reason: `one of the four files could not be read (${error instanceof Error ? error.message : String(error)}), so none of them could be used — this one was meant to say ${GOWIN_DESCRIPTION_PIECES[piece]}`,
        })
      return empty(Object.values(GOWIN_DESCRIPTION_PIECES))
    }
  }
  if (parsed === null) return empty(missingPieces)

  for (const file of files) if ([...chosen.values()].includes(file)) used.push(file.name)
  const gowin: Record<string, GowinChipDb> = { [device]: parsed }
  return { references: { gowin }, used, unused, describedTileKinds: [], missingPieces: [] }
}

/**
 * The decoders' caveats, restated for someone who does not know the hardware.
 *
 * Only the caveats that can reach this door are restated; anything else is returned WORD FOR WORD. That fallback
 * is the honest half: a caveat this function has never seen is still shown in full, so a decoder gaining a new
 * one can never make a part quietly lose its warning. Several caveats about one part arrive joined, so each is
 * restated on its own.
 */
export function plainEnglish(reason: string): string {
  return reason
    .split('; also: ')
    .map((part) => {
      if (part.startsWith('arithmetic (CCU2) slice'))
        return 'this part is doing arithmetic. Its real answer combines its own lookup table with a carry passed in from the part beside it, and neither the carry nor that combination could be read, so the answer shown here is not the one the chip works out'
      if (part.startsWith('distributed-RAM slice'))
        return 'this part is being used as a small memory that the design writes into while it runs. Only what the memory holds at switch-on could be read — not the writing side — so from the first write onward the value shown here is wrong'
      if (part.startsWith('tile wire F'))
        return 'what this part sends out of its tile is picked by a chooser that selects between two lookup tables. That chooser could not be read, so what leaves this part is not what the chip really sends'
      // The two Gowin ones. The rest of that decoder's caveats are already written for a person and are passed
      // through unchanged — these two are the ones that name the silicon rather than describe it.
      if (part.startsWith('arithmetic mode'))
        return 'this part is doing arithmetic. Its real answer combines its own settings with a carry passed in from the part beside it, and the shared kind of part ChipBlocks builds it from cannot do both at once, so it is not here'
      if (part.startsWith('level-sensitive latch'))
        return 'this part holds a value the way a gate holds water rather than the way a camera takes a picture: while its control is on it simply passes its input through, and it keeps whatever was there when the control went off. Every other part read from this chip stores its value on the tick of a clock instead, and showing this one that way would be a different piece of hardware, so it is not here'
      return part
    })
    .join(' It is also true that: ')
}

/** One part the reader could not fully stand behind, named and explained for the user. */
export type FpgaCaveatLine = { part: string; reason: string }

/** The honest account of what came back from a chip file. */
export type FpgaOpenReport = {
  family: FpgaFamily
  device: string
  /** which of the chip's two file forms this came from — the text one carries no checksum. */
  form: 'binary' | 'text'
  /** logic parts recovered from the chip and put on the canvas. */
  partCount: number
  /** canvas pieces those parts became (each lookup table becomes real gates). */
  pieceCount: number
  /** chip inputs that became power sources you can switch between 0 V and 5 V. */
  inputCount: number
  /** parts the reader could NOT describe at all — they are missing from the canvas entirely. */
  missing: FpgaCaveatLine[]
  /** parts that ARE on the canvas but whose value must not be trusted. */
  untrusted: FpgaCaveatLine[]
  /** parts on the canvas that are right for everything reading them, with something left out. */
  incomplete: FpgaCaveatLine[]
  /** everything else worth stating — a failed checksum, a chosen file that went unused. */
  notes: string[]
  /**
   * What this reading looked at, and what it did not look at at all — shown WHETHER OR NOT anything was found.
   *
   * The card used to end an empty report with "nothing in it is untrusted", which reads as a clean bill of
   * health for the whole chip and is not one: nothing had ever checked whether the reader raises the objections
   * it should, and a chip file whose block memory is not read at all can produce exactly that green line. This
   * field is the bound on the claim, and it is always present, so there is no wording anywhere that says more
   * than was actually checked.
   */
  scope: string
  /** cell key (`x_y_cell`) → the caveat that must travel onto the canvas parts that cell became. */
  markings: Map<string, string>
}

/**
 * Where a part sits on the chip, as a person would say it.
 *
 * One silicon cell can become SEVERAL recovered parts, and the extra ones are given positions above the ones
 * the chip has. On Gowin that is a stored half at 8..15 and a wide multiplexer at 16..23, so the plain
 * sentence below would send a user looking for "position 23" on a chip whose positions stop at 7. The family
 * has to be known here because the numbering is the family's own: an iCE40 tile has eight positions and no
 * extras, so the plain form is the whole truth there.
 */
const partLabel = (family: FpgaFamily, ref: CellRef): string =>
  family === 'gowin'
    ? gowinPartPlace(ref)
    : `the logic part at column ${ref.x}, row ${ref.y}, position ${ref.cell}`

const cellKeyOf = (ref: CellRef): string => `${ref.x}_${ref.y}_${ref.cell}`

const caveatLines = (family: FpgaFamily, caveats: readonly CellCaveat[]): FpgaCaveatLine[] =>
  caveats.map((caveat) => ({
    part: partLabel(family, caveat.ref),
    reason: plainEnglish(caveat.reason),
  }))

/** Extra findings a family's own audit produced, alongside the ones the decoder and the lowering carry. */
export type FpgaExtraFindings = {
  missing?: FpgaCaveatLine[]
  incomplete?: { ref: CellRef; reason: string }[]
  notes?: string[]
}

/**
 * The account of a lowered design: its size, and all three kinds of thing that could not be stood behind.
 *
 * Separate from `openFpgaDesign` because this is the step that has to carry every caveat across. Reachable on
 * its own, it can be handed a lowered design carrying all three kinds and checked, instead of the fields being
 * untested assignments.
 */
export function fpgaReportFor(
  lowered: LoweredCanvas,
  about: {
    family: FpgaFamily
    device: string
    form: 'binary' | 'text'
    partCount: number
    notes: string[]
    scope: string
    extra?: FpgaExtraFindings
  },
): FpgaOpenReport {
  const extraIncomplete = about.extra?.incomplete ?? []
  // A part is marked on the canvas with the strongest thing said about it: "do not trust this value" outranks
  // "something about it is not shown", and a part with several findings carries them all.
  const markings = new Map<string, string>()
  const mark = (ref: CellRef, text: string): void => {
    const key = cellKeyOf(ref)
    const existing = markings.get(key)
    markings.set(key, existing === undefined ? text : `${existing} ${text}`)
  }
  for (const caveat of lowered.unfaithful)
    mark(
      caveat.ref,
      `Do not trust this part's value: it was read from a chip file, and ${plainEnglish(caveat.reason)}.`,
    )
  // The decoder's OWN "something is left out" findings, marked alongside the ones this door's audits add. They
  // used to be listed on the card and marked nowhere, because no family reaching this door produced any — the
  // one that does is Gowin, and every Gowin file was refused at the front door. The card counts these parts in
  // its "marked with a ⚠ on the canvas" sentence, so leaving them unmarked made the card state a falsehood the
  // moment the Gowin door opened.
  for (const caveat of lowered.incomplete)
    mark(
      caveat.ref,
      `Something is left out of this part, which was read from a chip file: ${plainEnglish(caveat.reason)}.`,
    )
  for (const finding of extraIncomplete)
    mark(finding.ref, `This part was read from a chip file. ${finding.reason}`)

  return {
    family: about.family,
    device: about.device,
    form: about.form,
    partCount: about.partCount,
    pieceCount: lowered.nodes.length,
    inputCount: lowered.inputNodes.size,
    missing: [...caveatLines(about.family, lowered.undecoded), ...(about.extra?.missing ?? [])],
    untrusted: caveatLines(about.family, lowered.unfaithful),
    incomplete: [
      ...caveatLines(about.family, lowered.incomplete),
      ...extraIncomplete.map(({ ref, reason }) => ({ part: partLabel(about.family, ref), reason })),
    ],
    notes: [...about.notes, ...(about.extra?.notes ?? [])],
    scope: about.scope,
    markings,
  }
}

/** The plain name for one kind of place on an iCE40 chip, for a reader who has never heard of a "tile". */
const ICE40_AREA_NAMES: Record<string, string> = {
  io: 'pin area',
  ramb: 'block-memory area',
  ramt: 'block-memory area',
  dsp0: 'arithmetic area',
  dsp1: 'arithmetic area',
  dsp2: 'arithmetic area',
  dsp3: 'arithmetic area',
  ipcon: 'built-in-hardware area',
}

/** An iCE40 input pin's own wire, as the chip database names it (`<x>_<y>_io_<n>/D_IN_<n>`). */
const IO_INPUT_WIRE = /_io_\d+\/D_IN_\d+$/

/**
 * The iCE40 reading, audited against what it does NOT do — the half that was never written.
 *
 * The reader decodes a chip's LOGIC areas and the wiring between them, and nothing else. Two consequences reach
 * the user as a wrong picture rather than as a missing one, and both are found here:
 *
 *  1. A chip file can programme block memories, arithmetic units and pin areas that are simply not read. A design
 *     built around a block memory therefore arrives looking complete. The kinds of area a file programmes are
 *     counted from its own bits, and the memory CONTENTS it carries are reported as a part that is not here.
 *
 *  2. Worse: an input whose driver the reader could not follow is reported as a PRIMARY input, and the canvas
 *     then offers it as a switch the user can set to 0 V or 5 V. For an input that really does come from a pin
 *     of the chip that is exactly right. For one that comes from a block memory it is an invented control that
 *     the real chip does not have. The two are told apart by the wire the trace stopped at: a pin's own wire is
 *     named for the pin. Measured on a real design with a 256-byte memory (fixtures/icebox-ice40-1k-blockram):
 *     of its 25 reported inputs, 17 reach a pin of the chip and 8 do not — and that memory is 8 bits wide.
 */
function auditIce40Reading(
  deviceName: string,
  device: IceboxDevice,
  netlist: RecoveredNetlist,
  bits: readonly { x: number; y: number }[],
  hasMemoryContents: boolean,
): FpgaExtraFindings {
  const areaTiles = new Map<string, Set<string>>()
  for (const bit of bits) {
    const kind = tileType(deviceName, bit.x, bit.y)
    const area = ICE40_AREA_NAMES[kind]
    if (area === undefined) continue
    const seen = areaTiles.get(area)
    if (seen === undefined) areaTiles.set(area, new Set([`${bit.x},${bit.y}`]))
    else seen.add(`${bit.x},${bit.y}`)
  }
  const notes: string[] = []
  if (areaTiles.size > 0) {
    const counted = [...areaTiles.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([area, tiles]) => plural(tiles.size, area, `${area}s`))
    notes.push(
      `ChipBlocks reads a chip's logic parts and the wiring between them, and nothing else. This file also sets switches in ${listPhrase(counted)} of the chip, and what those do is not read, so none of it is on the canvas.`,
    )
  }

  const missing: FpgaCaveatLine[] = []
  if (hasMemoryContents)
    missing.push({
      part: 'a block memory of the chip, with the contents this file starts it with',
      reason:
        'this chip file carries the starting contents of one of the chip’s block memories, so the design uses one. ChipBlocks does not read block memories at all, so neither the memory nor its contents is on the canvas, and anything that reads from it is reading something that is not here',
    })

  // Which net numbers name a wire that belongs to a pin of the chip.
  const wireIndex = buildWireIndex(device)
  const pinNets = new Set<number>()
  for (const [name, net] of wireIndex.entries()) if (IO_INPUT_WIRE.test(name)) pinNets.add(net)

  const incomplete: { ref: CellRef; reason: string }[] = []
  for (const cell of netlist.cells) {
    const unfollowed = new Set<number>()
    for (const input of cell.inputs)
      if (input.kind === 'primary' && !pinNets.has(input.net)) unfollowed.add(input.net)
    if (unfollowed.size === 0) continue
    const count = unfollowed.size
    incomplete.push({
      ref: cell.ref,
      reason: `what this part computes was read correctly, but ${count === 1 ? 'one of its inputs' : `${count} of its inputs`} could not be followed back to a pin of the chip — on the real chip ${count === 1 ? 'it comes' : 'they come'} from a part of the chip ChipBlocks does not read, such as a block memory. On the canvas ${count === 1 ? 'it is' : 'they are'} offered as ${count === 1 ? 'a switch' : 'switches'} you can set to 0 V or 5 V, which the real chip does not have`,
    })
  }
  return { missing, incomplete, notes }
}

/** What the iCE40 reading did and did not look at — stated on every report, empty findings or not. */
const ICE40_SCOPE =
  'What was checked: every logic part this chip file programs was read, and each one whose value could not be stood behind is listed above. What was NOT checked: ChipBlocks reads a chip’s logic parts and the wiring between them only, so the chip’s pins, its block memories and their contents, and its arithmetic and built-in-hardware areas are not read at all — nothing here can tell you whether those are right.'

/** The same for ECP5, whose reading is bounded by which kinds of tile a description was supplied for. */
const ECP5_SCOPE =
  'What was checked: every lookup table in this chip file’s logic tiles was read, and each one whose value could not be stood behind is listed above. What was NOT checked: only the kinds of tile you supplied a description for were read, and the chip’s pins, its block memories and their contents, and its hard blocks are not read at all — nothing here can tell you whether those are right.'

/**
 * The same for Gowin. Its last sentence is the one that matters most and is the one the other two do not need.
 *
 * The iCE40 reading was audited against what it leaves out, so its report can count the areas of the chip a file
 * programmes that nothing reads. Nobody has done that for this reader, so it cannot say which of the parts below
 * a particular file uses — only that it does not read them. Claiming otherwise, or leaving the sentence off and
 * letting an empty report imply a clean chip, is the failure this whole card exists to prevent.
 */
const GOWIN_SCOPE =
  'What was checked: every lookup table this chip file programs was read, together with the flip-flop beside it and the switches that wire one tile’s parts to another’s, and each part whose value could not be stood behind is listed above. What was NOT checked: the chip’s pins and the buffers behind them, and its clock generators, are not read at all, and its block memories and its arithmetic units are recognised only well enough to refuse them, never read — so a design that stores anything in a block memory is missing that memory, and every part reading one is marked. Nor has this reader been examined against what it leaves out the way the iCE40 one has, so nothing here can tell you which of those this particular file uses.'

/** Which of the three a report carries — one lookup, so a family added without a scope is a compile error. */
const FAMILY_SCOPE: Record<FpgaFamily, string> = {
  ice40: ICE40_SCOPE,
  ecp5: ECP5_SCOPE,
  gowin: GOWIN_SCOPE,
}

/**
 * The app's own AND / OR / NOT / Buffer, by the name the lowering uses.
 *
 * The lowering builds each gate as a bare `{ name, nodes: [], edges: [], ports: [] }`, which is all the fast
 * logic engine needs — it evaluates a gate by NAME. On a canvas a block with no ports has no pins, so every
 * recovered wire would point at a handle that does not exist and React Flow would draw none of them: a screen
 * of unconnected boxes. Swapping in the real block gives the pins the lowering already wires by name (`a`, `b`,
 * `in`, `out`), and with them the actual transistors inside, so a recovered chip design can be opened all the
 * way down like any other part of this app.
 */
const GATE_BLOCKS = new Map(
  Object.values(BUILTIN_BLOCKS)
    .filter((block) => isLogicGate(block))
    .map((block) => [block.name, block] as const),
)

/**
 * Turn the lowered canvas into the ordinary circuit the app opens, so an FPGA design takes the import path.
 *
 * `markings` is what makes a warning outlive the card it arrived on. A caveat is about a CELL of the chip, and a
 * cell becomes a dozen canvas parts, so every one of those parts is given the caveat's words. From here it is an
 * ordinary field of the circuit file: it is saved with the design, comes back when the file is reopened, and is
 * drawn on the part itself. Without it, dismissing the card left an untrustworthy part indistinguishable from a
 * trustworthy one, for good.
 */
export function loweredToCircuitFile(
  lowered: LoweredCanvas,
  markings: ReadonlyMap<string, string> = new Map(),
): CircuitFile {
  const caveatOfNode = new Map<string, string>()
  for (const [key, text] of markings)
    for (const nodeId of lowered.cellNodes.get(key) ?? []) caveatOfNode.set(nodeId, text)
  const nodes: SavedNode[] = lowered.nodes.map((node) => {
    const block =
      node.data.block === undefined
        ? undefined
        : (GATE_BLOCKS.get(node.data.block.name) ?? node.data.block)
    const caveat = caveatOfNode.get(node.id)
    return {
      id: node.id,
      definition: node.data.definition,
      x: node.position.x,
      y: node.position.y,
      ...(node.data.parameters ? { parameters: node.data.parameters } : {}),
      ...(block ? { block } : {}),
      ...(caveat ? { caveat } : {}),
    }
  })
  const wires: SavedWire[] = lowered.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourceHandle ?? null,
    target: edge.target,
    targetHandle: edge.targetHandle ?? null,
  }))
  return { format: CIRCUIT_FILE_FORMAT, version: CIRCUIT_FILE_VERSION, nodes, wires }
}

/** What opening a chip file produced: a circuit plus its honest account, or the reason it could not be read. */
export type FpgaOpenResult =
  | { ok: true; circuit: CircuitFile; report: FpgaOpenReport }
  | {
      ok: false
      reason: string
      /** true only when the missing thing is the chip DESCRIPTION, so offering to go and pick one is the fix.
       *  A file that was read fine and simply held no logic must not be offered that button. */
      needsDescription?: boolean
    }

/**
 * Open a user's FPGA chip file with the chip-description files they supplied.
 *
 * Every path out of here is either a circuit the user can look at and run, or a sentence saying why there isn't
 * one. There is no third path where something plausible appears with a third of it quietly missing — that is what
 * `missing` / `untrusted` / `incomplete` exist to prevent.
 */
export function openFpgaDesign(
  bytes: Uint8Array,
  descriptions: readonly ChipDescriptionFile[],
): FpgaOpenResult {
  const identity = identifyBitstream(bytes)
  if (!identity.ok) return identity

  const built = buildReferences(identity.family, identity.device, descriptions)
  const held = built.references[identity.family] as Record<string, unknown> | undefined
  const haveDescription = held?.[identity.device] !== undefined
  // The programmatic door's own words for this case name the device three times and never mention the files the
  // user actually chose — so a user who picked the description of the WRONG chip was told only that none was
  // loaded. The reason each file was passed over is the one thing that tells them what to do next.
  if (!haveDescription)
    return {
      ok: false,
      needsDescription: true,
      reason: [
        `This is a ${chipName(identity.family, identity.device)} chip file, but ChipBlocks does not have the description of what is inside that chip, so it cannot turn the file back into a circuit.`,
        // Which PART of the description is absent, where a description is made of several. Nothing is said when
        // the whole thing is absent, because "all of it is missing" is what the sentence above already says.
        ...(built.missingPieces.length > 0 &&
        built.missingPieces.length < Object.keys(GOWIN_DESCRIPTION_PIECES).length
          ? [`What is still missing is the file that says ${listPhrase(built.missingPieces)}.`]
          : []),
        ...built.unused.map(({ name, reason }) => `The file "${name}" was not used: ${reason}.`),
        chipDescriptionRequest(identity.family, identity.device),
      ].join(' '),
    }

  // The ECP5 decoder does not merely prefer the logic-tile description, it dereferences it (`dbFor('PLC2')` in
  // reconstructEcp5Netlist, cast non-null) and throws without it. Refusing here says which file is missing;
  // letting it through says "Cannot read properties of null".
  if (identity.family === 'ecp5' && !built.describedTileKinds.includes('PLC2'))
    return {
      ok: false,
      needsDescription: true,
      reason: `The description of this chip's logic tiles is missing. Every lookup table on a ${chipName(identity.family, identity.device)} lives in a tile named PLC2, so without the "PLC2" description file from Project Trellis there is nothing to read. ${chipDescriptionRequest(identity.family, identity.device)}`,
    }

  const notes: string[] = []
  for (const { name, reason } of built.unused)
    notes.push(`The file "${name}" was not used: ${reason}.`)

  let netlist: RecoveredNetlist
  let extra: FpgaExtraFindings = {}
  const ice40Db = built.references.ice40?.[identity.device]
  if (identity.family === 'ice40' && identity.form === 'text' && ice40Db !== undefined) {
    // A TEXT chip file. It is read by its own reader, but ends at the same recovery the binary one does.
    const text = iceboxAscText(bytes)
    const loadedAsc =
      text === null
        ? { ok: false as const, reason: 'This chip file could not be read as text.' }
        : loadIce40AscDesign(text, built.references.ice40 ?? {})
    if (!loadedAsc.ok) return { ok: false, reason: loadedAsc.reason }
    netlist = loadedAsc.netlist
    notes.push(
      'This is the text form of a chip file, which carries no checksum of any kind, so there is nothing in it that could tell a damaged file from an intact one. Nothing here has checked that.',
    )
    extra = auditIce40Reading(
      identity.device,
      ice40Db.device,
      netlist,
      ascTileBits(loadedAsc.parsed),
      ascHasBlockMemoryContents(loadedAsc.parsed),
    )
  } else {
    let loaded: ReturnType<typeof loadBitstream>
    try {
      loaded = loadBitstream(bytes, built.references)
    } catch (error) {
      return {
        ok: false,
        reason: `Reading this ${chipName(identity.family, identity.device)} chip file stopped with an error: ${error instanceof Error ? error.message : String(error)}. Nothing has been put on the canvas — a partly-read design would be worse than none.`,
      }
    }
    if (!loaded.ok) return { ok: false, reason: loaded.reason }
    netlist = loaded.netlist
    if (!loaded.crcOk)
      notes.push(
        'The file’s own checksum does not match, so part of it may be damaged. What follows was still read, but treat it with suspicion.',
      )
    if (identity.family === 'ice40' && ice40Db !== undefined) {
      // Re-read the file's own bits for the audit. The load path keeps only what it decoded, and the whole point
      // of the audit is the bits it decoded NOTHING from.
      const parsedBin = parseBinFile(bytes)
      extra = auditIce40Reading(
        identity.device,
        ice40Db.device,
        netlist,
        cramToProgrammedBits(identity.device, parsedBin.cram),
        parsedBin.bram.some((bank) => bank.some((column) => column.some(Boolean))),
      )
    }
  }

  // What was read is bounded by which kinds of tile were described, so say so. This is where a user who supplied
  // the logic tiles but not the connection tiles learns why their design has parts with nothing wired to them.
  if (built.describedTileKinds.length > 0)
    notes.push(
      `The logic was read from this chip's logic tiles, and the wiring only from the ${plural(built.describedTileKinds.length, 'kind of place', 'kinds of place')} on the chip your chosen description files cover — Project Trellis names ${built.describedTileKinds.length === 1 ? 'it' : 'them'} ${listPhrase(built.describedTileKinds)}, which is where those file names come from. Wiring that runs anywhere else on the chip was not read, so a part here may show fewer connections than it really has on the chip.`,
    )

  // A read that found NO logic is not a success, and must not replace what the user has open. The file may well
  // be an intact chip file — a blank chip, or one whose whole design lives in parts this reader does not read —
  // but there is nothing to put on a canvas either way, and reporting "0 parts recovered" in green over an
  // emptied canvas was the worst of both.
  if (netlist.cells.length === 0)
    return {
      ok: false,
      reason: [
        `This ${chipName(identity.family, identity.device)} chip file was read, but no logic parts were found in it, so there is nothing to put on the canvas. Your circuit has been left exactly as it was.`,
        'Either the chip was never programmed with any logic, or its design lives entirely in parts of the chip ChipBlocks does not read.',
        ...notes,
        ...(extra.notes ?? []),
      ].join(' '),
    }

  const lowered = lowerNetlistToCanvas(netlist)
  const report = fpgaReportFor(lowered, {
    family: identity.family,
    device: identity.device,
    form: identity.form,
    partCount: netlist.cells.length,
    notes,
    scope: FAMILY_SCOPE[identity.family],
    extra,
  })
  return { ok: true, circuit: loweredToCircuitFile(lowered, report.markings), report }
}

/** The set bits of a parsed text chip file, as the audit's coordinate list. */
function ascTileBits(parsed: ParsedAsc): { x: number; y: number }[] {
  const bits: { x: number; y: number }[] = []
  for (const tile of parsed.tiles)
    for (const row of tile.rows)
      for (const character of row) if (character === '1') bits.push({ x: tile.x, y: tile.y })
  return bits
}

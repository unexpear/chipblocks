/**
 * FPGA fabric — real iCE40: read the TEXT chip file (`.asc`), the format Project IceStorm's `icepack -u` and
 * nextpnr-ice40 both write. `fpga-icebox-bin.ts` reads the binary `.bin`; this reads the human-readable listing
 * of the same configuration, and both end at the same place — a list of per-tile `ProgrammedBit`s the tile
 * decoders consume — so a design opened from either file follows one code path from there on.
 *
 * The `.asc` is the file a real user most often has: nextpnr writes it, and `icepack` turns it into the `.bin`
 * that is programmed into the chip. It is also SIMPLER than the `.bin`: the binary streams four CRAM banks whose
 * coordinates have to be un-permuted back to tiles (`fpga-icebox-cram-index.ts`), whereas the text file already
 * names each tile and prints its 16 rows of bits. Nothing has to be inferred.
 *
 * The grammar is transcribed from Project IceStorm's `icebox.py` `read_file` (ISC) — the authoritative reader —
 * directive for directive, including its rules that a line starting with `.` is always a directive, that a tile
 * directive is followed by exactly 16 data rows, and that `.comment` swallows every following line until the
 * next directive.
 *
 * Honest scope: this reads the CONFIGURATION — the per-tile bits, plus the block-memory contents, extra bits,
 * warmboot flag and signal names the file carries. What is then made of those bits is the same decoding the
 * `.bin` path does, with the same limits (logic tiles are decoded; pin, block-memory and arithmetic tiles are
 * not). A text file carries no checksum of any kind, so unlike the `.bin` there is nothing here that can tell a
 * damaged file from an intact one — `fpga-open.ts` says so to the user rather than implying a check happened.
 * Anything this reader does not recognise is collected in `unrecognised` and reported, never dropped.
 */

import type { ProgrammedBit } from './fpga-icebox.ts'
import { chipHeight, chipWidth, tileType, tileWidth } from './fpga-icebox-cram-index.ts'

/** One tile's configuration as the text file prints it: its kind, its place on the chip, its 16 rows of bits. */
export type AscTile = { type: string; x: number; y: number; rows: string[] }

/** A whole `.asc` file, read into its parts. */
export type ParsedAsc = {
  /** the chip the file declares (`.device`), or null if it declares none. */
  device: string | null
  /** the `.comment` text, joined by newlines; '' if the file has none. */
  comment: string
  warmboot: 'enabled' | 'disabled' | null
  tiles: AscTile[]
  /** block-memory contents (`.ram_data`), one entry per memory, each 16 rows of hexadecimal digits. */
  ramData: { x: number; y: number; rows: string[] }[]
  /** configuration cells that belong to no tile (`.extra_bit`), by bank and position. */
  extraBits: { bank: number; x: number; y: number }[]
  /** the signal names the place-and-route tool wrote (`.sym`): net number → every name given to it. */
  symbols: Map<number, string[]>
  /** every line this reader did not recognise, with its line number — reported, never silently dropped. */
  unrecognised: { line: number; text: string }[]
}

/** The tile directives, and the tile kind each one names (icebox.py `read_file`). */
const TILE_DIRECTIVES: Record<string, string> = {
  '.io_tile': 'io',
  '.logic_tile': 'logic',
  '.ramb_tile': 'ramb',
  '.ramt_tile': 'ramt',
  '.ipcon_tile': 'ipcon',
  '.dsp0_tile': 'dsp0',
  '.dsp1_tile': 'dsp1',
  '.dsp2_tile': 'dsp2',
  '.dsp3_tile': 'dsp3',
}

/** The chips icebox names in a `.device` line. */
const ASC_DEVICES = ['384', '1k', '5k', '8k', 'u4k', 'lm4k']

const isWholeNumber = (word: string | undefined): boolean =>
  word !== undefined && /^\d+$/.test(word)

/**
 * Whether some text is an IceStorm text chip file — a `.device` line naming a chip icebox knows, plus at least
 * one tile AT A PLACE ON THE CHIP.
 *
 * All three are required, and the coordinates are the reason. A chip DESCRIPTION file (the `chipdb-*.txt` the
 * user supplies as reference data) also opens with `.device`, and also has `.logic_tile` sections — but its
 * sections describe what a logic tile IS, in the abstract, and carry no place on the chip. Without the
 * coordinate test a user who picked their chip description by mistake would be told their chip file was
 * damaged instead of that they picked the wrong file.
 */
export function isIceboxAscText(text: string): boolean {
  let sawDevice = false
  let sawSettings = false
  let expectSettings = false
  for (const raw of text.split(String.fromCharCode(10))) {
    const line = raw.trim()
    if (line.length === 0) continue
    const words = line.split(/\s+/)
    const head = words[0] as string
    if (expectSettings && isBinaryRow(head) && head.length >= 18) sawSettings = true
    if (head === '.device' && ASC_DEVICES.includes(words[1] ?? '')) sawDevice = true
    expectSettings =
      TILE_DIRECTIVES[head] !== undefined && isWholeNumber(words[1]) && isWholeNumber(words[2])
    if (sawDevice && sawSettings) return true
  }
  return false
}

const isBinaryRow = (row: string): boolean => /^[01]+$/.test(row)
const isHexRow = (row: string): boolean => /^[0-9a-fA-F]+$/.test(row)

/**
 * Read a whole `.asc` into its parts.
 *
 * Throws for a structurally broken file — a tile with the wrong number of rows, a coordinate or bit that is not
 * a number — because half a chip file is worse than none. A directive this reader has never heard of is NOT an
 * error: it is recorded in `unrecognised` (with its data block skipped, exactly as icebox.py does) so a file
 * written by a newer tool still opens and the user is told what was passed over.
 */
export function parseIceboxAsc(text: string): ParsedAsc {
  const parsed: ParsedAsc = {
    device: null,
    comment: '',
    warmboot: null,
    tiles: [],
    ramData: [],
    extraBits: [],
    symbols: new Map(),
    unrecognised: [],
  }
  const commentLines: string[] = []
  // What the lines after the current directive are: rows of a tile, rows of memory contents, comment text, or
  // the leftovers of a directive that was passed over.
  let collecting: 'tile' | 'ram' | 'comment' | 'skip' | 'none' = 'none'
  let pending: AscTile | { x: number; y: number; rows: string[] } | null = null
  let rowsLeft = 0

  const finishBlock = (lineNumber: number): void => {
    if (rowsLeft > 0 && (collecting === 'tile' || collecting === 'ram'))
      throw new Error(
        `The chip file ends a block early at line ${lineNumber}: ${rowsLeft} more row${rowsLeft === 1 ? '' : 's'} of settings were expected.`,
      )
  }

  const lines = text.split(String.fromCharCode(10))
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] as string).trim()
    const lineNumber = i + 1
    if (line.length === 0) continue

    if (!line.startsWith('.')) {
      if (collecting === 'comment') {
        commentLines.push(line)
        continue
      }
      if (collecting === 'skip') continue
      const row = line.split(/\s+/)[0] as string
      // icebox.py's own rule: a line that is neither a directive nor a row of settings is passed over with a
      // warning rather than stopping the read, and whatever block it belonged to is abandoned with it.
      if (!isHexRow(row)) {
        parsed.unrecognised.push({ line: lineNumber, text: line.slice(0, 80) })
        collecting = 'none'
        rowsLeft = 0
        continue
      }
      if (collecting === 'none')
        throw new Error(
          `The chip file has settings at line ${lineNumber} that belong to no part of the chip.`,
        )
      if (collecting === 'tile' && !isBinaryRow(row))
        throw new Error(
          `The chip file's settings at line ${lineNumber} are not readable: "${line.slice(0, 40)}".`,
        )
      ;(pending as { rows: string[] }).rows.push(row)
      rowsLeft--
      continue
    }

    finishBlock(lineNumber)
    const words = line.split(/\s+/)
    const head = words[0] as string
    const tileKind = TILE_DIRECTIVES[head]
    if (tileKind !== undefined || head === '.ram_data') {
      const x = Number(words[1])
      const y = Number(words[2])
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0)
        throw new Error(
          `The chip file names a place on the chip it cannot have, at line ${lineNumber}.`,
        )
      rowsLeft = 16
      if (tileKind === undefined) {
        const ram = { x, y, rows: [] as string[] }
        parsed.ramData.push(ram)
        pending = ram
        collecting = 'ram'
        continue
      }
      const tile: AscTile = { type: tileKind, x, y, rows: [] }
      parsed.tiles.push(tile)
      pending = tile
      collecting = 'tile'
      continue
    }

    collecting = 'none'
    rowsLeft = 0
    if (head === '.device') {
      const named = words[1] ?? ''
      if (!ASC_DEVICES.includes(named))
        throw new Error(
          `This chip file says it is for a chip called "${named}", which is not an iCE40 chip ChipBlocks knows.`,
        )
      parsed.device = named
      continue
    }
    if (head === '.comment') {
      if (words.length > 1) commentLines.push(words.slice(1).join(' '))
      collecting = 'comment'
      continue
    }
    if (head === '.warmboot') {
      const value = words[1] ?? ''
      if (value !== 'enabled' && value !== 'disabled')
        throw new Error(`The chip file's warm-boot setting at line ${lineNumber} is not readable.`)
      parsed.warmboot = value
      continue
    }
    if (head === '.extra_bit') {
      const [bank, x, y] = [Number(words[1]), Number(words[2]), Number(words[3])]
      if (!Number.isInteger(bank) || !Number.isInteger(x) || !Number.isInteger(y))
        throw new Error(`The chip file has an unreadable setting at line ${lineNumber}.`)
      parsed.extraBits.push({ bank, x, y })
      continue
    }
    if (head === '.sym') {
      const net = Number(words[1])
      const name = words[2]
      if (!Number.isInteger(net) || name === undefined)
        throw new Error(`The chip file has an unreadable signal name at line ${lineNumber}.`)
      const existing = parsed.symbols.get(net)
      if (existing === undefined) parsed.symbols.set(net, [name])
      else if (!existing.includes(name)) existing.push(name)
      continue
    }
    // icebox.py's own fallback: an unknown directive is passed over along with whatever follows it.
    parsed.unrecognised.push({ line: lineNumber, text: line.slice(0, 80) })
    collecting = 'skip'
  }
  finishBlock(lines.length)
  parsed.comment = commentLines.join(String.fromCharCode(10))
  return parsed
}

/**
 * Every set bit of every tile, as the `ProgrammedBit`s the tile decoders consume — the same list the `.bin`
 * path reaches through `cramToProgrammedBits`.
 *
 * Each tile is CHECKED against the chip it claims to be for: a tile outside the chip's grid, a tile whose kind
 * disagrees with what sits at that place on that chip, or a row of the wrong width means the file and the chip
 * do not match, and a wrong tile kind would decode into settings that were never programmed. Those throw rather
 * than being read anyway.
 */
export function ascProgrammedBits(parsed: ParsedAsc): ProgrammedBit[] {
  const device = parsed.device
  if (device === null) throw new Error('This chip file does not say which chip it is for.')
  const maxX = chipWidth(device) + 1
  const maxY = chipHeight(device) + 1
  const bits: ProgrammedBit[] = []
  for (const tile of parsed.tiles) {
    if (tile.x > maxX || tile.y > maxY)
      throw new Error(
        `This chip file describes a place (column ${tile.x}, row ${tile.y}) that is off the edge of the chip it says it is for.`,
      )
    const expected = tileType(device, tile.x, tile.y)
    if (expected !== tile.type)
      throw new Error(
        `This chip file calls the place at column ${tile.x}, row ${tile.y} a ${tile.type} tile, but that chip has a ${expected} tile there — the file and the chip do not match.`,
      )
    if (tile.rows.length !== 16)
      throw new Error(
        `The settings for column ${tile.x}, row ${tile.y} are the wrong size — 16 rows were expected and ${tile.rows.length} were found.`,
      )
    const width = tileWidth(expected)
    for (let row = 0; row < 16; row++) {
      const text = tile.rows[row] as string
      if (text.length !== width)
        throw new Error(
          `The settings for column ${tile.x}, row ${tile.y} are the wrong width — ${width} were expected and ${text.length} were found.`,
        )
      for (let col = 0; col < width; col++)
        if (text[col] === '1') bits.push({ x: tile.x, y: tile.y, row, col, value: 1 })
    }
  }
  return bits
}

/** Whether the file carries the starting contents of a block memory — any `.ram_data` digit that is not zero. */
export function ascHasBlockMemoryContents(parsed: ParsedAsc): boolean {
  return parsed.ramData.some((ram) => ram.rows.some((row) => /[1-9a-fA-F]/.test(row)))
}

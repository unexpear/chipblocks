/**
 * FPGA fabric — ECP5 (Project Trellis): turn a parsed `.bit`'s raw configuration FRAMES into per-TILE bits, and
 * decode a logic tile's SLICEs into LUT4 truth tables. This is the ECP5 counterpart of the iCE40
 * `fpga-icebox-cram-index.ts` (frame ↔ tile geometry) plus `fpga-icebox-logic.ts` (cell decode), and it is what
 * lifts `fpga-trellis-bit.ts` from "container + raw frames" to "what the design actually computes".
 *
 * Two pieces of Project Trellis reference data drive it, both parsed here, neither invented:
 *   - a per-device TILEGRID (`<device>/tilegrid.json`): every tile's type and its window into the frame array —
 *     `start_frame` / `start_bit` with `cols` frames of `rows` bits (Trellis's `Database.cpp` reads `cols` as
 *     `num_frames` and `rows` as `bits_per_frame` — the JSON names are the transpose of their meaning). A
 *     tile-relative bit (f, b) is frame `start_frame + f`, bit `start_bit + b`, exactly as `CRAMView::bit`.
 *   - a per-TILE-TYPE bit database (`tiledata/<type>/bits.db`): `.config <name> <default>` followed by one line
 *     per word bit, each `[!]F<frame>B<bit>` (tile-relative; `!` means the stored bit is inverted). A word bit's
 *     logical value is `stored XOR inv` — Trellis `ConfigBit` / `BitGroup::match`.
 *
 * Word bit ORDER is taken from Trellis's own serialisation, not guessed: `to_string(vector<bool>)` (Util.hpp)
 * prints a word REVERSED and `operator>>` reads it back the same way, so entry 0 of the word is the last
 * character printed. For a LUT that makes entry i = INIT[i] = the output when the inputs read i — the same
 * convention as our own `truth[]` (`truth[8·in3 + 4·in2 + 2·in1 + in0]`), so an ECP5 LUT drops straight
 * into the existing `evalLut4`. Honest caveat: this order is source-derived. Every `.config` default in the PLC2
 * database is the symmetric all-ones word, so the vendored fixtures cannot themselves distinguish it; confirming
 * it end-to-end needs a real `ecppack` bitstream with a known, asymmetric LUT.
 *
 * Honest scope: this decodes CONFIG WORDS — including every SLICE's two LUT4 INITs, which is the logic content of
 * an ECP5 PLC2 tile. It does not decode the `.config_enum`, `.mux` or `.fixed_conn` sections, so ROUTING (who
 * drives whom) and the flip-flop/mux mode settings are not recovered yet; that is the next step before an ECP5
 * design can be reconstructed and simulated the way an iCE40 one already is.
 */

/** One tile's window into the configuration frames. */
export type Ecp5Tile = {
  name: string
  type: string
  startFrame: number
  startBit: number
  /** how many FRAMES this tile spans. NOTE: this is the tilegrid's `cols` field — Trellis reads `cols` as
   *  `num_frames` and `rows` as `bits_per_frame`, i.e. the JSON names are the transpose of their meaning. */
  numFrames: number
  /** how many BITS of each frame this tile spans (the tilegrid's `rows` field — see above). */
  bitsPerFrame: number
}

/** One config word: its tile-relative bits (each possibly inverted) and the default value. */
export type Ecp5ConfigWord = {
  name: string
  /** `bits[i]` are the bits of word entry `i`; the entry is true when ALL of them match. */
  bits: { frame: number; bit: number; inv: boolean }[][]
  defaultValue: boolean[]
}

/** A tile type's bit database — currently its `.config` words (see the module's honest scope). */
export type Ecp5TileDb = { words: Map<string, Ecp5ConfigWord> }

/**
 * Parse a Trellis per-device `tilegrid.json`. Tiles are keyed by their FULL `"<name>:<type>"` key, not by name:
 * a location can host several tiles of different types (on the LFE5U-25F, 97 names are shared — e.g.
 * `CIB_R25C2:CIB_EBR` and `CIB_R25C2:ECLK_L`), so keying by name alone silently loses tiles.
 */
export function parseEcp5TileGrid(json: string): Map<string, Ecp5Tile> {
  const raw = JSON.parse(json) as Record<
    string,
    { type?: string; cols?: number; rows?: number; start_bit?: number; start_frame?: number }
  >
  const tiles = new Map<string, Ecp5Tile>()
  for (const [key, value] of Object.entries(raw)) {
    // keys look like "R10C1:PLC2" — the tile's name, then its type
    const name = key.includes(':') ? (key.split(':')[0] as string) : key
    const type = value.type ?? (key.includes(':') ? (key.split(':')[1] as string) : '')
    if (
      value.start_frame === undefined ||
      value.start_bit === undefined ||
      value.rows === undefined ||
      value.cols === undefined
    )
      continue
    tiles.set(key, {
      name,
      type,
      startFrame: value.start_frame,
      startBit: value.start_bit,
      // Trellis's Database.cpp: num_frames = "cols", bits_per_frame = "rows" — the JSON field names are the
      // transpose of what they mean, so a PLC2 with cols=106/rows=12 spans 106 frames of 12 bits.
      numFrames: value.cols,
      bitsPerFrame: value.rows,
    })
  }
  return tiles
}

/** One `[!]F<frame>B<bit>` token → a tile-relative config bit. */
function parseConfigBit(token: string): { frame: number; bit: number; inv: boolean } | null {
  const match = /^(!?)F(\d+)B(\d+)$/.exec(token.trim())
  if (match === null) return null
  return {
    inv: match[1] === '!',
    frame: Number(match[2]),
    bit: Number(match[3]),
  }
}

/**
 * Parse a Trellis `tiledata/<type>/bits.db` — its `.config` words. Each is a header line
 * `.config <name> <default-bits>` followed by one line per word entry, holding one or more
 * space-separated `[!]F<frame>B<bit>` bits that must all match for that entry to read true.
 * The `.config_enum` / `.mux` / `.fixed_conn` sections are skipped (see the module's honest scope).
 */
export function parseEcp5TileBits(text: string): Ecp5TileDb {
  const words = new Map<string, Ecp5ConfigWord>()
  const lines = text.split('\n')
  let current: Ecp5ConfigWord | null = null
  for (const raw of lines) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    if (line.startsWith('.')) {
      current = null
      const parts = line.split(/\s+/)
      if (parts[0] !== '.config') continue // enums / muxes / fixed connections are not decoded here
      const name = parts[1] as string
      const defaults = (parts[2] ?? '').split('').map((c) => c === '1')
      // Trellis prints a word reversed, so the string's LAST character is entry 0.
      current = { name, bits: [], defaultValue: defaults.reverse() }
      words.set(name, current)
      continue
    }
    if (current === null) continue
    const group = line
      .split(/\s+/)
      .map(parseConfigBit)
      .filter((b): b is { frame: number; bit: number; inv: boolean } => b !== null)
    if (group.length > 0) current.bits.push(group)
  }
  return words.size > 0 ? { words } : { words }
}

/**
 * Read one config word out of a tile: for each entry, every bit must match (`stored XOR inv`). Frames are the raw
 * frames from `parseEcp5Bitstream`; the tile supplies the window (`CRAMView::bit`).
 */
export function readTileWord(
  frames: readonly boolean[][],
  tile: Ecp5Tile,
  word: Ecp5ConfigWord,
): boolean[] {
  return word.bits.map((group) =>
    group.every(({ frame, bit, inv }) => {
      const row = frames[tile.startFrame + frame]
      const stored = row?.[tile.startBit + bit] ?? false
      return stored !== inv
    }),
  )
}

/** A LUT4 recovered from an ECP5 logic tile. */
export type Ecp5Lut = {
  /** the tile it lives in, e.g. `R10C5`. */
  tile: string
  /** the SLICE within the tile: 'A' | 'B' | 'C' | 'D'. */
  slice: string
  /** which LUT of the SLICE: 0 (K0) or 1 (K1). */
  lut: number
  /** the 16-entry truth table, `truth[8·in3 + 4·in2 + 2·in1 + in0]` — feeds `evalLut4` directly. */
  truth: boolean[]
}

/** The four SLICEs of an ECP5 PLC2 logic tile, each holding two LUT4s. */
const SLICES = ['A', 'B', 'C', 'D']

/**
 * Decode every LUT4 in every logic tile of a parsed ECP5 bitstream: for each `PLC2` tile in the grid, read each
 * SLICE's `K0.INIT` / `K1.INIT` word and return it as a truth table. LUTs left at their default (all-ones) value
 * are skipped by default, since an unprogrammed tile would otherwise look like thousands of constant-1 cells.
 */
export function decodeEcp5Luts(
  frames: readonly boolean[][],
  grid: Map<string, Ecp5Tile>,
  plc2: Ecp5TileDb,
  options: { includeDefault?: boolean } = {},
): Ecp5Lut[] {
  const luts: Ecp5Lut[] = []
  for (const tile of grid.values()) {
    if (tile.type !== 'PLC2') continue
    for (const slice of SLICES) {
      for (let lut = 0; lut < 2; lut++) {
        const word = plc2.words.get(`SLICE${slice}.K${lut}.INIT`)
        if (word === undefined) continue
        const truth = readTileWord(frames, tile, word)
        if (truth.length !== 16) continue
        if (!options.includeDefault && truth.every((b) => b)) continue // untouched (default all-ones)
        luts.push({ tile: tile.name, slice, lut, truth })
      }
    }
  }
  return luts
}

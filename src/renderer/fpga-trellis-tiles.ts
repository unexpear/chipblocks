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
 * All four database sections are decoded: `.config` WORDS (each SLICE's two LUT4 INITs), `.config_enum` CHOICES
 * (the SLICE `MODE` — LOGIC vs CCU2 carry vs distributed RAM — and each register's `SD` / `REGSET` / `LSRMODE`,
 * plus the clock / clock-enable / set-reset muxes), `.mux` ROUTING (which source drives each sink) and
 * `.fixed_conn` always-present connections. Enum and mux selection follow Trellis's own rules
 * (`EnumSettingBits::get_value` / `MuxBits::get_driver`): among the options whose bits all match, the one with the
 * MOST bits wins — an option with no bits matches vacuously — and a winner whose BIT GROUP equals the declared
 * default is reported as unset rather than as a configured value.
 *
 * Honest scope: `decodeEcp5Routing` reports arcs for the tile types whose bit database the caller supplies; tiles
 * of any other type are skipped, never guessed at. Only the PLC2 (logic) database is vendored here, so routing
 * through IO / EBR / DSP / clock tiles is not yet recovered. Assembling these arcs into a whole-design netlist —
 * the ECP5 equivalent of `reconstructNetlist` — is the next step.
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

/** One tile-relative config bit. */
export type Ecp5Bit = { frame: number; bit: number; inv: boolean }

/** An enum setting (`.config_enum`): a named choice, each option selected by a group of bits. */
export type Ecp5EnumSetting = {
  name: string
  /** the value the header names as the default (matched options equal to it are reported as the default). */
  defaultValue: string
  /** value name → the bits that select it. An option with NO bits matches vacuously, which is why the
   *  longest-match rule below is essential. */
  options: Map<string, Ecp5Bit[]>
}

/** A routing multiplexer (`.mux`): one sink, and the bits that select each possible source. */
export type Ecp5Mux = { sink: string; arcs: Map<string, Ecp5Bit[]> }

/** An always-present connection (`.fixed_conn`) — no bits, it is simply there. */
export type Ecp5FixedConn = { sink: string; source: string }

/** A tile type's bit database: its config words, enum settings, muxes and fixed connections. */
export type Ecp5TileDb = {
  words: Map<string, Ecp5ConfigWord>
  enums: Map<string, Ecp5EnumSetting>
  muxes: Map<string, Ecp5Mux>
  fixedConns: Ecp5FixedConn[]
}

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
 * Parse a Trellis `tiledata/<type>/bits.db`. Four section kinds, all decoded:
 *   `.config <name> <default>`      — a WORD: one following line per entry, each holding the bits that must all
 *                                     match for that entry to read true.
 *   `.config_enum <name> <default>` — a CHOICE: one following line per option, `<value> <bits…>` (`-` = no bits).
 *   `.mux <sink>`                   — ROUTING: one line per possible source, `<source> <bits…>`.
 *   `.fixed_conn <sink> <source>`   — a connection that is always present (no bits).
 */
export function parseEcp5TileBits(text: string): Ecp5TileDb {
  const words = new Map<string, Ecp5ConfigWord>()
  const enums = new Map<string, Ecp5EnumSetting>()
  const muxes = new Map<string, Ecp5Mux>()
  const fixedConns: Ecp5FixedConn[] = []
  let word: Ecp5ConfigWord | null = null
  let enumSetting: Ecp5EnumSetting | null = null
  let mux: Ecp5Mux | null = null

  for (const raw of text.split(String.fromCharCode(10))) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    if (line.startsWith('.')) {
      word = null
      enumSetting = null
      mux = null
      const parts = line.split(/\s+/)
      const name = parts[1] as string
      if (parts[0] === '.config') {
        // Trellis prints a word reversed, so the default string's LAST character is entry 0.
        const defaults = (parts[2] ?? '').split('').map((c) => c === '1')
        word = { name, bits: [], defaultValue: defaults.reverse() }
        words.set(name, word)
      } else if (parts[0] === '.config_enum') {
        enumSetting = { name, defaultValue: parts[2] ?? '', options: new Map() }
        enums.set(name, enumSetting)
      } else if (parts[0] === '.mux') {
        mux = { sink: name, arcs: new Map() }
        muxes.set(name, mux)
      } else if (parts[0] === '.fixed_conn') {
        fixedConns.push({ sink: name, source: parts[2] as string })
      }
      continue
    }
    const tokens = line.split(/\s+/)
    if (word !== null) {
      const group = tokens.map(parseConfigBit).filter((b): b is Ecp5Bit => b !== null)
      if (group.length > 0) word.bits.push(group)
      continue
    }
    // an enum option / mux arc is "<name> <bits…>"; a lone "-" means the option has no bits at all
    const label = tokens[0] as string
    const bits = tokens
      .slice(1)
      .map(parseConfigBit)
      .filter((b): b is Ecp5Bit => b !== null)
    if (enumSetting !== null) enumSetting.options.set(label, bits)
    else if (mux !== null) mux.arcs.set(label, bits)
  }
  return { words, enums, muxes, fixedConns }
}

/** Whether every bit of a group matches the tile (`stored XOR inv`). An EMPTY group matches vacuously. */
function groupMatches(
  frames: readonly boolean[][],
  tile: Ecp5Tile,
  group: readonly Ecp5Bit[],
): boolean {
  return group.every(({ frame, bit, inv }) => {
    const row = frames[tile.startFrame + frame]
    return (row?.[tile.startBit + bit] ?? false) !== inv
  })
}

/**
 * The selected value of an enum setting, or null if nothing matches. Follows Trellis's
 * `EnumSettingBits::get_value`: among the options whose bits all match, take the one with the MOST bits — an
 * option with no bits matches vacuously, so without that rule every setting would resolve to the empty option.
 */
export function readTileEnum(
  frames: readonly boolean[][],
  tile: Ecp5Tile,
  setting: Ecp5EnumSetting,
): string | null {
  let best: string | null = null
  let bestBits = -1
  for (const [value, bits] of setting.options)
    if (bits.length > bestBits && groupMatches(frames, tile, bits)) {
      best = value
      bestBits = bits.length
    }
  // Trellis reports NOTHING when the winning option is the declared default — an untouched setting is not a
  // configured one. (It compares bit groups, so an option with the same bits as the default counts as default.)
  if (best !== null) {
    // Compare the actual BIT GROUPS, as Trellis does — not just their sizes. SET and RESET each have one bit,
    // so a size-only check would wrongly read RESET as "the default".
    const dflt = setting.options.get(setting.defaultValue)
    const bestGroup = setting.options.get(best) as Ecp5Bit[]
    if (dflt !== undefined && sameGroup(dflt, bestGroup)) return null
  }
  return best
}

/** Whether two bit groups are the same set of bits (order-independent), for the default comparison above. */
function sameGroup(a: readonly Ecp5Bit[], b: readonly Ecp5Bit[]): boolean {
  if (a.length !== b.length) return false
  const key = (x: Ecp5Bit): string => `${x.frame}.${x.bit}.${x.inv}`
  const seen = new Set(a.map(key))
  return b.every((x) => seen.has(key(x)))
}

/**
 * The source currently driving a mux's sink, or null if none matches — Trellis's `MuxBits::get_driver`, with the
 * same longest-match rule.
 */
export function readTileMux(
  frames: readonly boolean[][],
  tile: Ecp5Tile,
  mux: Ecp5Mux,
): string | null {
  let best: string | null = null
  let bestBits = -1
  for (const [source, bits] of mux.arcs)
    if (bits.length > bestBits && groupMatches(frames, tile, bits)) {
      best = source
      bestBits = bits.length
    }
  return best
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

/** One SLICE recovered from an ECP5 logic tile: its two LUT4s and its flip-flop / mode settings. */
export type Ecp5Slice = {
  tile: string
  /** the SLICE within the tile: 'A' | 'B' | 'C' | 'D'. */
  slice: string
  /** the two LUT4 truth tables (`truth[8*in3 + 4*in2 + 2*in1 + in0]`), feeding `evalLut4` directly. */
  luts: [boolean[], boolean[]]
  /** the SLICE mode: LOGIC / CCU2 (carry) / DPRAM / RAMW, per the `MODE` enum. */
  mode: string | null
  /** the flip-flop settings of REG0 and REG1: `sd` (data source), `regset` (SET vs RESET), `lsrmode`. */
  regs: { sd: string | null; regset: string | null; lsrmode: string | null }[]
  /** the tile-shared clock / clock-enable / local-set-reset sources, and whether global set-reset is enabled. */
  clkMux: string | null
  ceMux: string | null
  lsrMux: string | null
  gsr: string | null
}

/**
 * Decode every SLICE of every logic tile: both LUT4s AND the flip-flop / mode settings that say how the SLICE
 * actually behaves (`MODE` — LOGIC vs CCU2 carry vs distributed RAM; each register's `SD` data source, `REGSET`
 * set-vs-reset and `LSRMODE`; and the clock / clock-enable / set-reset muxes). SLICEs whose LUTs are both at the
 * default all-ones value AND whose mode is unset are skipped unless `includeDefault` is set.
 */
export function decodeEcp5Slices(
  frames: readonly boolean[][],
  grid: Map<string, Ecp5Tile>,
  plc2: Ecp5TileDb,
  options: { includeDefault?: boolean } = {},
): Ecp5Slice[] {
  const slices: Ecp5Slice[] = []
  const enumOf = (tile: Ecp5Tile, name: string): string | null => {
    const setting = plc2.enums.get(name)
    return setting === undefined ? null : readTileEnum(frames, tile, setting)
  }
  for (const tile of grid.values()) {
    if (tile.type !== 'PLC2') continue
    for (const slice of SLICES) {
      const luts = [0, 1].map((lut) => {
        const word = plc2.words.get(`SLICE${slice}.K${lut}.INIT`)
        return word === undefined ? [] : readTileWord(frames, tile, word)
      }) as [boolean[], boolean[]]
      const mode = enumOf(tile, `SLICE${slice}.MODE`)
      const untouched = luts.every((t) => t.length === 16 && t.every((b) => b)) && mode === null
      if (untouched && !options.includeDefault) continue
      slices.push({
        tile: tile.name,
        slice,
        luts,
        mode,
        regs: [0, 1].map((r) => ({
          sd: enumOf(tile, `SLICE${slice}.REG${r}.SD`),
          regset: enumOf(tile, `SLICE${slice}.REG${r}.REGSET`),
          lsrmode: enumOf(tile, `SLICE${slice}.REG${r}.LSRMODE`),
        })),
        clkMux: enumOf(tile, `SLICE${slice}.CLKMUX`),
        ceMux: enumOf(tile, `SLICE${slice}.CEMUX`),
        lsrMux: enumOf(tile, `SLICE${slice}.LSRMUX`),
        gsr: enumOf(tile, `SLICE${slice}.GSR`),
      })
    }
  }
  return slices
}

/** One recovered routing connection inside a tile: `source` drives `sink`. */
export type Ecp5Arc = { tile: string; sink: string; source: string; fixed: boolean }

/**
 * Recover the ROUTING a bitstream programs: for every tile, each mux whose bits select a source yields an arc,
 * and every `.fixed_conn` yields an always-present one. `dbFor` supplies the bit database for a tile type (return
 * null for types you have not loaded — those tiles are skipped rather than guessed at).
 */
export function decodeEcp5Routing(
  frames: readonly boolean[][],
  grid: Map<string, Ecp5Tile>,
  dbFor: (tileType: string) => Ecp5TileDb | null,
  options: { includeFixed?: boolean } = {},
): Ecp5Arc[] {
  const arcs: Ecp5Arc[] = []
  const cache = new Map<string, Ecp5TileDb | null>()
  for (const tile of grid.values()) {
    if (!cache.has(tile.type)) cache.set(tile.type, dbFor(tile.type))
    const db = cache.get(tile.type) ?? null
    if (db === null) continue
    for (const mux of db.muxes.values()) {
      const source = readTileMux(frames, tile, mux)
      if (source !== null) arcs.push({ tile: tile.name, sink: mux.sink, source, fixed: false })
    }
    if (options.includeFixed)
      for (const conn of db.fixedConns)
        arcs.push({ tile: tile.name, sink: conn.sink, source: conn.source, fixed: true })
  }
  return arcs
}

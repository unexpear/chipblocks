/**
 * FPGA fabric — Gowin (via Project Apicula): read the device database that says what the fabric IS.
 *
 * The `.fs` parser next door recovers a bit-matrix; on its own that is a grid of anonymous ones and zeros. This
 * module supplies the geometry those bits belong to: how many tiles the part has, what KIND each tile is, and
 * which cells ("bels" — LUTs, flip-flops, carry/ALU, IO) each kind contains.
 *
 * WHERE THE DATA COMES FROM. Apicula ships its device databases as LZMA-compressed MessagePack
 * (`apycula/GW1N-1.msgpack.xz`), which is also bundled inside the oss-cad-suite tarball. MessagePack maps may be
 * keyed by TUPLES — 19,487 entries in GW1N-1 are — and JSON object keys must be strings, so the offline
 * conversion encodes a tuple key by joining its parts with a comma and FAILS LOUDLY on any collision rather than
 * silently dropping entries. `fixtures/gowin-gw1n1-chipdb.json` holds the slice this module needs.
 *
 * HONEST SCOPE. This reads the fabric inventory (grid, tile types, tile sizes, bel names, the vendor's own
 * command records), locates any tile's bits in the device bitmap, and decodes LUT TRUTH TABLES from those bits.
 *
 * It does NOT yet recover:
 *   - flip-flop modes, which live in the tile-level `shortval`/`logicinfo` attribute tables rather than in the
 *     cell's own flags (a logic tile's `DFF*` bels carry no flags at all — checked, not assumed);
 *   - routing, which needs the `pips` tables;
 *   - carry/ALU, BRAM, DSP, PLL and IO configuration.
 * So a Gowin bitstream does not yet reach the shared netlist/simulator the way an iCE40 or ECP5 one does.
 *
 * The decode convention is stated at `decodeGowinLuts` because it is INVERTED and easy to get backwards.
 */

/** One kind of tile: its size in configuration bits, and the cells it contains. */
export type GowinTileType = {
  ttyp: number
  /** width/height of this tile's own bit window. */
  width: number
  height: number
  /** the cells in this tile — `LUT0`..`LUT7`, `DFF0`..`DFF5`, `ALU0`..`ALU5`, `IOBA`/`IOBB`, and so on. */
  bels: readonly string[]
  /** how many routing switches (pips) the tile carries; the pips themselves are not read yet. */
  pipCount: number
}

/** A Gowin device's fabric: the tile grid, and what each tile type contains. */
export type GowinChipdb = {
  device: string
  idcode: number
  /** `grid[row][col]` is a tile-TYPE id, indexing `tileTypes`. */
  grid: readonly (readonly number[])[]
  rows: number
  cols: number
  centerRow: number
  centerCol: number
  tileTypes: ReadonlyMap<number, GowinTileType>
  /** the command records the vendor tool writes before / after the configuration frames. */
  commandHeader: readonly Uint8Array[]
  commandFooter: readonly Uint8Array[]
  /**
   * Per tile type, per LUT cell, the tile-local bit that carries each of the 16 truth-table entries:
   * `lutFlagBits.get(ttyp)?.get('LUT0')?.[5]` is the `[row, col]` holding truth-table entry 5.
   */
  lutFlagBits: ReadonlyMap<number, ReadonlyMap<string, readonly (readonly [number, number])[]>>
  /** the whole device's configuration bitmap size, summed from the tile grid. */
  bitmapRows: number
  bitmapCols: number
  /** per tile type, per attribute table (`CLS0`/`CLS1`/`CLS2`), the fuse entries that decode it. */
  clsFuses: ReadonlyMap<number, ReadonlyMap<string, readonly GowinFuseEntry[]>>
  /** attribute-value index -> `[attribute id, raw value]` (Apicula's reversed `logicinfo['SLICE']`). */
  logicinfoSlice: ReadonlyMap<number, readonly [number, number]>
  /** attribute id -> name, and raw value -> name. */
  attributeNames: ReadonlyMap<number, string>
  valueNames: ReadonlyMap<number, string>
}

/**
 * One row of an attribute fuse table. The key is a list of SIGNED attribute-value indices: a positive index
 * must have its bits programmed, a negative index must have them erased. Zero is padding and is ignored.
 */
export type GowinFuseEntry = {
  key: readonly number[]
  bits: readonly string[]
}

/** Where a tile's own bit window sits in the device bitmap. */
export type GowinTileWindow = {
  top: number
  left: number
  width: number
  height: number
}

/** How many of each kind of cell the whole fabric holds. */
export type GowinFabricInventory = {
  tiles: number
  luts: number
  flipFlops: number
  carryCells: number
  ioCells: number
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error(`Gowin chipdb: odd-length hex record "${hex}"`)
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    if (Number.isNaN(byte)) throw new Error(`Gowin chipdb: bad hex record "${hex}"`)
    out[i] = byte
  }
  return out
}

/**
 * Parse the converted Gowin device database.
 *
 * Refuses rather than guessing: a grid whose rows are ragged, a tile-type id the grid references but the tile
 * table does not define, or a malformed command record.
 */
export function parseGowinChipdb(text: string): GowinChipdb {
  const raw = JSON.parse(text) as {
    device: string
    idcode: string
    grid: number[][]
    center_row: number
    center_col: number
    tiles: Record<string, { width: number; height: number; bels: string[] | null; pips: number }>
    cmd_hdr: string[]
    cmd_ftr: string[]
    lut_flags?: Record<string, Record<string, Record<string, number[][]>>>
    cls_fuses?: Record<string, Record<string, Record<string, number[][]>>>
    logicinfo_slice?: Record<string, number[]>
    cls_attrids?: Record<string, number>
    cls_attrvals?: Record<string, number>
  }

  const grid = raw.grid
  if (!Array.isArray(grid) || grid.length === 0) throw new Error('Gowin chipdb has no tile grid')
  const cols = (grid[0] as number[]).length
  for (const row of grid)
    if (row.length !== cols)
      throw new Error(
        `Gowin chipdb grid is ragged: expected ${cols} columns, found a row of ${row.length}`,
      )

  const tileTypes = new Map<number, GowinTileType>()
  for (const [key, value] of Object.entries(raw.tiles)) {
    const ttyp = Number.parseInt(key, 10)
    tileTypes.set(ttyp, {
      ttyp,
      width: value.width,
      height: value.height,
      bels: value.bels ?? [],
      pipCount: value.pips,
    })
  }
  for (const row of grid)
    for (const ttyp of row)
      if (!tileTypes.has(ttyp))
        throw new Error(`Gowin chipdb grid references tile type ${ttyp}, which it does not define`)

  // The tiles must TILE — every grid row the same total width, every column the same total height, or the
  // cumulative offsets used to find a tile's bits would silently address the wrong bits.
  const rowWidths = new Set(
    grid.map((row) => row.reduce((sum, t) => sum + (tileTypes.get(t) as GowinTileType).width, 0)),
  )
  if (rowWidths.size !== 1)
    throw new Error(
      `Gowin chipdb tiles do not tile: grid rows have differing total widths (${[...rowWidths].join(', ')})`,
    )
  const colHeights = new Set(
    Array.from({ length: cols }, (_, col) =>
      grid.reduce(
        (sum, row) => sum + (tileTypes.get(row[col] as number) as GowinTileType).height,
        0,
      ),
    ),
  )
  if (colHeights.size !== 1)
    throw new Error(
      `Gowin chipdb tiles do not tile: grid columns have differing total heights (${[...colHeights].join(', ')})`,
    )

  const lutFlagBits = new Map<number, Map<string, (readonly [number, number])[]>>()
  for (const [ttypKey, bels] of Object.entries(raw.lut_flags ?? {})) {
    const perBel = new Map<string, (readonly [number, number])[]>()
    for (const [belName, flags] of Object.entries(bels)) {
      const bits: (readonly [number, number])[] = []
      for (const [flagKey, coords] of Object.entries(flags)) {
        // Each truth-table entry is carried by exactly one bit in this fabric; anything else means the shape
        // changed and the decode below would be wrong.
        if (coords.length !== 1)
          throw new Error(
            `Gowin chipdb: ${belName} truth-table entry ${flagKey} has ${coords.length} bits, expected 1`,
          )
        const [row, col] = coords[0] as number[]
        bits[Number.parseInt(flagKey, 10)] = [row as number, col as number]
      }
      if (bits.length !== 16)
        throw new Error(
          `Gowin chipdb: ${belName} has ${bits.length} truth-table entries, expected 16`,
        )
      perBel.set(belName, bits)
    }
    lutFlagBits.set(Number.parseInt(ttypKey, 10), perBel)
  }

  const clsFuses = new Map<number, Map<string, GowinFuseEntry[]>>()
  for (const [ttypKey, tables] of Object.entries(raw.cls_fuses ?? {})) {
    const perTable = new Map<string, GowinFuseEntry[]>()
    for (const [tableName, rows] of Object.entries(tables)) {
      const entries: GowinFuseEntry[] = []
      for (const [keyText, coords] of Object.entries(rows))
        entries.push({
          key: keyText.split(',').map((n) => Number.parseInt(n, 10)),
          bits: coords.map((c) => bitKey(c[0] as number, c[1] as number)),
        })
      perTable.set(tableName, entries)
    }
    clsFuses.set(Number.parseInt(ttypKey, 10), perTable)
  }

  const logicinfoSlice = new Map<number, readonly [number, number]>()
  for (const [index, pair] of Object.entries(raw.logicinfo_slice ?? {}))
    logicinfoSlice.set(Number.parseInt(index, 10), [pair[0] as number, pair[1] as number])

  const attributeNames = new Map<number, string>()
  for (const [name, id] of Object.entries(raw.cls_attrids ?? {})) attributeNames.set(id, name)
  const valueNames = new Map<number, string>()
  for (const [name, id] of Object.entries(raw.cls_attrvals ?? {})) valueNames.set(id, name)

  return {
    device: raw.device,
    idcode: Number.parseInt(raw.idcode, 16) >>> 0,
    grid,
    rows: grid.length,
    cols,
    centerRow: raw.center_row,
    centerCol: raw.center_col,
    tileTypes,
    commandHeader: raw.cmd_hdr.map(hexToBytes),
    commandFooter: raw.cmd_ftr.map(hexToBytes),
    lutFlagBits,
    bitmapRows: [...colHeights][0] as number,
    bitmapCols: [...rowWidths][0] as number,
    clsFuses,
    logicinfoSlice,
    attributeNames,
    valueNames,
  }
}

/** Bits are compared as `"row,col"` strings so set operations stay cheap and exact. */
const bitKey = (row: number, col: number): string => `${row},${col}`

const isSubset = (bits: readonly string[], of: ReadonlySet<string>): boolean =>
  bits.every((b) => of.has(b))

const isStrictSubset = (bits: readonly string[], of: readonly string[]): boolean => {
  if (bits.length >= of.length) return false
  const target = new Set(of)
  return bits.every((b) => target.has(b))
}

/**
 * Decode one attribute table out of a tile's bits — Apicula's `parse_attrvals`, transcribed.
 *
 * The table is not a simple lookup. Each row's key lists attribute-value indices that must be PROGRAMMED
 * (positive) or ERASED (negative), and three passes run over it:
 *
 *  1. rows whose bits are all programmed, keeping only the MAXIMAL matches — a row whose bits are a strict
 *     subset of another matching row loses, the same longest-match rule the ECP5 mux decode needed;
 *  2. rows keyed negatively whose bits ARE programmed, which contribute values but never override pass 1;
 *  3. rows keyed negatively whose bits are NOT programmed — this is where DEFAULTS come from, and it is why an
 *     erased tile still reports attributes rather than nothing.
 *
 * Values are returned raw (as indices into the value table), exactly as Apicula returns them.
 */
export function parseGowinAttrValues(
  tileBits: readonly (readonly boolean[])[],
  db: GowinChipdb,
  ttyp: number,
  table: string,
): Map<string, number> {
  const result = new Map<string, number>()
  const entries = db.clsFuses.get(ttyp)?.get(table)
  if (entries === undefined) return result

  const negativeKey = (key: readonly number[]): boolean => key.some((k) => k < 0)
  const positives = (key: readonly number[]): number[] => key.filter((k) => k > 0)
  const negatives = (key: readonly number[]): number[] =>
    key.filter((k) => k < 0).map((k) => Math.abs(k))

  const programmed = (bit: string): boolean => {
    const [row, col] = bit.split(',')
    return (tileBits[Number(row)] as readonly boolean[] | undefined)?.[Number(col)] === true
  }
  const setBits = new Set<string>()
  const negBits = new Set<string>()
  for (const entry of entries)
    for (const bit of entry.bits) {
      if (!programmed(bit)) continue
      if (negativeKey(entry.key)) negBits.add(bit)
      else setBits.add(bit)
    }

  const nameOf = (attributeId: number): string => db.attributeNames.get(attributeId) ?? ''
  const record = (index: number): void => {
    const pair = db.logicinfoSlice.get(index)
    if (pair === undefined) return
    result.set(nameOf(pair[0]), pair[1])
  }

  // pass 1 — positively keyed rows that fully match
  const matched = entries.filter((e) => !negativeKey(e.key) && isSubset(e.bits, setBits))
  const usedValues = new Set<number>()
  for (const entry of matched) {
    if (matched.some((other) => isStrictSubset(entry.bits, other.bits))) continue
    for (const index of positives(entry.key)) {
      usedValues.add(index)
      record(index)
    }
  }

  // pass 2 — negatively keyed rows whose bits ARE programmed
  const negMatched = entries.filter((e) => negativeKey(e.key) && isSubset(e.bits, negBits))
  const carried = new Set<number>()
  const ignored = new Set<number>()
  for (const entry of negMatched) {
    if (negMatched.some((other) => isStrictSubset(entry.bits, other.bits))) continue
    const clashes = entry.key.some((index) => {
      const pair = db.logicinfoSlice.get(Math.abs(index))
      return pair !== undefined && result.has(nameOf(pair[0]))
    })
    if (clashes) continue
    for (const index of positives(entry.key)) carried.add(index)
    for (const index of negatives(entry.key)) ignored.add(index)
  }
  for (const index of carried) record(index)

  // pass 3 — negatively keyed rows whose bits are NOT programmed: the defaults
  for (const entry of entries) {
    if (!negativeKey(entry.key) || isSubset(entry.bits, negBits)) continue
    const wanted = positives(entry.key)
    const keep = negatives(entry.key).every(
      (index) => !ignored.has(index) && wanted.every((w) => usedValues.has(w)),
    )
    if (!keep) continue
    for (const index of negatives(entry.key)) record(index)
  }
  return result
}

/**
 * The ten flip-flop variants a Gowin logic cell can be, keyed by
 * `REGSET | LSRONMUX | CLKMUX_CLK | SRMODE` — Apicula's `_dff_types`.
 *
 * `N` means the cell clocks on the FALLING edge; `R`/`S` are synchronous reset/set and `C`/`P` are asynchronous
 * clear/preset.
 */
const DFF_TYPES: ReadonlyMap<string, string> = new Map([
  ['RESET||SIG|', 'DFF'],
  ['RESET||INV|', 'DFFN'],
  ['RESET|LSRMUX|SIG|ASYNC', 'DFFC'],
  ['RESET|LSRMUX|INV|ASYNC', 'DFFNC'],
  ['RESET|LSRMUX|SIG|', 'DFFR'],
  ['RESET|LSRMUX|INV|', 'DFFNR'],
  ['SET|LSRMUX|SIG|ASYNC', 'DFFP'],
  ['SET|LSRMUX|INV|ASYNC', 'DFFNP'],
  ['SET|LSRMUX|SIG|', 'DFFS'],
  ['SET|LSRMUX|INV|', 'DFFNS'],
])

/**
 * Work out what kind of flip-flop each cell in a tile is configured as.
 *
 * Flip-flops carry no configuration bits of their own — a logic tile's `DFF*` cells have empty flag tables. The
 * mode lives in the tile-level `CLS` attribute tables, one per PAIR of cells (`CLS0` covers DFF0/DFF1), which is
 * why this reads a different table from the LUT decode.
 *
 * Returns null for a cell whose attribute combination is not a flip-flop at all (a memory or arithmetic mode),
 * rather than guessing at one.
 */
export function decodeGowinFlipFlops(
  tileBits: readonly (readonly boolean[])[],
  db: GowinChipdb,
  ttyp: number,
): Map<string, string | null> {
  const out = new Map<string, string | null>()
  if (!db.clsFuses.has(ttyp)) return out
  for (let index = 0; index < 6; index++) {
    const attributes = parseGowinAttrValues(tileBits, db, ttyp, `CLS${Math.floor(index / 2)}`)
    const named = (attribute: string, fallback: string): string => {
      const raw = attributes.get(attribute)
      if (raw === undefined) return fallback
      // A value with no name must NOT fall back to the default — that would let an unrecognised setting
      // masquerade as a plain flip-flop. Apicula returns None here and matches nothing; so do we.
      return db.valueNames.get(raw) ?? '<unnamed>'
    }
    const key = [
      named(`REG${index % 2}_REGSET`, 'SET'),
      named('LSRONMUX', ''),
      named('CLKMUX_CLK', 'SIG'),
      named('SRMODE', ''),
    ].join('|')
    out.set(`DFF${index}`, DFF_TYPES.get(key) ?? null)
  }
  return out
}

/**
 * Where a tile's bits live in the device bitmap. Apicula's `tile_bitmap` walks the grid accumulating widths
 * across and heights down, so a tile's window starts at the sum of everything above and to the left of it.
 */
export function gowinTileWindow(db: GowinChipdb, row: number, col: number): GowinTileWindow | null {
  if (row < 0 || col < 0 || row >= db.rows || col >= db.cols) return null
  let top = 0
  for (let r = 0; r < row; r++)
    top += (db.tileTypes.get((db.grid[r] as readonly number[])[0] as number) as GowinTileType)
      .height
  let left = 0
  const gridRow = db.grid[row] as readonly number[]
  for (let c = 0; c < col; c++)
    left += (db.tileTypes.get(gridRow[c] as number) as GowinTileType).width
  const tile = db.tileTypes.get(gridRow[col] as number) as GowinTileType
  return { top, left, width: tile.width, height: tile.height }
}

/**
 * Cut one tile's bits out of a device bitmap (the frame matrix a `.fs` parse returns).
 *
 * Refuses a bitmap whose size does not match the fabric, rather than reading whatever happens to be there — a
 * bitmap of the wrong device would otherwise decode into confident nonsense.
 */
export function extractGowinTileBits(
  bitmap: readonly (readonly boolean[])[],
  db: GowinChipdb,
  row: number,
  col: number,
): boolean[][] | null {
  if (bitmap.length !== db.bitmapRows)
    throw new Error(
      `Gowin bitmap has ${bitmap.length} rows but ${db.device} has ${db.bitmapRows} — wrong device?`,
    )
  const window = gowinTileWindow(db, row, col)
  if (window === null) return null
  const out: boolean[][] = []
  for (let r = 0; r < window.height; r++) {
    const source = bitmap[window.top + r] as readonly boolean[]
    if (source.length !== db.bitmapCols)
      throw new Error(
        `Gowin bitmap row ${window.top + r} has ${source.length} bits but ${db.device} frames are ${db.bitmapCols} wide`,
      )
    out.push(source.slice(window.left, window.left + window.width))
  }
  return out
}

/**
 * Decode the LUT truth tables in one tile.
 *
 * The convention is Apicula's, and it is INVERTED: a truth-table entry's bit being PROGRAMMED means that entry
 * outputs 0. `gowin_unpack` computes `INIT = 0xffff - sum(1 << f for f in set_flags)`, so an erased tile
 * (all bits zero) reads as `0xFFFF` — a LUT that outputs 1 for every input. Getting this backwards would invert
 * every gate on the chip while still looking like a plausible design, which is why it is stated here.
 *
 * Returns an empty map for tile types that hold no LUTs.
 */
export function decodeGowinLuts(
  tileBits: readonly (readonly boolean[])[],
  db: GowinChipdb,
  ttyp: number,
): Map<string, number> {
  const out = new Map<string, number>()
  const perBel = db.lutFlagBits.get(ttyp)
  if (perBel === undefined) return out
  for (const [belName, bits] of perBel) {
    let programmed = 0
    for (let flag = 0; flag < 16; flag++) {
      const [row, col] = bits[flag] as readonly [number, number]
      if ((tileBits[row] as readonly boolean[])[col] === true) programmed |= 1 << flag
    }
    out.set(belName, 0xffff & ~programmed)
  }
  return out
}

/** The tile at a grid position, or null if the position is off the fabric. */
export function gowinTileAt(db: GowinChipdb, row: number, col: number): GowinTileType | null {
  const gridRow = db.grid[row]
  if (gridRow === undefined) return null
  const ttyp = gridRow[col]
  if (ttyp === undefined) return null
  return db.tileTypes.get(ttyp) ?? null
}

/**
 * Count what the whole fabric holds, by walking the grid and summing each tile type's cells.
 *
 * This is a real cross-check rather than bookkeeping: for the GW1N-1 it yields 1152 LUT4s and 864 flip-flops,
 * which are the counts Gowin publishes for the part — geometry we derived independently agreeing with the
 * vendor's own datasheet.
 */
export function gowinFabricInventory(db: GowinChipdb): GowinFabricInventory {
  const inventory: GowinFabricInventory = {
    tiles: 0,
    luts: 0,
    flipFlops: 0,
    carryCells: 0,
    ioCells: 0,
  }
  for (const row of db.grid)
    for (const ttyp of row) {
      const tile = db.tileTypes.get(ttyp)
      if (tile === undefined) continue
      inventory.tiles++
      for (const bel of tile.bels) {
        if (/^LUT\d$/.test(bel)) inventory.luts++
        else if (/^DFF\d$/.test(bel)) inventory.flipFlops++
        else if (/^ALU\d$/.test(bel)) inventory.carryCells++
        else if (/^IOB[AB]$/.test(bel)) inventory.ioCells++
      }
    }
  return inventory
}

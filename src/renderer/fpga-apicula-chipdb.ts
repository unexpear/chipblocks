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
 * HONEST SCOPE. This reads the fabric INVENTORY — grid, tile types, tile sizes, bel names, and the vendor's own
 * header/footer command records. It does NOT yet decode a LUT's truth table or a flip-flop's mode from the frame
 * bits: that needs the per-tile bit tables (`shortval`/`longval`/`logicinfo`), which are a much larger slice and
 * the next step. Nothing here pretends to more than the inventory.
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
  }
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

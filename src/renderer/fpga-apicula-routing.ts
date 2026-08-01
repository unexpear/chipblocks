/**
 * FPGA fabric — Gowin (via Project Apicula): recover the ROUTING from a bitstream.
 *
 * A tile's configuration bits say more than what its logic cells compute — most of them steer the switches
 * ("pips") that decide which wire drives which. Without this a decoded design is a pile of disconnected gates.
 *
 * The rule is Apicula's, and it is EXACT-MATCH rather than subset: for one destination wire, take the union of
 * every candidate source's bits, keep the ones actually programmed, and a source drives the destination when its
 * own bit set equals that programmed set precisely. Requiring exact equality is what stops a source whose bits
 * are a subset of another's from claiming a connection it does not have.
 *
 * A source with an EMPTY bit set is the destination's default state. Apicula reports those when its `default`
 * flag is set; recovering a design's real wiring wants them suppressed, so `includeDefaults` chooses, and it
 * defaults to false because the netlist use is the one we have.
 *
 * Clock routing is kept separate, exactly as Apicula keeps it: the global clock spines are a different network
 * from general interconnect, and merging them would misrepresent the fabric.
 */

/** Bit coordinates are compared as `"row,col"` strings so set equality stays exact and cheap. */
export type GowinPipSources = ReadonlyMap<string, readonly string[]>

/** One tile type's switch tables: destination wire -> candidate source wire -> the bits that select it. */
export type GowinTilePips = {
  pips: ReadonlyMap<string, GowinPipSources>
  clockPips: ReadonlyMap<string, GowinPipSources>
}

/** The routing tables for every tile type of a device. */
export type GowinPipDatabase = ReadonlyMap<number, GowinTilePips>

/** What a tile's bits actually connect. */
export type GowinTileRouting = {
  /** destination wire -> the source wire driving it. */
  pips: Map<string, string>
  /** the same for the global clock network. */
  clockPips: Map<string, string>
}

function readTable(rows: Record<string, Record<string, number[][]>>): Map<string, GowinPipSources> {
  const table = new Map<string, GowinPipSources>()
  for (const [destination, sources] of Object.entries(rows)) {
    const bySource = new Map<string, readonly string[]>()
    for (const [source, coords] of Object.entries(sources))
      bySource.set(
        source,
        coords.map((c) => `${c[0]},${c[1]}`),
      )
    table.set(destination, bySource)
  }
  return table
}

/** Parse the converted routing tables. */
export function parseGowinPipDatabase(text: string): GowinPipDatabase {
  const raw = JSON.parse(text) as Record<
    string,
    {
      pips?: Record<string, Record<string, number[][]>>
      clock_pips?: Record<string, Record<string, number[][]>>
    }
  >
  const database = new Map<number, GowinTilePips>()
  for (const [ttyp, tables] of Object.entries(raw))
    database.set(Number.parseInt(ttyp, 10), {
      pips: readTable(tables.pips ?? {}),
      clockPips: readTable(tables.clock_pips ?? {}),
    })
  return database
}

function decodeTable(
  table: ReadonlyMap<string, GowinPipSources>,
  isProgrammed: (bit: string) => boolean,
  includeDefaults: boolean,
): Map<string, string> {
  const result = new Map<string, string>()
  for (const [destination, sources] of table) {
    const programmed = new Set<string>()
    for (const bits of sources.values())
      for (const bit of bits) if (isProgrammed(bit)) programmed.add(bit)
    for (const [source, bits] of sources) {
      if (bits.length === 0 && !includeDefaults) continue
      if (bits.length !== programmed.size) continue
      if (bits.every((bit) => programmed.has(bit))) result.set(destination, source)
    }
  }
  return result
}

/**
 * Work out what one tile's bits connect.
 *
 * `tileBits` is the tile's own window, as `extractGowinTileBits` cuts it from the device bitmap. Returns empty
 * maps for a tile type with no routing tables rather than inventing connections.
 */
export function decodeGowinRouting(
  tileBits: readonly (readonly boolean[])[],
  database: GowinPipDatabase,
  ttyp: number,
  options: { includeDefaults?: boolean } = {},
): GowinTileRouting {
  const tables = database.get(ttyp)
  if (tables === undefined) return { pips: new Map(), clockPips: new Map() }
  const includeDefaults = options.includeDefaults ?? false
  const isProgrammed = (bit: string): boolean => {
    const comma = bit.indexOf(',')
    const row = Number(bit.slice(0, comma))
    const col = Number(bit.slice(comma + 1))
    return (tileBits[row] as readonly boolean[] | undefined)?.[col] === true
  }
  return {
    pips: decodeTable(tables.pips, isProgrammed, includeDefaults),
    clockPips: decodeTable(tables.clockPips, isProgrammed, includeDefaults),
  }
}

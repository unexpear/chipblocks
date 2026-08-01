/**
 * FPGA fabric — Lattice Nexus: turn a tile-local wire name into one every tile agrees on.
 *
 * Routing names are written `<port>__<wire>`, e.g. `S3__V06S0003`. Neither half alone identifies a piece of
 * copper: the same `<wire>` is reused all over the chip, and a search of a real design found one used by six
 * tiles spread across dozens of columns. The pair TOGETHER does identify it, because the name encodes a
 * direction and a span:
 *
 *   `V06S0003` reached through port `S3` in tile R5C2   is the same wire as
 *   `V06S0003` reached through port `N3` in tile R11C2  — six rows away, matching the `06`.
 *
 * So a wire is named after the tile at its lower-coordinate end: a `S`/`E` port means this tile IS that end, and
 * a `N`/`W` port means the end is `span` tiles back. Two tiles then arrive at the same name for one wire.
 *
 * HONEST SCOPE: this covers the DIRECTIONAL routing wires. It does NOT cover the clock network — names like
 * `VPSX0400` and `HPBX0000` are reached through ports called `SPINE` and `BRANCH`, carry no span, and were seen
 * joining tiles that are neither the same row nor the same column. Those need the device's own node table, the
 * way the Gowin family's did, and are reported as unresolved rather than forced into this rule.
 */

/** A wire reference resolved to a name every tile that touches it will agree on. */
export type NexusWireRef = {
  /** the canonical name, `R<row>C<col>_<wire>`. */
  global: string
  /** the wire's own name, without the port. */
  wire: string
  /** the tile at the wire's lower-coordinate end. */
  row: number
  col: number
}

/** `<axis><span><direction><index>` — e.g. `V06S0003`, `H02W0101`. */
const DIRECTIONAL = /^([HV])(\d{2})([NSEW])(\d+)$/
/** A port naming a compass direction and an index, e.g. `S3`, `E3`. */
const PORT = /^([NSEW])(\d+)$/

/**
 * Resolve one `<port>__<wire>` reference seen in a given tile.
 *
 * Returns null when the reference is not a directional routing wire — a tile-local name with no `__`, or a clock
 * wire reached through a `SPINE`/`BRANCH` port. Returning null rather than guessing is deliberate: a clock net
 * forced through this rule would be placed on the wrong tile and silently join unrelated logic.
 */
export function nexusGlobalWire(row: number, col: number, reference: string): NexusWireRef | null {
  const mark = reference.indexOf('__')
  if (mark < 0) return null
  const port = PORT.exec(reference.slice(0, mark))
  if (port === null) return null
  const wire = reference.slice(mark + 2)
  const directional = DIRECTIONAL.exec(wire)
  if (directional === null) return null

  const span = Number.parseInt(directional[2] as string, 10)
  const side = port[1] as string
  // The wire is named after its lower-coordinate end. Reaching it through a north or west port means this tile
  // is the FAR end, so step back along the span to find where it starts.
  let rootRow = row
  let rootCol = col
  if (side === 'N') rootRow = row - span
  else if (side === 'W') rootCol = col - span

  return { global: `R${rootRow}C${rootCol}_${wire}`, wire, row: rootRow, col: rootCol }
}

/** Whether a reference is a clock-network wire — reached through a named port rather than a compass one. */
export function isNexusClockWire(reference: string): boolean {
  const mark = reference.indexOf('__')
  if (mark < 0) return false
  return PORT.exec(reference.slice(0, mark)) === null
}

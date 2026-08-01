/**
 * FPGA fabric — Gowin (via Project Apicula): map the fabric's edge tiles to PACKAGE PINS.
 *
 * A recovered design's inputs arrive at I/O blocks around the edge of the die. This says which physical pin of
 * which package each of those blocks is, so a decoded design can be described in terms a person holding the chip
 * would recognise — "this input comes in on pin 13" rather than "on wire R11C3_Q6".
 *
 * The database names an I/O block by SIDE, POSITION and BUFFER — `IOB3A` is the bottom edge, position 3,
 * buffer A. Position is a one-based tile coordinate along that edge, so the name resolves to a tile:
 *
 *   `IOT<n><X>`  top edge     -> row 0,          column n-1
 *   `IOB<n><X>`  bottom edge  -> row rows-1,     column n-1
 *   `IOL<n><X>`  left edge    -> row n-1,        column 0
 *   `IOR<n><X>`  right edge   -> row n-1,        column cols-1
 *
 * The same die is sold in several packages with different pin counts, so a pin number means nothing without
 * saying which package — hence every lookup here takes one.
 */

/** One I/O block: where it sits on the die, and which buffer of that tile it is. */
export type GowinIoLocation = {
  /** the block's database name, e.g. `IOB3A`. */
  name: string
  row: number
  col: number
  /** the buffer letter within the tile: `A`, `B`, ... */
  buffer: string
}

/** Package pin -> the I/O block it connects to, for one package. */
export type GowinPackagePins = ReadonlyMap<string, GowinIoLocation>

/** Every package the die is sold in. */
export type GowinPinout = ReadonlyMap<string, GowinPackagePins>

const IO_NAME = /^IO([TBLR])(\d+)([A-Z])$/

/**
 * Resolve an I/O block's database name to its tile.
 *
 * Returns null for a name that does not follow the side/position/buffer scheme, rather than guessing at a
 * position — a misplaced I/O block would attribute a design's signal to the wrong physical pin.
 */
export function gowinIoLocation(name: string, rows: number, cols: number): GowinIoLocation | null {
  const match = IO_NAME.exec(name)
  if (match === null) return null
  const side = match[1] as string
  const position = Number.parseInt(match[2] as string, 10) - 1
  const buffer = match[3] as string
  if (position < 0) return null

  if (side === 'T') return position < cols ? { name, row: 0, col: position, buffer } : null
  if (side === 'B') return position < cols ? { name, row: rows - 1, col: position, buffer } : null
  if (side === 'L') return position < rows ? { name, row: position, col: 0, buffer } : null
  return position < rows ? { name, row: position, col: cols - 1, buffer } : null
}

/** Parse the converted pinout: package -> pin number -> I/O block name. */
export function parseGowinPinout(text: string, rows: number, cols: number): GowinPinout {
  const raw = JSON.parse(text) as Record<string, Record<string, string>>
  const packages = new Map<string, Map<string, GowinIoLocation>>()
  for (const [packageName, pins] of Object.entries(raw)) {
    const byPin = new Map<string, GowinIoLocation>()
    for (const [pin, blockName] of Object.entries(pins)) {
      const location = gowinIoLocation(blockName, rows, cols)
      if (location !== null) byPin.set(pin, location)
    }
    packages.set(packageName, byPin)
  }
  return packages
}

/**
 * Which package pins land on a given edge tile.
 *
 * A tile carries several buffers, so this returns every pin on it. Sorted by buffer letter so the order is
 * stable rather than however the database happened to be written.
 */
export function gowinPinsAtTile(
  pins: GowinPackagePins,
  row: number,
  col: number,
): { pin: string; location: GowinIoLocation }[] {
  const found: { pin: string; location: GowinIoLocation }[] = []
  for (const [pin, location] of pins)
    if (location.row === row && location.col === col) found.push({ pin, location })
  return found.sort((a, b) => a.location.buffer.localeCompare(b.location.buffer))
}

/**
 * Describe where a recovered design's external signals physically enter the chip.
 *
 * Takes the wire names a trace dead-ended at (`primaryWires` from a reconstruction) and reports, for each, the
 * package pins on that wire's tile.
 *
 * HONEST LIMIT: a tile carries more than one buffer, and the wire name alone does not say WHICH — so this
 * narrows a signal to the pins of one I/O block, not to a single pin. Reporting the candidates is the truthful
 * form; picking one arbitrarily would look more precise while being right only by luck.
 */
export function gowinDesignPins(
  primaryWires: ReadonlyMap<number, string>,
  pins: GowinPackagePins,
): Map<number, { wire: string; candidates: string[] }> {
  const out = new Map<number, { wire: string; candidates: string[] }>()
  for (const [net, wire] of primaryWires) {
    const match = /^R(\d+)C(\d+)_/.exec(wire)
    if (match === null) continue
    const row = Number.parseInt(match[1] as string, 10) - 1
    const col = Number.parseInt(match[2] as string, 10) - 1
    const candidates = gowinPinsAtTile(pins, row, col).map((entry) => entry.pin)
    if (candidates.length > 0) out.set(net, { wire, candidates })
  }
  return out
}

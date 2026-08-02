/**
 * FPGA fabric — Lattice Nexus (via Project Oxide): read FASM, the format the toolchain speaks in both directions.
 *
 * Nexus is the fourth chip family here, and it arrives with an advantage the others did not have. Its packer
 * (`prjoxide`) both WRITES a bitstream from FASM and READS one back out to FASM, so a decoder's claims can be
 * checked against the vendor tool's own account of the same file — no need to reimplement its internals first.
 *
 * FASM is line-based text:
 *
 *   `{ oxide.device="LIFCL-40" }`                          a design attribute
 *   `R5C2__PLC.PIP.S3__V06S0003.JQ0`                       routing: in tile R5C2, S3__V06S0003 is driven by JQ0
 *   `CIB_R0C76__SYSIO_B0_0_ODD.PIOA.BASE_TYPE.INPUT_LVCMOS33`   configuration of a cell in a tile
 *
 * A tile name carries its own coordinates — `R<row>C<col>` — with an optional prefix naming the region and a
 * `__`-separated type. Those coordinates are what let a feature be placed on the die.
 *
 * HONEST SCOPE: this reads the STRUCTURE of a FASM file — attributes, routing arcs, and per-cell settings. It
 * does not interpret what a setting MEANS (that a lookup table's INIT is a truth table, say); that needs the
 * Oxide database and is a later step.
 */

/** One routing connection inside a tile: `destination` is driven by `source`. */
export type NexusPip = {
  destination: string
  source: string
}

/** One configuration setting: the dotted path within the tile, and the value it is set to. */
export type NexusFeature = {
  /** e.g. `PIOA.BASE_TYPE`, or `DCC_T0.DCCEN`. */
  path: string
  /** e.g. `INPUT_LVCMOS33`, `OFF`, `1`. */
  value: string
}

/**
 * A wide value written to a range of bits, e.g. `SLICEA.K0.INIT[15:0] = 16'b1111000000001111`.
 *
 * These are how a lookup table's truth table and a memory's contents are written, and they are a DIFFERENT line
 * shape from a plain setting — an `=` and a Verilog-style literal rather than a dotted value. Reading one as a
 * plain setting parses without complaint and yields a meaningless string, so they are separated here.
 */
export type NexusAssignment = {
  /** the dotted path, e.g. `SLICEA.K0.INIT`. */
  path: string
  /** the declared bit range, high first. */
  high: number
  low: number
  /**
   * The value as bits, least-significant first. Kept as bits because a memory's contents run to hundreds of
   * bits and a JS number silently loses everything past 53 of them — two 64-bit literals differing in the low
   * bit compared equal before this.
   */
  bits: boolean[]
  /** the value as a number, or null when it will not fit one exactly. */
  value: number | null
  /** the literal's own bit width. */
  width: number
  /** the literal's base character: `b`, `h`, `o` or `d`. */
  base: string
}

/** Everything a FASM file says about one tile. */
export type NexusTile = {
  /** the full tile name as written, e.g. `CIB_R0C76__SYSIO_B0_0_ODD`. */
  name: string
  row: number
  col: number
  /** the part after `__`, e.g. `PLC`, `SYSIO_B0_0_ODD`. */
  type: string
  pips: NexusPip[]
  features: NexusFeature[]
  assignments: NexusAssignment[]
}

/** A parsed FASM file. */
export type NexusFasm = {
  /** design attributes such as `oxide.device`. */
  attributes: Map<string, string>
  /** the device this design targets, e.g. `LIFCL-40`, or null if the file does not say. */
  device: string | null
  tiles: Map<string, NexusTile>
  /**
   * Settings that belong to the whole device rather than to any tile — bank supply voltages and the like,
   * written under a `GLOBAL` scope with no coordinates.
   */
  globals: NexusFeature[]
  /** lines that did not match any known shape, kept rather than dropped. */
  unrecognised: string[]
}

const ATTRIBUTE = /^\{\s*([\w.]+)\s*=\s*"?([^"}]*?)"?\s*\}$/
/** `<path>[<high>:<low>] = <width>'<base><digits>` — a wide value such as a lookup table's truth table. */
const ASSIGNMENT = /^(.+?)\[(\d+):(\d+)\]\s*=\s*(\d+)'([bhod])([0-9a-fA-F]+)$/

/**
 * A tile name: an optional region prefix, the coordinates, then the type.
 *
 * The separator is one OR two underscores, because the two halves of the toolchain do not agree: the router
 * writes `R15C0_PIOA` while the packer writes `CIB_R0C76__SYSIO_B0_0_ODD` for the same kind of thing. Accepting
 * only the doubled form silently drops a third of the router's output — which is how this was noticed.
 *
 * The prefix may itself contain underscores (`TAP_PLC_R5C14__TAP_PLC`), so the type is what follows the LAST
 * coordinate group. (This block previously sat above the wrong constant and justified the greedy match with a
 * claim about coordinate-shaped prefixes that no tile name in either fixture actually has.)
 */
const TILE_NAME = /^(.*R(\d+)C(\d+))_{1,2}(.+)$/

const BASE_RADIX: Record<string, number> = { b: 2, o: 8, d: 10, h: 16 }
const BASE_WIDTH: Record<string, number> = { b: 1, o: 3, h: 4 }

/**
 * A Verilog-style literal as bits, least-significant first.
 *
 * Kept as bits because a memory's initial contents run to hundreds of them and a JS number holds 53 — two
 * 64-bit literals differing only in the low bit compared equal before this. Decimal has no per-digit bit width
 * so it goes through a number, and is the one base that can still lose precision; no real FASM uses it.
 */
function literalBits(base: string, digits: string): boolean[] {
  const perDigit = BASE_WIDTH[base]
  const bits: boolean[] = []
  if (perDigit === undefined) {
    for (let n = Number.parseInt(digits, 10); n > 0; n = Math.floor(n / 2)) bits.push(n % 2 === 1)
    return bits
  }
  for (let index = digits.length - 1; index >= 0; index--) {
    const digit = Number.parseInt(digits[index] as string, BASE_RADIX[base] as number)
    for (let bit = 0; bit < perDigit; bit++) bits.push(((digit >> bit) & 1) === 1)
  }
  return bits
}

/** The literal as a number, or null when it is too wide to hold one exactly. */
function literalValue(base: string, digits: string): number | null {
  const value = Number.parseInt(digits, BASE_RADIX[base] as number)
  return Number.isSafeInteger(value) ? value : null
}

/**
 * Parse a FASM file.
 *
 * Lines that do not fit a known shape are collected in `unrecognised` rather than skipped. A silently ignored
 * line is indistinguishable from one that was understood, and this format has more shapes than the two common
 * ones — keeping the leftovers is what makes it possible to notice.
 */
export function parseNexusFasm(text: string): NexusFasm {
  const attributes = new Map<string, string>()
  const tiles = new Map<string, NexusTile>()
  const globals: NexusFeature[] = []
  const unrecognised: string[] = []

  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim()
    if (line === '') continue

    const attribute = ATTRIBUTE.exec(line)
    if (attribute !== null) {
      attributes.set(attribute[1] as string, attribute[2] as string)
      continue
    }

    // A feature line is `<tile>.<rest>`; the tile name itself contains no dots.
    const dot = line.indexOf('.')
    if (dot < 0) {
      unrecognised.push(line)
      continue
    }
    const tileName = line.slice(0, dot)
    const rest = line.slice(dot + 1)

    // Device-wide settings carry no coordinates. Only the exact `GLOBAL` scope is treated this way, so a line
    // that is merely unparseable still shows up as a leftover rather than being filed as a global.
    if (tileName === 'GLOBAL') {
      const cut = rest.lastIndexOf('.')
      if (cut < 0) unrecognised.push(line)
      else globals.push({ path: rest.slice(0, cut), value: rest.slice(cut + 1) })
      continue
    }

    const named = TILE_NAME.exec(tileName)
    if (named === null) {
      unrecognised.push(line)
      continue
    }

    let tile = tiles.get(tileName)
    if (tile === undefined) {
      tile = {
        name: tileName,
        row: Number.parseInt(named[2] as string, 10),
        col: Number.parseInt(named[3] as string, 10),
        type: named[4] as string,
        pips: [],
        features: [],
        assignments: [],
      }
      tiles.set(tileName, tile)
    }

    // A wide assignment must be recognised BEFORE the plain-setting path, which would otherwise swallow the
    // whole `INIT[15:0] = 16'b...` tail as if it were a value and lose the number inside it.
    const assignment = ASSIGNMENT.exec(rest)
    if (assignment !== null) {
      tile.assignments.push({
        path: (assignment[1] as string).trim(),
        high: Number.parseInt(assignment[2] as string, 10),
        low: Number.parseInt(assignment[3] as string, 10),
        width: Number.parseInt(assignment[4] as string, 10),
        base: assignment[5] as string,
        // Written most-significant first, as Verilog writes it, so reverse into bit order.
        bits: literalBits(assignment[5] as string, assignment[6] as string),
        value: literalValue(assignment[5] as string, assignment[6] as string),
      })
      continue
    }

    if (rest.startsWith('PIP.')) {
      // `PIP.<destination>.<source>` — both wire names may themselves contain dots is NOT the case here, but
      // they do contain `__`, so split on the LAST dot to keep a dotted destination intact if one appears.
      const arc = rest.slice(4)
      const split = arc.lastIndexOf('.')
      if (split < 0) {
        unrecognised.push(line)
        continue
      }
      tile.pips.push({ destination: arc.slice(0, split), source: arc.slice(split + 1) })
      continue
    }

    const split = rest.lastIndexOf('.')
    if (split < 0) {
      unrecognised.push(line)
      continue
    }
    tile.features.push({ path: rest.slice(0, split), value: rest.slice(split + 1) })
  }

  return {
    attributes,
    device: attributes.get('oxide.device') ?? null,
    tiles,
    globals,
    unrecognised,
  }
}

/** Every tile of a given type, in a stable order. */
export function nexusTilesOfType(fasm: NexusFasm, type: string): NexusTile[] {
  return [...fasm.tiles.values()]
    .filter((tile) => tile.type === type)
    .sort((a, b) => a.row - b.row || a.col - b.col)
}

/** Every configuration setting whose path ends with the given leaf, across the whole design. */
export function nexusFeaturesNamed(
  fasm: NexusFasm,
  leaf: string,
): { tile: NexusTile; feature: NexusFeature }[] {
  const found: { tile: NexusTile; feature: NexusFeature }[] = []
  for (const tile of fasm.tiles.values())
    for (const feature of tile.features)
      if (feature.path === leaf || feature.path.endsWith(`.${leaf}`)) found.push({ tile, feature })
  return found
}

/** Every wide assignment whose path ends with the given leaf, across the whole design. */
export function nexusAssignmentsNamed(
  fasm: NexusFasm,
  leaf: string,
): { tile: NexusTile; assignment: NexusAssignment }[] {
  const found: { tile: NexusTile; assignment: NexusAssignment }[] = []
  for (const tile of fasm.tiles.values())
    for (const assignment of tile.assignments)
      if (assignment.path === leaf || assignment.path.endsWith(`.${leaf}`))
        found.push({ tile, assignment })
  return found
}

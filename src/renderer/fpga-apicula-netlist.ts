/**
 * FPGA fabric — Gowin (via Project Apicula): assemble the decoded pieces into a NETLIST.
 *
 * The decoders next door each answer one question about a bitstream — what a lookup table computes, what kind of
 * flip-flop a cell is, which wire drives which. Individually they describe a pile of parts. This joins them into
 * a graph: which cell feeds which, and where a signal enters the chip from a pin.
 *
 * THE HARD PART IS WIRE NAMING. A tile calls its own wires by local names, and the SAME physical wire has a
 * different name in every tile it passes through — a wire called `N111` in one tile is the same copper as a
 * differently-named wire one tile north. Joining connections without reconciling those names produces a graph
 * that looks plausible and is wrong. Apicula reconciles them with `wire2global`, transcribed here as
 * `gowinGlobalWire`: an inter-tile wire is named after the tile it ORIGINATES in, so two tiles referring to one
 * piece of copper arrive at the same name.
 *
 * Output is the SAME `RecoveredNetlist` shape the iCE40 and ECP5 paths produce, so a Gowin design reaches the
 * shared simulator through the seam those families already proved.
 */

import { decodeGowinCarryCells, type GowinAttributeDatabase } from './fpga-apicula-attributes.ts'
import {
  decodeGowinFlipFlops,
  decodeGowinLuts,
  extractGowinTileBits,
  type GowinChipdb,
  gowinTileAt,
} from './fpga-apicula-chipdb.ts'
import { decodeGowinRouting, type GowinPipDatabase } from './fpga-apicula-routing.ts'
import type { CellRef, InputSource, RecoveredCell, RecoveredNetlist } from './fpga-icebox-run.ts'

const DIRECTIONS: Record<string, readonly [number, number]> = {
  N: [1, 0],
  E: [0, -1],
  S: [-1, 0],
  W: [0, 1],
}
const UTURN: Record<string, string> = { N: 'S', S: 'N', E: 'W', W: 'E' }

/**
 * Reconcile a tile-local wire name into one shared across every tile the wire touches — Apicula's `wire2global`.
 *
 * An inter-tile wire is named `<direction><number><segment>`, where the segment says how many tiles away the
 * wire STARTS. Walking that far in that direction gives the origin tile, and the wire is named after it. Wires
 * that would run off the edge of the die turn back on themselves, which is why a reflection is applied rather
 * than clamping — clamping would merge two distinct wires into one name.
 *
 * `row`/`col` are ONE-based here, matching Apicula's floorplanner convention.
 */
export function gowinGlobalWire(
  row: number,
  col: number,
  wire: string,
  rows: number,
  cols: number,
): string {
  if (wire === 'VCC' || wire === 'VSS') return wire
  const match = /^([NESW])([128]\d)(\d)/.exec(wire)
  if (match === null) return `R${row}C${col}_${wire}` // a wire local to this tile
  let direction = match[1] as string
  const number = match[2] as string
  const segment = Number.parseInt(match[3] as string, 10)

  const delta = DIRECTIONS[direction] as readonly [number, number]
  let rootRow = row + delta[0] * segment
  let rootCol = col + delta[1] * segment
  if (rootRow < 1) {
    rootRow = 1 - rootRow
    direction = UTURN[direction] as string
  }
  if (rootCol < 1) {
    rootCol = 1 - rootCol
    direction = UTURN[direction] as string
  }
  if (rootRow > rows) {
    rootRow = 2 * rows + 1 - rootRow
    direction = UTURN[direction] as string
  }
  if (rootCol > cols) {
    rootCol = 2 * cols + 1 - rootCol
    direction = UTURN[direction] as string
  }
  return `R${rootRow}C${rootCol}_${direction}${number}`
}

/**
 * Wire equivalences: one physical wire is named differently in each tile that can reach it, and the device
 * database records those groups. `gowinGlobalWire` reconciles the DIRECTIONAL wires by arithmetic; this table
 * covers the rest — chiefly the global clock network, where a clock hop is named `PCLKL1` in one tile, `SPINE16`
 * in another and `GT00` in a third. Without it a routed clock reads as several disconnected fragments.
 *
 * Apicula picks the SHORTEST name in a group as the canonical one, and so do we, so both agree on which name a
 * group collapses to.
 *
 * HONEST LIMIT: this does NOT join a cell's output wire (`F<n>`/`Q<n>`) as seen from a neighbouring tile. Those
 * names are absent from the table — checked, not assumed — so a lookup table's output referenced from the tile
 * next door still does not connect. That is what stands between here and naming a design's package pins.
 */
export function parseGowinWireAliases(text: string): Map<string, string> {
  const raw = JSON.parse(text) as Record<string, [number, number, string][]>
  const aliases = new Map<string, string>()
  for (const group of Object.values(raw)) {
    const sorted = [...group].sort((a, b) => a[2].length - b[2].length)
    let root: string | null = null
    for (const [row, col, wire] of sorted) {
      const name = `R${row + 1}C${col + 1}_${wire}`
      if (root === null) {
        root = name
        continue
      }
      aliases.set(name, root)
    }
  }
  return aliases
}

/** A lookup table recovered from a bitstream, with where it sits and what it computes. */
export type GowinLutCell = {
  ref: CellRef
  /** the tile position, ZERO-based as the grid stores it. */
  row: number
  col: number
  /** which lookup table within the tile: `LUT0`..`LUT7`. */
  bel: string
  /** the 16-entry truth table. */
  init: number
  /** whether a clock is routed to this cell, which is what makes its flip-flop real rather than merely present. */
  registered: boolean
  /** the flip-flop variant (`DFF`, `DFFN`, `DFFR`, ...) when registered, else null. */
  flipFlop: string | null
  /** whether the cell is switched into arithmetic (carry) mode rather than plain lookup-table mode. */
  carry: boolean
}

/**
 * How each Gowin flip-flop variant maps onto the shared cell's set/reset flags.
 *
 * `N` means a falling-edge clock, which the shared simulator does not model, so it is deliberately absent here
 * rather than silently treated as rising — see `GOWIN_FALLING_EDGE`.
 */
const FLIP_FLOP_FLAGS: ReadonlyMap<string, { setNoReset: boolean; asyncSetReset: boolean }> =
  new Map([
    ['DFF', { setNoReset: false, asyncSetReset: false }],
    ['DFFN', { setNoReset: false, asyncSetReset: false }],
    ['DFFR', { setNoReset: false, asyncSetReset: false }],
    ['DFFNR', { setNoReset: false, asyncSetReset: false }],
    ['DFFS', { setNoReset: true, asyncSetReset: false }],
    ['DFFNS', { setNoReset: true, asyncSetReset: false }],
    ['DFFC', { setNoReset: false, asyncSetReset: true }],
    ['DFFNC', { setNoReset: false, asyncSetReset: true }],
    ['DFFP', { setNoReset: true, asyncSetReset: true }],
    ['DFFNP', { setNoReset: true, asyncSetReset: true }],
  ])

/** The variants that clock on the FALLING edge — recorded because the shared simulator assumes rising. */
export const GOWIN_FALLING_EDGE: ReadonlySet<string> = new Set([
  'DFFN',
  'DFFNR',
  'DFFNS',
  'DFFNC',
  'DFFNP',
])

/** What a Gowin bitstream was found to contain. */
export type GowinDesign = {
  netlist: RecoveredNetlist
  cells: GowinLutCell[]
  /** global wire -> the global wire driving it, across the whole device. */
  drivers: Map<string, string>
  /**
   * The external wire each primary-input net stands for. A trace that ends at a wire with no driver has reached
   * something outside the recovered logic — an I/O buffer, or a cell kind this path does not model — so the wire
   * becomes a primary input. Naming it here is what keeps that honest: the design is not claimed to start from
   * nowhere, and a caller can see exactly which piece of copper each input is.
   */
  primaryWires: Map<number, string>
}

/** The four data inputs of a Gowin lookup table, in truth-table bit order. */
const LUT_PINS = ['A', 'B', 'C', 'D'] as const

/**
 * Whether a truth table's output actually changes with one of its inputs.
 *
 * A four-input cell used as a two-input gate leaves two pins doing nothing, and the fabric still routes SOMETHING
 * to them. Reporting those as chip inputs would invent signals the design does not have — the XNOR test design
 * has two real inputs and would otherwise claim four.
 */
function dependsOnInput(truth: readonly boolean[], pin: number): boolean {
  for (let entry = 0; entry < 16; entry++) {
    if (((entry >> pin) & 1) !== 0) continue
    if (truth[entry] !== truth[entry | (1 << pin)]) return true
  }
  return false
}

/**
 * Rebuild the logical netlist from a Gowin bitstream.
 *
 * Walks every tile, keeps the lookup tables that are not blank, and resolves each of their four inputs by
 * following the routing backwards through global wire names until it reaches another cell's output (`F<n>` for
 * a lookup table, `Q<n>` for a flip-flop) or runs out of routing.
 *
 * An input whose trace runs out becomes a primary input NAMED after the wire it stopped at, recorded in
 * `primaryWires`. Naming it is the point: an anonymous primary would let a decoding failure and a genuine chip
 * input look identical. One wire feeding several pins becomes ONE net, so fan-out survives the trace.
 */
export function reconstructGowinNetlist(
  frames: readonly (readonly boolean[])[],
  db: GowinChipdb,
  pipdb: GowinPipDatabase,
  attributes: GowinAttributeDatabase | null = null,
  aliases: ReadonlyMap<string, string> | null = null,
): GowinDesign {
  // Reconcile a tile-local name into the one every tile agrees on: first the arithmetic for directional wires,
  // then the database's equivalence groups. The alias walk is bounded — a malformed table could otherwise cycle.
  const globalWire = (row: number, col: number, wire: string): string => {
    let name = gowinGlobalWire(row, col, wire, db.rows, db.cols)
    for (let hop = 0; hop < 8 && aliases !== null; hop++) {
      const next = aliases.get(name)
      if (next === undefined || next === name) break
      name = next
    }
    return name
  }

  // 1. every routed connection, in global wire names
  const drivers = new Map<string, string>()
  for (let row = 0; row < db.rows; row++)
    for (let col = 0; col < db.cols; col++) {
      const tile = gowinTileAt(db, row, col)
      if (tile === null) continue
      const bits = extractGowinTileBits(frames, db, row, col)
      if (bits === null) continue
      const routing = decodeGowinRouting(bits, pipdb, tile.ttyp)
      for (const [destination, source] of [...routing.pips, ...routing.clockPips])
        drivers.set(globalWire(row + 1, col + 1, destination), globalWire(row + 1, col + 1, source))
    }

  // 2. every lookup table that is doing something, plus whether its flip-flop is clocked and whether the cell is
  //    switched into arithmetic mode
  const cells: GowinLutCell[] = []
  const cellByOutput = new Map<string, CellRef>()
  for (let row = 0; row < db.rows; row++)
    for (let col = 0; col < db.cols; col++) {
      const tile = gowinTileAt(db, row, col)
      if (tile === null) continue
      const bits = extractGowinTileBits(frames, db, row, col)
      if (bits === null) continue
      const luts = decodeGowinLuts(bits, db, tile.ttyp)
      if (luts.size === 0) continue
      const routing = decodeGowinRouting(bits, pipdb, tile.ttyp)
      const flipFlops = decodeGowinFlipFlops(bits, db, tile.ttyp)
      const carry = attributes === null ? [] : decodeGowinCarryCells(bits, attributes, tile.ttyp)
      for (const [bel, init] of luts) {
        if (init === 0xffff) continue // an erased lookup table is not part of the design
        const index = Number.parseInt(bel.slice(3), 10)
        const ref: CellRef = { x: col, y: row, cell: index }
        // A flip-flop's MODE decodes even on a blank tile (the fabric's default is a settable flip-flop), so the
        // mode alone is NOT evidence the register is used. A CLOCK being routed to the cell's pair is: an
        // unclocked flip-flop cannot hold anything. Pairs share a clock, matching the CLS tables.
        const clocked = routing.pips.has(`CLK${Math.floor(index / 2)}`)
        cells.push({
          ref,
          row,
          col,
          bel,
          init,
          registered: clocked,
          flipFlop: clocked ? (flipFlops.get(`DFF${index}`) ?? null) : null,
          carry: carry.includes(index),
        })
        cellByOutput.set(globalWire(row + 1, col + 1, `F${index}`), ref)
      }
    }

  // 3. resolve each input by following the routing backwards
  const primaryNets = new Map<string, number>()
  const primaryWires = new Map<number, string>()
  const recovered: RecoveredCell[] = []
  for (const cell of cells) {
    // Both fabrics index a 4-input truth table the same way — entry i is the output when the inputs spell out i
    // with input 0 as the least-significant bit — so the Gowin word maps straight onto the shared cell.
    const truth = Array.from({ length: 16 }, (_, entry) => ((cell.init >> entry) & 1) === 1)
    const index = Number.parseInt(cell.bel.slice(3), 10)

    // Resolve every pin FIRST, unmasked. The carry unit reads its operands directly, independently of what the
    // lookup table does with them, so masking must not reach it — the same trap the iCE40 path hit, where a
    // carry-only cell computed the wrong sum because its operands were masked away as don't-cares.
    const resolved: InputSource[] = []
    for (let pin = 0; pin < 4; pin++) {
      const start = globalWire(cell.row + 1, cell.col + 1, `${LUT_PINS[pin]}${index}`)
      resolved.push(traceInput(start, drivers, cellByOutput, primaryNets, primaryWires))
    }
    // A pin the truth table ignores is not an input to this design, whatever the fabric happens to route there.
    const inputs: InputSource[] = resolved.map((source, pin) =>
      dependsOnInput(truth, pin) ? source : { kind: 'unused' },
    )
    const flags = FLIP_FLOP_FLAGS.get(cell.flipFlop ?? '') ?? {
      setNoReset: false,
      asyncSetReset: false,
    }
    // A carry chain runs upward through a tile, so a carry cell takes its carry-in from the cell below it. Cell 0
    // starts the tile's chain and has none — cross-tile cascade is not recovered, and is reported by its absence
    // rather than invented.
    const previous = cells.find(
      (other) =>
        other.carry &&
        other.row === cell.row &&
        other.col === cell.col &&
        other.ref.cell === cell.ref.cell - 1,
    )
    recovered.push({
      ref: cell.ref,
      config: {
        truth,
        carryEnable: cell.carry,
        dffEnable: cell.registered,
        setNoReset: flags.setNoReset,
        asyncSetReset: flags.asyncSetReset,
      },
      inputs,
      ...(cell.carry
        ? {
            carryIn: previous === undefined ? null : previous.ref,
            carryOperands: [resolved[0] as InputSource, resolved[1] as InputSource] as [
              InputSource,
              InputSource,
            ],
          }
        : {}),
    })
  }

  // Only report inputs the design actually reads. A pin resolved and then masked away as a don't-care left a
  // primary behind, which would overstate how many signals enter the chip.
  const referenced = new Set<number>()
  for (const cell of recovered) {
    for (const input of cell.inputs) if (input.kind === 'primary') referenced.add(input.net)
    for (const operand of cell.carryOperands ?? [])
      if (operand.kind === 'primary') referenced.add(operand.net)
  }
  for (const net of [...primaryWires.keys()]) if (!referenced.has(net)) primaryWires.delete(net)

  return { netlist: { cells: recovered }, cells, drivers, primaryWires }
}

/**
 * Follow one input wire backwards until it reaches a cell output or runs out of routing.
 *
 * The walk remembers where it has been: Gowin routing legitimately contains loops through bidirectional
 * segments, so an unbounded walk would hang on a perfectly valid bitstream rather than on a malformed one.
 *
 * Ending at a wire with no driver means the signal comes from outside the logic this path models, so it becomes
 * a primary input named after that wire.
 */
function traceInput(
  start: string,
  drivers: ReadonlyMap<string, string>,
  cellByOutput: ReadonlyMap<string, CellRef>,
  primaryNets: Map<string, number>,
  primaryWires: Map<number, string>,
): InputSource {
  const seen = new Set<string>()
  let wire = start
  while (!seen.has(wire)) {
    seen.add(wire)
    const driver = cellByOutput.get(wire)
    if (driver !== undefined) return { kind: 'cell', driver, net: 0 }
    const next = drivers.get(wire)
    if (next === undefined) break
    wire = next
  }
  let net = primaryNets.get(wire)
  if (net === undefined) {
    net = primaryNets.size + 1
    primaryNets.set(wire, net)
    primaryWires.set(net, wire)
  }
  return { kind: 'primary', net }
}

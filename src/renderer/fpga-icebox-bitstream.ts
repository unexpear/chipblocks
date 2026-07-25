/**
 * FPGA fabric — Stage 2 (real iCE40), increment 4: the bitstream assembler — the join.
 * The full staging is FPGA-FABRIC-RESEARCH.md §5. Increment 2 turned a routed net into its routing CRAM bits
 * (fpga-icebox-rrg.ts `cramBitsForRoutedPips`) and increment 3 turned a logic cell's function into its logic
 * CRAM bits (fpga-icebox-logic.ts `lcCramBits`). This increment JOINS them: a design's placed logic cells ⊕
 * its routing become ONE combined CRAM bitstream, with conflict detection across every config bit. That is the
 * "design → bits" artifact — the same kind of engine-owned, never-guessed output as a board's manufacturing ZIP.
 *
 * A design here is `{ cells, routingPips }`: the logic cells already placed on real tiles (each an
 * `LcConfig` on a tile/cell) and the routing already chosen (the ON `IceboxPip`s, e.g. from routing a net on
 * an `rrgFromIcebox` graph and mapping the router's ON-pip ids back through `pipToIcebox`). `assembleBitstream`
 * emits every one of those bits at its real (tile, row, col) coordinate and reports any CRAM bit that two
 * sources — cell-vs-cell, cell-vs-routing, or routing-vs-routing — drive to different values (an illegal
 * bitstream), never silently letting one win.
 *
 * Honest scope: this ASSEMBLES a bitstream from an already-placed, already-routed design and checks it is
 * self-consistent; it does NOT do automatic place-and-route (assign a mapped netlist to real cells and route
 * them cell-to-cell) — that is the next increment, and the caller supplies the placement + routing here. It
 * also does not fill the many device bits a full bitstream carries beyond the design's own logic + routing
 * (IO, PLL, warm-boot, unused-tile defaults); a real `.bin` needs those too. What it emits, it emits exactly;
 * what it leaves out, it leaves out — there is no fabricated bit here.
 */

import { cramBitsForRoute, type IceboxPip, type ProgrammedBit } from './fpga-icebox.ts'
import { type LcConfig, type LogicTileBits, lcCramBits } from './fpga-icebox-logic.ts'

/** A logic cell placed on the device: its tile (x, y), its cell index within that logic tile, and its function. */
export type PlacedCell = { x: number; y: number; cell: number; config: LcConfig }

/** A placed + routed design: the logic cells to program and the routing switches (ON pips) to turn on. */
export type Design = {
  cells?: readonly PlacedCell[]
  /** the ON pips of the design's routing (e.g. the IceboxPips behind a RouteResult's onPips via pipToIcebox). */
  routingPips?: readonly IceboxPip[]
}

/** The assembled CRAM bitstream: one bit per (tile, row, col) with its value, plus any conflicts. */
export type Bitstream = {
  /** every config bit the design constrains, deduped by coordinate, each with its 0/1 value. */
  bits: ProgrammedBit[]
  /** `x_y_B<row>[<col>]` coordinates two sources drove to DIFFERENT values — an illegal bitstream (empty if legal). */
  conflicts: string[]
  /** how many of `bits` are 1 (the actually-programmed bits; the rest default to 0 in a real image). */
  setBits: number
}

const bitKey = (b: { x: number; y: number; row: number; col: number }): string =>
  `${b.x}_${b.y}_B${b.row}[${b.col}]`

/**
 * Assemble a design's combined CRAM bitstream: the logic-cell bits (`lcCramBits` for each placed cell) ⊕ the
 * routing bits (`cramBitsForRoute` over the ON pips), merged by coordinate. A coordinate two sources drive to
 * different values is reported in `conflicts` (along with any conflict the routing already had internally).
 */
export function assembleBitstream(layout: LogicTileBits, design: Design): Bitstream {
  const value = new Map<string, ProgrammedBit>()
  const conflicts = new Set<string>()
  const add = (bit: ProgrammedBit): void => {
    const key = bitKey(bit)
    const existing = value.get(key)
    if (existing === undefined) value.set(key, bit)
    else if (existing.value !== bit.value) conflicts.add(key)
  }

  for (const placed of design.cells ?? []) {
    for (const bit of lcCramBits(layout, placed.cell, placed.x, placed.y, placed.config)) add(bit)
  }
  const routed = cramBitsForRoute(design.routingPips ?? [])
  for (const bit of routed.bits) add(bit)
  for (const key of routed.conflicts) conflicts.add(key)

  const bits = [...value.values()]
  return { bits, conflicts: [...conflicts], setBits: bits.filter((b) => b.value === 1).length }
}

/**
 * Group a bitstream's SET bits (value === 1) by tile — the per-tile CRAM image a real programmer writes. The
 * key is `x_y`; a tile absent from the map programs no bits (all default 0).
 */
export function bitstreamByTile(bits: readonly ProgrammedBit[]): Map<string, ProgrammedBit[]> {
  const byTile = new Map<string, ProgrammedBit[]>()
  for (const bit of bits) {
    if (bit.value !== 1) continue
    const key = `${bit.x}_${bit.y}`
    const arr = byTile.get(key)
    if (arr) arr.push(bit)
    else byTile.set(key, [bit])
  }
  return byTile
}

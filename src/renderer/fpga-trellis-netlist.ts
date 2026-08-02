/**
 * FPGA fabric — ECP5 (Project Trellis): assemble the decoded tiles into a SIMULATABLE netlist.
 *
 * This is the ECP5 counterpart of iCE40's `reconstructNetlist`, and its whole point is that it produces the SAME
 * `RecoveredNetlist` the iCE40 path already produces — so an ECP5 bitstream flows into `simulateCombinational`,
 * `simulateClocked` and `lowerNetlistToCanvas` with no new simulator, no new canvas lowering, nothing duplicated.
 *
 * The mapping onto that shared model, read off the PLC2 database's own names:
 *   - a PLC2 tile holds EIGHT LUT4s, indexed k = 0..7 — SLICE A holds k 0,1; B holds 2,3; C holds 4,5; D holds 6,7
 *     (i.e. `SLICE<A+floor(k/2)>.K<k mod 2>`), which is exactly the tile's `F0..F7` / `Q0..Q7` numbering.
 *   - LUT k's four inputs are the tile's routed pins `A<k>`, `B<k>`, `C<k>`, `D<k>` (the `.mux` sinks); its LUT
 *     output is `F<k>` and its flip-flop output is `Q<k>`.
 *   - a tile named `R<row>C<col>` becomes `CellRef { x: col, y: row, cell: k }`, so cells keep the coordinates the
 *     device itself uses.
 *
 * An input pin resolves by asking the tile's mux what drives it. A source of `F<j>` or `Q<j>` is another LUT in the
 * same tile, so it becomes a `cell` source — and because our simulator already returns a registered cell's stored Q
 * as its output, `Q<j>` needs no special case. Anything else is a wire arriving from outside the tile and is
 * reported as a `primary` (never guessed at), with wire names interned to the numeric nets the shared model uses.
 *
 * Honest scope: connectivity is resolved WITHIN a tile. ECP5 routing between tiles travels on wires whose names
 * encode direction and span (`E1_H01E0001` and friends); following those across the fabric needs the global wire
 * model, which is not built yet — so a signal entering a tile from elsewhere is an honest primary input rather than
 * a wrong connection. A LUT's flip-flop is marked in use when something in the tile actually reads its `Q` output,
 * which is how an ECP5 design shows that the register (rather than the bare LUT) is the driver.
 */

import type { CellRef, InputSource, RecoveredCell, RecoveredNetlist } from './fpga-icebox-run.ts'
import {
  decodeEcp5Routing,
  decodeEcp5Slices,
  type Ecp5Tile,
  type Ecp5TileDb,
  globaliseEcp5Wire,
} from './fpga-trellis-tiles.ts'

/**
 * `R10C23` → `{ row: 10, col: 23 }`, or null for a tile whose name is not a grid position.
 *
 * The prefix is OPTIONAL and that matters: `CIB_R1C10`, `MIB_R2C3` and `TAP_R5C7` name the same grid position
 * as a bare `R1C10`. Matching only the bare form dropped every arc outside a logic tile — all 3,320 of the
 * connection-block arcs, which is 100% of that routing. Two lookup-table pins fed by one wire then resolved to
 * DIFFERENT nets, so the netlist described states the device cannot produce.
 */
function tilePosition(name: string): { row: number; col: number } | null {
  const match = /^(?:[A-Z0-9_]*_)?R(\d+)C(\d+)$/.exec(name)
  return match === null ? null : { row: Number(match[1]), col: Number(match[2]) }
}

/** What a reconstructed ECP5 design carries beyond the shared netlist. */
export type Ecp5Netlist = RecoveredNetlist & {
  /** cellKey → the tile + SLICE + LUT it came from, so a cell can be traced back to the device. */
  origin: Map<string, { tile: string; slice: string; lut: number }>
  /** net index → the wire name it stands for (an external wire arriving at a tile). */
  netNames: Map<number, string>
  /**
   * Cells whose recovered function is NOT to be trusted, with the reason.
   *
   * A slice in arithmetic mode does not compute its lookup table: the hardware output is that table combined
   * with the carry coming in, and the carry chain runs between cells. None of that is recovered — the mode is
   * noted and nothing else — so such a cell simulates as a plain lookup table and gets the wrong answer. On a
   * real 4-bit adder that is 256 of 512 input combinations on the first sum bit alone.
   *
   * Listing them is the honest stopgap. The alternative on offer was to model the chain by reusing the iCE40
   * carry formula, which is a DIFFERENT function — measured to disagree on 128 of 512 combinations — so it
   * would have replaced a visible wrong answer with a plausible one.
   */
  unfaithful: { ref: CellRef; reason: string }[]
}

/**
 * Reconstruct a simulatable netlist from a parsed ECP5 bitstream's frames. `dbFor` supplies each tile type's bit
 * database (return null for types you have not loaded — those tiles are skipped, never guessed at).
 */
export function reconstructEcp5Netlist(
  frames: readonly boolean[][],
  grid: Map<string, Ecp5Tile>,
  dbFor: (tileType: string) => Ecp5TileDb | null,
): Ecp5Netlist {
  const plc2 = dbFor('PLC2') as Ecp5TileDb
  const slices = decodeEcp5Slices(frames, grid, plc2)
  const arcs = decodeEcp5Routing(frames, grid, dbFor)

  // What drives each routed sink, resolved to GLOBAL wires so a connection can cross tile boundaries: the same
  // physical wire is named differently in each tile it touches, and `globaliseEcp5Wire` reconciles those names.
  const wireKey = (w: { x: number; y: number; name: string }): string => `${w.x}/${w.y}/${w.name}`
  const globalDriverOf = new Map<string, string>()
  for (const arc of arcs) {
    const position = tilePosition(arc.tile)
    if (position === null) continue
    const sink = globaliseEcp5Wire(position.row, position.col, arc.sink)
    const source = globaliseEcp5Wire(position.row, position.col, arc.source)
    if (sink === null || source === null) continue
    globalDriverOf.set(wireKey(sink), wireKey(source))
  }
  // Every LUT / flip-flop OUTPUT wire, as a global wire → the cell that drives it.
  const cellByOutput = new Map<string, { ref: CellRef; registered: boolean }>()
  for (const slice of slices) {
    const position = tilePosition(slice.tile)
    if (position === null) continue
    const sliceIndex = 'ABCD'.indexOf(slice.slice)
    if (sliceIndex < 0) continue
    for (let lut = 0; lut < 2; lut++) {
      const k = sliceIndex * 2 + lut
      const ref: CellRef = { x: position.col, y: position.row, cell: k }
      for (const [prefix, registered] of [
        ['F', false],
        ['Q', true],
      ] as const) {
        const wire = globaliseEcp5Wire(position.row, position.col, `${prefix}${k}`)
        if (wire !== null) cellByOutput.set(wireKey(wire), { ref, registered })
      }
    }
  }
  /** Follow a sink back through the routing until it reaches a cell output, or runs out of drivers. */
  const traceBack = (start: string): string => {
    let current = start
    const seen = new Set<string>([current])
    while (!cellByOutput.has(current)) {
      const next = globalDriverOf.get(current)
      if (next === undefined || seen.has(next)) break
      current = next
      seen.add(current)
    }
    return current
  }
  // Which LUT outputs are read through their FLIP-FLOP (`Q<k>`) rather than the bare LUT (`F<k>`).
  const registered = new Set<string>()
  for (const arc of arcs) {
    const match = /^Q(\d)$/.exec(arc.source)
    if (match !== null) registered.add(`${arc.tile}/${match[1]}`)
  }

  // External wires become numeric nets, interned by name so one wire is one net everywhere it appears.
  const netOf = new Map<string, number>()
  const netNames = new Map<number, string>()
  const internNet = (wire: string): number => {
    const existing = netOf.get(wire)
    if (existing !== undefined) return existing
    const net = netOf.size
    netOf.set(wire, net)
    netNames.set(net, wire)
    return net
  }

  const cells: RecoveredCell[] = []
  const unfaithful: { ref: CellRef; reason: string }[] = []
  const origin = new Map<string, { tile: string; slice: string; lut: number }>()
  for (const slice of slices) {
    const position = tilePosition(slice.tile)
    if (position === null) continue // not a grid tile — skip rather than invent coordinates
    const sliceIndex = 'ABCD'.indexOf(slice.slice)
    if (sliceIndex < 0) continue
    for (let lut = 0; lut < 2; lut++) {
      const truth = slice.luts[lut] as boolean[]
      if (truth.length !== 16) continue
      const k = sliceIndex * 2 + lut
      const ref: CellRef = { x: position.col, y: position.row, cell: k }
      const inputs: InputSource[] = ['A', 'B', 'C', 'D'].map((pin) => {
        const start = globaliseEcp5Wire(position.row, position.col, `${pin}${k}`)
        if (start === null) return { kind: 'unused' }
        const startKey = wireKey(start)
        if (!globalDriverOf.has(startKey) && !cellByOutput.has(startKey)) return { kind: 'unused' } // nothing is routed to this pin
        // follow the routing back across as many tiles as it takes
        const reached = traceBack(startKey)
        const cell = cellByOutput.get(reached)
        if (cell !== undefined) return { kind: 'cell', driver: cell.ref, net: internNet(reached) }
        // it left the fabric we can see (an IO / EBR / DSP tile, or a wire off the edge): an honest primary
        return { kind: 'primary', net: internNet(reached) }
      })

      // An all-ones lookup table is the database DEFAULT, so a slice can survive the tile-level filter on the
      // strength of its OTHER settings and still carry a companion table nobody programmed. Emitting it puts a
      // constant-1 cell in the netlist that exists nowhere in the design.
      //
      // EVERY conjunct below is load-bearing, and the suite will not tell you otherwise — it reports 46/46 with
      // a real cell deleted. Skipping on the table alone removes an all-ones LUT4 in an arithmetic slice, which
      // is exactly the configuration that passes the carry through. So a table is only untouched if it is also
      // unread, unregistered, and in a slice doing nothing arithmetic.
      const allOnes = truth.every((b) => b)
      const unread = inputs.every((i) => i.kind === 'unused')
      const isRegistered = registered.has(`${slice.tile}/${k}`)
      const plainMode = slice.mode === null || slice.mode === 'LOGIC'
      if (allOnes && unread && !isRegistered && plainMode) continue

      cells.push({
        ref,
        config: {
          truth,
          // The ECP5 database has no single "this LUT is registered" bit: a design shows it by reading the
          // flip-flop's Q output instead of the LUT's F output, which is what we detect above.
          // NOTE this flag is all we recover of arithmetic mode — see `unfaithful` below, which is where such a
          // cell is declared untrustworthy rather than quietly simulated as a plain lookup table.
          carryEnable: slice.mode === 'CCU2',
          dffEnable: registered.has(`${slice.tile}/${k}`),
          // `readTileEnum` reports a value EQUAL to the database's declared default as unset, and `SET` IS the
          // declared default for `REGSET`. So `=== 'SET'` could never be true and a preset flip-flop always
          // decoded as a reset one. Resolve an unset value to the database's own default instead of assuming
          // "not SET". (Inverting this line to `=== 'RESET'` left the whole suite green — nothing tested it.)
          setNoReset:
            (slice.regs[lut]?.regset ??
              plc2.enums.get(`SLICE${slice.slice}.REG${lut}.REGSET`)?.defaultValue ??
              null) === 'SET',
          asyncSetReset: false, // ECP5 set/reset timing comes from LSRMODE + the tile's clocking, not modelled yet
        },
        inputs,
      })
      if (slice.mode === 'CCU2')
        unfaithful.push({
          ref,
          reason:
            'arithmetic (CCU2) slice: the hardware output is the lookup table combined with the incoming carry, and neither the carry chain nor that combination is recovered',
        })
      origin.set(`${position.col}_${position.row}_${k}`, {
        tile: slice.tile,
        slice: slice.slice,
        lut,
      })
    }
  }
  return { cells, origin, netNames, unfaithful }
}

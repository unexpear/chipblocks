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
} from './fpga-trellis-tiles.ts'

/** `R10C23` → `{ row: 10, col: 23 }`, or null for a tile whose name is not a grid position. */
function tilePosition(name: string): { row: number; col: number } | null {
  const match = /^R(\d+)C(\d+)$/.exec(name)
  return match === null ? null : { row: Number(match[1]), col: Number(match[2]) }
}

/** `F3` / `Q3` → LUT index 3; anything else → null (a wire from outside the tile). */
function localDriver(source: string): number | null {
  const match = /^[FQ](\d)$/.exec(source)
  return match === null ? null : Number(match[1])
}

/** What a reconstructed ECP5 design carries beyond the shared netlist. */
export type Ecp5Netlist = RecoveredNetlist & {
  /** cellKey → the tile + SLICE + LUT it came from, so a cell can be traced back to the device. */
  origin: Map<string, { tile: string; slice: string; lut: number }>
  /** net index → the wire name it stands for (an external wire arriving at a tile). */
  netNames: Map<number, string>
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
  const slices = decodeEcp5Slices(frames, grid, dbFor('PLC2') as Ecp5TileDb)
  const arcs = decodeEcp5Routing(frames, grid, dbFor)

  // What drives each routed sink, per tile: "tile/sink" → source wire name.
  const driverOf = new Map<string, string>()
  for (const arc of arcs) driverOf.set(`${arc.tile}/${arc.sink}`, arc.source)
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
        const source = driverOf.get(`${slice.tile}/${pin}${k}`)
        if (source === undefined) return { kind: 'unused' }
        const driver = localDriver(source)
        if (driver !== null)
          return {
            kind: 'cell',
            driver: { x: position.col, y: position.row, cell: driver },
            net: internNet(`${slice.tile}/${source}`),
          }
        return { kind: 'primary', net: internNet(source) }
      })
      cells.push({
        ref,
        config: {
          truth,
          // The ECP5 database has no single "this LUT is registered" bit: a design shows it by reading the
          // flip-flop's Q output instead of the LUT's F output, which is what we detect above.
          carryEnable: slice.mode === 'CCU2',
          dffEnable: registered.has(`${slice.tile}/${k}`),
          setNoReset: slice.regs[lut]?.regset === 'SET',
          asyncSetReset: false, // ECP5 set/reset timing comes from LSRMODE + the tile's clocking, not modelled yet
        },
        inputs,
      })
      origin.set(`${position.col}_${position.row}_${k}`, {
        tile: slice.tile,
        slice: slice.slice,
        lut,
      })
    }
  }
  return { cells, origin, netNames }
}

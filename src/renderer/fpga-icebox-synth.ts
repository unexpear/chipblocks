/**
 * FPGA fabric — Stage 2 (real iCE40), increment 5: synthesize a placed design's bitstream.
 * The full staging is FPGA-FABRIC-RESEARCH.md §5. Increments 2–4 built the pieces — a real routing graph +
 * router (2), the logic-cell bit model (3), and the bitstream assembler (4). This joins them into the real
 * flow: a mapped LUT netlist (fpga-fabric.ts `coverToLuts`) placed on real iCE40 cells becomes a full design
 * bitstream. It BINDS each LUT to its real cell pins, ROUTES the internal nets cell-to-cell on the real graph,
 * and ASSEMBLES the logic + routing into one CRAM image.
 *
 * The binding is the new step: a LUT placed on cell C of tile (x,y) has its output on the real wire
 * `lutff_C/out` at (x,y) and reads input pin p on `lutff_C/in_p` (found by name in the device via
 * `buildWireIndex`). So a logical net — a driver LUT's output consumed by other LUTs' input pins — becomes a
 * `RouteNet` from the driver's real output wire to each consumer's real input wire, which the unchanged
 * PathFinder router (increment 2) threads through real pips. Each LUT's truth table is programmed onto its
 * cell (increment 3) and the whole thing assembled (increment 4), with the assembler's conflict check intact.
 *
 * Honest scope: the PLACEMENT is provided by the caller (which LUT goes on which real cell) — this does NOT
 * yet CHOOSE the placement (an automatic placer onto real cells, minimizing wirelength and guaranteeing
 * routability, is the next increment). Primary inputs and design outputs are left at the fabric edge (they are
 * not routed to IO pads — IO/clock/reset are not modeled), flip-flops default off (combinational LUTs), and
 * anything that fails to bind to a real wire is REPORTED in `unbound`, never invented. What routes, routes on
 * real pips; what encodes, encodes to real CRAM; a routing failure is an honest `routed: false`.
 */

import type { KLut } from './fpga-fabric.ts'
import type { IceboxDevice, IceboxPip } from './fpga-icebox.ts'
import { assembleBitstream, type Bitstream, type PlacedCell } from './fpga-icebox-bitstream.ts'
import { expandTruth, type LogicTileBits } from './fpga-icebox-logic.ts'
import { rrgFromIcebox, wireNodeId } from './fpga-icebox-rrg.ts'
import { type RouteNet, type RouteResult, type RouterOptions, routeDesign } from './fpga-router.ts'

/** Where each LUT (by its id) is placed on the device: a logic tile (x, y) and a cell index within it. */
export type Placement = Map<string, { x: number; y: number; cell: number }>

export type SynthResult = {
  /** the assembled logic + routing bitstream (with the assembler's cross-source conflict check). */
  bitstream: Bitstream
  /** true iff every internal net routed cell-to-cell with no overuse (a legal design). */
  routed: boolean
  route: RouteResult
  /** the internal nets the router was given (driver cell output → consumer cell input pins). */
  nets: RouteNet[]
  /** the logic cells placed (one per placed LUT), for the assembler. */
  cells: PlacedCell[]
  /** anything that could not bind to a real device wire — `cell:<lut>` (no placement), `out:<lut>` /
   *  `in:<lut>:<pin>` (no such `lutff` wire on that cell) — reported, never silently dropped. */
  unbound: string[]
}

/** A name→net-index lookup for a device: `"x_y_wirename" → net index`, over every wire's segments. */
export function buildWireIndex(device: IceboxDevice): Map<string, number> {
  const index = new Map<string, number>()
  for (const [netIndex, wire] of device.wires) {
    for (const seg of wire.segments) index.set(`${seg.x}_${seg.y}_${seg.name}`, netIndex)
  }
  return index
}

const combinational = (truth: boolean[]): PlacedCell['config'] => ({
  truth,
  carryEnable: false,
  dffEnable: false,
  setNoReset: false,
  asyncSetReset: false,
})

/**
 * Synthesize a placed LUT netlist into a real iCE40 bitstream: bind each LUT to its real cell pins, route the
 * internal nets cell-to-cell on the device's routing graph, and assemble the logic + routing CRAM bits.
 * `luts` is a mapped netlist (`coverToLuts` output); `placement` assigns each LUT id to a real cell.
 */
export function synthesizeBitstream(
  device: IceboxDevice,
  layout: LogicTileBits,
  luts: readonly KLut[],
  placement: Placement,
  routeOptions?: RouterOptions,
): SynthResult {
  const wireIndex = buildWireIndex(device)
  const at = (x: number, y: number, name: string): number | undefined =>
    wireIndex.get(`${x}_${y}_${name}`)
  const unbound: string[] = []

  // Place each LUT: program its cell. (Its output wire is looked up lazily below, only if it drives a net.)
  const cells: PlacedCell[] = []
  for (const lut of luts) {
    const place = placement.get(lut.id)
    if (place === undefined) {
      unbound.push(`cell:${lut.id}`)
      continue
    }
    cells.push({
      x: place.x,
      y: place.y,
      cell: place.cell,
      config: combinational(expandTruth(lut.config)),
    })
  }

  // For each driver LUT, collect the consumer input pins that read its output; if any, route from its real
  // output wire to them. A LUT with no placed consumer drives nothing internal, so its output wire is not
  // needed (a design output at the fabric edge) and is not flagged.
  const nets: RouteNet[] = []
  for (const driver of luts) {
    const driverPlace = placement.get(driver.id)
    if (driverPlace === undefined) continue
    const sinks: string[] = []
    for (const consumer of luts) {
      const place = placement.get(consumer.id)
      if (place === undefined) continue
      consumer.inputs.forEach((inputName, pin) => {
        if (inputName !== driver.output) return
        const inNet = at(place.x, place.y, `lutff_${place.cell}/in_${pin}`)
        if (inNet === undefined) unbound.push(`in:${consumer.id}:${pin}`)
        else sinks.push(wireNodeId(inNet))
      })
    }
    if (sinks.length === 0) continue
    const outNet = at(driverPlace.x, driverPlace.y, `lutff_${driverPlace.cell}/out`)
    if (outNet === undefined) {
      unbound.push(`out:${driver.id}`)
      continue
    }
    nets.push({ id: driver.output, source: wireNodeId(outNet), sinks })
  }

  // Route on the real device graph, then map the ON pips back to real switches for the assembler.
  const { rrg, pipToIcebox } = rrgFromIcebox(device)
  const route = routeDesign(rrg, nets, routeOptions)
  const routingPips: IceboxPip[] = []
  for (const id of route.onPips) {
    const pip = pipToIcebox.get(id)
    if (pip !== undefined) routingPips.push(pip)
  }

  const bitstream = assembleBitstream(layout, { cells, routingPips })
  return { bitstream, routed: route.routed, route, nets, cells, unbound }
}

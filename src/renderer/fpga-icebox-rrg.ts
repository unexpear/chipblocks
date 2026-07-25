/**
 * FPGA fabric — Stage 2 (real iCE40), increment 2: convert a parsed icebox device into the Stage-1
 * routing-resource graph, so the EXISTING PathFinder router (fpga-router.ts) runs unchanged on genuine iCE40
 * routing topology. The full staging is FPGA-FABRIC-RESEARCH.md §5. Increment 1 (fpga-icebox.ts) parsed the
 * real chipdb into wires (with spans) + switches (with CRAM bits); this module is the bridge that turns that
 * into an `Rrg` and closes the loop from real topology → a routed net → the real bitstream bits it programs.
 *
 * The mapping:
 *   - Each device wire → one `WireNode` (id `w<index>`, kind classified from the wire's segment names, the
 *     canonical tile = its first segment, `span` = its segment count — filling the Stage-1 span hook with the
 *     real segmentation). `classifyWire` scans ALL of a wire's segment names because ~36% of real nets carry
 *     more than one local name across the tiles they span (a cell output `lutff_2/out` also appears as
 *     `logic_op_tnr_2` / `neigh_op_*` in neighbour tiles' local views); a driver-pin name wins, so the wire
 *     classifies by its true role. Kinds resolve in priority order (a wire can carry several families of
 *     name): a cell/IO output pin → opin, then the chip-wide clock/reset network (glb_netwk, fabout, padin)
 *     → global, then a load pin → ipin, then a routing track by its DOMINANT orientation (more
 *     horizontal-named segments → chanx, else chany — a corner-wrapping span classifies by its majority),
 *     else tile-local interconnect (local_*, neigh_op_*, logic_op_*) or anything unrecognized → local.
 *   - Each `.buffer`/`.routing` switch → one directional `Pip` (`w<src>` → `w<dst>`) carrying its real CRAM
 *     `condition` as `configBits`. A reverse `pipToIcebox` map (pip id → the source `IceboxPip`, which keeps
 *     the switch's own tile) is the authoritative CRAM bridge: `cramBitsForRoutedPips` maps a router's ON-pip
 *     set back through it and feeds the genuine pips to the unmodified `cramBitsForRoute`.
 *
 * Honest scope: this ingests ROUTING TOPOLOGY ONLY. It does NOT model logic cells, placement, LUT-init, or
 * timing (all deferred): there is no notion of what a LUT computes or where a design is placed, so a routed
 * net here is a wire-to-wire path, not yet a logic connection, and delays are unmodeled (the chipdb carries no
 * timing — that lives in a separate icetime database). Two further honest limits: `.routing` pips are
 * ingested in their listed src→dst direction only (real pass-transistor switches conduct both ways — emitting
 * the reverse edge is a later refinement), and every node has the router's default capacity 1, so a real
 * multi-fanout net needs `RouterOptions.capacity` to avoid a false overuse. Pips whose src or dst wire has no
 * `.net` node are EXCLUDED and fully reported (never silently dropped), so ingesting a partial chipdb is
 * honest about exactly what it left out.
 */

import {
  cramBitsForRoute,
  type IceboxDevice,
  type IceboxPip,
  type IceboxWire,
  type ProgrammedBit,
} from './fpga-icebox.ts'
import { indexPips, type Pip, type Rrg, type WireKind, type WireNode } from './fpga-rrg.ts'

/** The RRG node id for a wire: its integer index rendered as `w<index>` (e.g. 79 → `w79`). */
export function wireNodeId(index: number): string {
  return `w${index}`
}

/**
 * Classify a wire's RRG kind from its segment names. A real net can carry several names across the tiles it
 * spans, so checks run in a priority order that resolves the wire to its truest role: a driver pin → opin
 * (so a carry net `lutff_7/cout` + `carry_in` classifies by its driver, not its load), then the chip-wide
 * global network → global (so a fabric-out that also aliases a global-control pin, `fabout` + `io_global/…`,
 * counts global not ipin), then a load pin → ipin, then a routing track by its DOMINANT orientation (more
 * horizontal-named segments ⇒ chanx, else chany — a corner-wrapping span classifies by its majority, not by
 * whichever end is seen first), else tile-local interconnect → local.
 */
function classifyKind(names: readonly string[]): WireKind {
  const any = (re: RegExp): boolean => names.some((n) => re.test(n))
  // Driver pins (a cell/IO output feeding routing) win first — so `lutff_2/out` also aliased as `logic_op_*`,
  // and the carry chain's `lutff_7/cout` also seen as `carry_in`, both classify by their driver role.
  if (any(/^lutff_\d+\/(out|lout|cout)$/) || any(/^io_\d+\/D_IN_\d+$/)) return 'opin'
  // The chip-wide global (clock/reset) network and its fabric/pad entry points — before the pin families so a
  // fabric-out that also aliases a global-control pin (`fabout` + `io_global/latch`) counts global, not ipin.
  if (any(/^glb_netwk_\d+$/) || any(/^fabout$/) || any(/^padin_\d+$/) || any(/^glb2local_\d+$/))
    return 'global'
  // Load pins: LUT/IO inputs, the shared global-control pins, and the carry-chain input.
  if (
    any(/^lutff_\d+\/in_\d+$/) ||
    any(/^io_\d+\/(D_OUT_\d+|OUT_ENB)$/) ||
    any(/^(lutff|io)_global\//) ||
    any(/^carry_in(_mux)?$/)
  )
    return 'ipin'
  // Segmented routing tracks: a corner-wrapping span carries both horizontal (…_h_…/…horz…) and vertical
  // (…_v_…/…vert…) names, so classify by the DOMINANT orientation rather than whichever is matched first.
  const horizontal = names.filter((n) => /_h_|horz/.test(n)).length
  const vertical = names.filter((n) => /_v_|vert/.test(n)).length
  if (horizontal > 0 || vertical > 0) return horizontal >= vertical ? 'chanx' : 'chany'
  // Tile-local interconnect (local_*, neigh_op_*, logic_op_*, slf_op_*) and anything unrecognized.
  return 'local'
}

/** Derive an RRG WireNode's kind, canonical tile (first segment), and span from a parsed icebox wire. */
export function classifyWire(wire: IceboxWire): {
  kind: WireKind
  x: number
  y: number
  span: number
} {
  const first = wire.segments[0]
  const names = wire.segments.length > 0 ? wire.segments.map((s) => s.name) : [wire.name]
  return { kind: classifyKind(names), x: first?.x ?? 0, y: first?.y ?? 0, span: wire.span }
}

type ExclusionReason = 'missing-src' | 'missing-dst' | 'missing-both'

/** The coverage/exclusion accounting `rrgFromIcebox` returns — every dropped pip counted and enumerated. */
export type IceboxRrgReport = {
  wiresTotal: number
  /** how many nodes landed in each WireKind. */
  nodesByKind: Record<WireKind, number>
  pipsTotal: number
  pipsIncluded: number
  pipsExcluded: number
  /** pips dropped because only the src / only the dst / BOTH endpoint wires lacked a `.net` node (sum = pipsExcluded). */
  excludedMissingSrc: number
  excludedMissingDst: number
  excludedMissingBoth: number
  excluded: { x: number; y: number; src: number; dst: number; reason: ExclusionReason }[]
}

/**
 * Build a routing-resource graph from a real iCE40 device. Returns the `rrg` (directly consumable by
 * `routeDesign`), the `pipToIcebox` reverse map (rrg pip id → its `IceboxPip`, for CRAM emission), and a
 * `report` accounting for every wire's kind and every excluded pip. A pip is excluded iff its src or dst wire
 * index has no `.net` entry in the device.
 */
export function rrgFromIcebox(device: IceboxDevice): {
  rrg: Rrg
  pipToIcebox: Map<string, IceboxPip>
  report: IceboxRrgReport
} {
  const nodes = new Map<string, WireNode>()
  const nodesByKind: Record<WireKind, number> = {
    source: 0,
    sink: 0,
    opin: 0,
    ipin: 0,
    chanx: 0,
    chany: 0,
    local: 0,
    global: 0,
  }
  for (const wire of device.wires.values()) {
    const { kind, x, y, span } = classifyWire(wire)
    nodes.set(wireNodeId(wire.index), { id: wireNodeId(wire.index), kind, x, y, span })
    nodesByKind[kind]++
  }

  const pips: Pip[] = []
  const pipToIcebox = new Map<string, IceboxPip>()
  const excluded: IceboxRrgReport['excluded'] = []
  let excludedMissingSrc = 0
  let excludedMissingDst = 0
  let excludedMissingBoth = 0
  for (const pip of device.pips) {
    const hasSrc = device.wires.has(pip.src)
    const hasDst = device.wires.has(pip.dst)
    if (!hasSrc || !hasDst) {
      const reason: ExclusionReason =
        !hasSrc && !hasDst ? 'missing-both' : !hasSrc ? 'missing-src' : 'missing-dst'
      if (reason === 'missing-both') excludedMissingBoth++
      else if (reason === 'missing-src') excludedMissingSrc++
      else excludedMissingDst++
      excluded.push({ x: pip.x, y: pip.y, src: pip.src, dst: pip.dst, reason })
      continue
    }
    const id = `ip${pips.length}`
    pips.push({
      id,
      from: wireNodeId(pip.src),
      to: wireNodeId(pip.dst),
      kind: pip.kind,
      configBits: pip.condition,
    })
    pipToIcebox.set(id, pip)
  }

  const { edgesFrom, edgesTo } = indexPips(pips)
  return {
    rrg: { nodes, pips, edgesFrom, edgesTo },
    pipToIcebox,
    report: {
      wiresTotal: device.wires.size,
      nodesByKind,
      pipsTotal: device.pips.length,
      pipsIncluded: pips.length,
      pipsExcluded: excluded.length,
      excludedMissingSrc,
      excludedMissingDst,
      excludedMissingBoth,
      excluded,
    },
  }
}

/**
 * The routed-design → real-CRAM bridge: map a router's ON-pip set (rrg pip ids from a `rrgFromIcebox` graph)
 * back to their genuine `IceboxPip`s via `pipToIcebox`, then feed those to the unmodified `cramBitsForRoute`.
 * `unknownPips` lists any ON-pip id absent from the map (should be empty for pips produced by this graph).
 */
export function cramBitsForRoutedPips(
  onPips: Iterable<string>,
  pipToIcebox: Map<string, IceboxPip>,
): { bits: ProgrammedBit[]; conflicts: string[]; unknownPips: string[] } {
  const iceboxPips: IceboxPip[] = []
  const unknownPips: string[] = []
  for (const id of onPips) {
    const pip = pipToIcebox.get(id)
    if (pip === undefined) unknownPips.push(id)
    else iceboxPips.push(pip)
  }
  const { bits, conflicts } = cramBitsForRoute(iceboxPips)
  return { bits, conflicts, unknownPips }
}

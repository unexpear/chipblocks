/**
 * TOP-LEVEL GATE NETLIST — the connectivity a placed floorplan needs to become a ROUTABLE, TIMEABLE design
 * (chip-physical chapter, signoff follow-up C1). def.ts places the cells; this recovers WHICH cell output
 * drives WHICH cell inputs, so the DEF NETS / PINS / SPECIALNETS sections stop being empty stubs and a tool
 * like OpenROAD can route + time the design instead of only inspecting the placement.
 *
 * It flattens the design to the SAME gate cells placeCells uses (the `isLogicGate` boundary) so the gate
 * node ids line up with the floorplan cells, then union-finds the flattened edges into nets (the shared
 * buildNets, as verilog.ts and the timing tracer do). Net-label teleports are honoured by merging nets that
 * carry the same label name (mirroring canvas-to-world.ts, which the block-level solver uses). Each net is
 * then classified:
 *   - a net on a gate VDD/VSS pin is a global power rail → a DEF SPECIALNETS wildcard, never enumerated;
 *   - a net carrying a named net-label is a top-level PIN (design I/O);
 *   - everything else is an internal SIGNAL net.
 * Pin names (A / B / Y) match lef.ts's MACRO pins exactly, so the DEF references resolve against read_lef.
 *
 * HONEST SCOPE: connectivity is recovered from the PHYSICAL gate wiring (buildNets over the flattened edges)
 * plus net-label teleports; there is no dedicated top-level I/O-pad part in the app, so a PIN is inferred
 * from a net-label and its direction from whether the net is driven by a gate output. Power is emitted as
 * the standard `* VDD` / `* VSS` wildcard (every primitive cell has those pins); a black-box cell without
 * power pins is the documented exception.
 */

import type { CanvasEdgeLike, CanvasNodeLike } from './blocks.ts'
import { flattenBlocks } from './blocks.ts'
import { isLogicGate } from './logic-sim.ts'
import { buildNets, handleOfEndpoint, nodeOfEndpoint } from './output-contention.ts'

/** The signal pins a gate exposes to routing — matching the LEF MACRO pin names (lef.ts). */
export type TopPin = 'A' | 'B' | 'Y'
/** One gate pin on a net. `instId` is the FLATTENED gate node id (= the PlacedCell id def.ts remaps). */
export type NetConnection = { instId: string; pin: TopPin }
export type PinDirection = 'INPUT' | 'OUTPUT' | 'INOUT'
export type SignalNet = {
  /** A DEF-unique net name (a sanitized net-label, else a synthesized n<i>). */
  name: string
  connections: NetConnection[]
  /** Present iff this net is a top-level I/O (it carries a named net-label). */
  pin?: { name: string; direction: PinDirection }
}
/** A gate signal pin hard-tied to a power/ground SYMBOL (the app's only tie-hi / tie-lo): it belongs on the
 *  matching SPECIALNETS rail, not on a floating signal net. */
export type TieConnection = { rail: 'VDD' | 'VSS'; instId: string; pin: TopPin }
export type TopNetlist = {
  signalNets: SignalNet[]
  /** Gate pins wired straight to a `power_source` + / `ground` symbol — constants, appended to the rails. */
  tieConnections: TieConnection[]
  /** Any placed gate ⇒ emit the VDD/VSS SPECIALNETS wildcards (every primitive cell has power pins). */
  hasCells: boolean
}

/** The two SPECIALNETS rail net names (def.ts). Reserved in the signal-net name allocator so a user
 *  net-label named "VDD"/"VSS" is uniquified away — DEF shares one net namespace across NETS + SPECIALNETS. */
const RESERVED_RAIL_NAMES = ['VDD', 'VSS']

/** Gate port handle → LEF/DEF pin. `a`/`in` → A, `b` → B, `out` → Y; the rails map to the power pins. The
 *  8 primitive gates use exactly these ids (≤2 inputs), so this reproduces lef.ts's inputs[0]→A ordering. */
const PIN_OF_HANDLE: Record<string, 'A' | 'B' | 'Y' | 'VDD' | 'VSS'> = {
  a: 'A',
  in: 'A',
  b: 'B',
  out: 'Y',
  v_dd: 'VDD',
  vdd: 'VDD',
  vcc: 'VDD',
  gnd: 'VSS',
  vss: 'VSS',
  vee: 'VSS',
}

/** Sanitize to a DEF identifier, keeping it unique within `used` (a numeric suffix on collision). */
function uniqueName(raw: string, used: Set<string>): string {
  const base = raw.replace(/[^A-Za-z0-9_]/g, '_') || 'net'
  let name = base
  let k = 1
  while (used.has(name)) {
    name = `${base}_${k}`
    k += 1
  }
  used.add(name)
  return name
}

/**
 * Extract the top-level gate netlist from the live canvas. Flattens to gates (matching placeCells), builds
 * nets over the flattened edges, merges net-label teleports, and classifies each net into signal / power /
 * tie / pin. Never throws; an empty or gate-free design yields empty nets + ties.
 */
export function extractTopNetlist(nodes: CanvasNodeLike[], edges: CanvasEdgeLike[]): TopNetlist {
  const flat = flattenBlocks(nodes, edges, isLogicGate)
  const gateIds = new Set(
    flat.nodes.filter((n) => n.data.block && isLogicGate(n.data.block)).map((n) => n.id),
  )
  if (gateIds.size === 0) return { signalNets: [], tieConnections: [], hasCells: false }

  // net-label node id → its (trimmed) teleport name; and every node's definition (to spot rail symbols).
  const labelName = new Map<string, string>()
  const defOf = new Map(flat.nodes.map((n) => [n.id, n.data.definition]))
  for (const n of flat.nodes) {
    if (n.data.definition !== 'net_label') continue
    const raw = n.data.parameters?.net_name?.value
    if (typeof raw === 'string' && raw.trim().length > 0) labelName.set(n.id, raw.trim())
  }

  const groups = buildNets(flat.edges).groups

  // Teleport merge: union group indices that share a net-label name (two same-named labels = one net),
  // exactly as canvas-to-world.ts collapses same-named labels for the solver.
  const parent = groups.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i] as number] as number
      i = parent[i] as number
    }
    return i
  }
  const firstGroupForName = new Map<string, number>()
  groups.forEach((group, gi) => {
    for (const endpoint of group) {
      const name = labelName.get(nodeOfEndpoint(endpoint))
      if (name === undefined) continue
      const prev = firstGroupForName.get(name)
      if (prev === undefined) firstGroupForName.set(name, gi)
      else parent[find(gi)] = find(prev)
    }
  })
  const merged = new Map<number, string[]>()
  groups.forEach((group, gi) => {
    const root = find(gi)
    const acc = merged.get(root)
    if (acc) acc.push(...group)
    else merged.set(root, [...group])
  })

  const signalNets: SignalNet[] = []
  const tieConnections: TieConnection[] = []
  // Reserve the rail names so a user net-label named "VDD"/"VSS" can't collide with the SPECIALNETS rails.
  const used = new Set<string>(RESERVED_RAIL_NAMES)
  let counter = 0
  for (const endpoints of merged.values()) {
    const connections: NetConnection[] = []
    let hasPower = false
    let rail: 'VDD' | 'VSS' | undefined // a power/ground SYMBOL on this net → its gate pins are constants
    const names: string[] = []
    for (const endpoint of endpoints) {
      const node = nodeOfEndpoint(endpoint)
      const handle = handleOfEndpoint(endpoint)
      const label = labelName.get(node)
      if (label !== undefined) names.push(label)
      const definition = defOf.get(node)
      if (definition === 'power_source' && handle === 'terminal_positive') rail = 'VDD'
      else if (definition === 'ground') rail = 'VSS'
      if (!gateIds.has(node)) continue
      const pin = PIN_OF_HANDLE[handle.toLowerCase()]
      if (pin === undefined) continue
      if (pin === 'VDD' || pin === 'VSS') hasPower = true
      else connections.push({ instId: node, pin })
    }
    // A net on a gate power pin is a global rail — the SPECIALNETS wildcard covers it; never enumerate it.
    if (hasPower) continue
    // A net tied to a power/ground SYMBOL: its gate pins are constants on that rail, appended to the matching
    // SPECIALNETS wildcard (the app's only tie-hi / tie-lo), not left as a floating signal net.
    if (rail !== undefined) {
      for (const c of connections) tieConnections.push({ rail, instId: c.instId, pin: c.pin })
      continue
    }
    if (connections.length === 0) continue // nothing routable on this net

    const labelledName = names.length > 0 ? names[0] : undefined
    const name = uniqueName(labelledName ?? `n${counter}`, used)
    counter += 1
    if (labelledName !== undefined) {
      const drivesOut = connections.some((c) => c.pin === 'Y')
      const takesIn = connections.some((c) => c.pin !== 'Y')
      const direction: PinDirection = drivesOut ? 'OUTPUT' : takesIn ? 'INPUT' : 'INOUT'
      signalNets.push({ name, connections, pin: { name, direction } })
    } else {
      signalNets.push({ name, connections })
    }
  }

  return { signalNets, tieConnections, hasCells: true }
}

/**
 * World → React Flow mapping (Sprint 18 S18-v3-3; wire-as-edge in S19-v3-9).
 *
 * PURE function — no React, no DOM, no Vite. Takes the same `World` shape the
 * cross-FK validator + solver use and produces React Flow nodes + edges. Kept
 * pure so the load-bearing catalog→canvas transform is unit-testable without a
 * DOM harness; the React rendering layer (App.tsx) is a thin shell over this.
 *
 * Wire-as-connector model (project lead): a wire is a connection, not a part.
 * So a `wire` instance is NOT a node — it collapses into a wire-EDGE between the
 * two components on its terminals' nets. Real components (battery, switch,
 * resistor, led, ground) are the nodes; every edge is a wire.
 */

import type { Instance, World } from '../cross-fk-validator.ts'

export type FlowNode = {
  id: string
  position: { x: number; y: number }
  data: {
    label: string
    definition: string
    parameters?: Instance['parameters']
    /** Set by the series-loop layout so a part faces its incoming wire. */
    rotation?: number
  }
}

export type FlowEdge = {
  id: string
  source: string
  target: string
  label: string
  /** Render the label chip on this edge? One per wire / once per net. */
  showLabel: boolean
  /**
   * How to read this wire's current from the solution:
   *  - 'wire': collapses a wire instance — use that instance's branch current.
   *  - 'net':  a direct net between components — use the net + terminals.
   */
  kind: 'wire' | 'net'
  /** Wire instance id (kind='wire') or net id (kind='net'). */
  ref: string
  /** Wire-edge only: is `source` on the wire's positive (terminal_a) side? */
  sourceOnPositiveSide: boolean
  /** Terminal (handle id) at each end — for rendering + the canvas→World re-solve. */
  sourceHandle: string
  targetHandle: string
  /** Hand-quality routing from the series-loop layout (orthogonal corners). */
  waypoints?: { id: string; x: number; y: number }[]
}

/** Terminal names on the positive / current-entry side (matches dc-solver). */
const POSITIVE_SIDE = new Set(['terminal_a', 'anode', 'terminal_positive', 'terminal_in'])

const isWire = (inst: Instance) => inst.definition === 'wire'
const isGround = (inst: Instance | undefined) => inst?.definition === 'ground'

/**
 * Map a World to React Flow nodes + edges.
 *
 * Nodes: one per circuit-participating component (non-wire instance with a
 * connection), in a deterministic grid (a richer layout lands later).
 *
 * Edges: every connection is a wire. A `wire` instance collapses into one edge
 * between the components on its two nets (current from the wire's branch). A net
 * that directly joins two+ components becomes a star of net-edges (current from
 * the net). A reference tap (ground) is a net-edge that carries no current.
 */
export function worldToFlow(world: World): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const components: Instance[] = []
  for (const inst of world.instances.values()) {
    if (inst.connects && inst.connects.length > 0 && !isWire(inst)) components.push(inst)
  }
  const componentIds = new Set(components.map((i) => i.id))

  const COLUMNS = 3
  const X_GAP = 220
  const Y_GAP = 140
  const nodes: FlowNode[] = components.map((inst, i) => ({
    id: inst.id,
    position: { x: (i % COLUMNS) * X_GAP, y: Math.floor(i / COLUMNS) * Y_GAP },
    data: { label: inst.id, definition: inst.definition, parameters: inst.parameters },
  }))
  const nodeById = new Map(nodes.map((n) => [n.id, n]))

  /** Component endpoint (instance + terminal) of a net, preferring non-ground. */
  const componentEndpoint = (netId: string): { instance: string; terminal: string } | undefined => {
    const members = world.nets.get(netId)?.members ?? []
    const comps = members.filter((m) => componentIds.has(m.instance))
    const chosen = comps.find((m) => !isGround(world.instances.get(m.instance))) ?? comps[0]
    return chosen ? { instance: chosen.instance, terminal: chosen.terminal } : undefined
  }

  const edges: FlowEdge[] = []

  // 1) Wire instances → one wire-edge each, between the components on its nets.
  for (const wire of world.instances.values()) {
    if (!isWire(wire) || !wire.connects || wire.connects.length < 2) continue
    const positive = wire.connects.find((c) => POSITIVE_SIDE.has(c.terminal)) ?? wire.connects[0]
    const negative = wire.connects.find((c) => c !== positive) ?? wire.connects[1]
    if (!positive || !negative) continue
    const source = componentEndpoint(positive.net)
    const target = componentEndpoint(negative.net)
    if (!source || !target || source.instance === target.instance) continue
    edges.push({
      id: `wire-${wire.id}`,
      source: source.instance,
      target: target.instance,
      sourceHandle: source.terminal,
      targetHandle: target.terminal,
      label: wire.id,
      showLabel: true,
      kind: 'wire',
      ref: wire.id,
      sourceOnPositiveSide: true,
    })
  }

  // 2) Direct nets (≥2 component members) → a star of net-edges among them.
  for (const net of world.nets.values()) {
    const comps = (net.members ?? []).filter((m) => componentIds.has(m.instance))
    if (comps.length < 2) continue
    const first = comps[0]
    if (first === undefined) continue
    let labelShown = false
    for (let i = 1; i < comps.length; i++) {
      const m = comps[i]
      if (m === undefined) continue
      edges.push({
        id: `net-${net.id}-${i}`,
        source: first.instance,
        target: m.instance,
        sourceHandle: first.terminal,
        targetHandle: m.terminal,
        label: net.id,
        showLabel: !labelShown,
        kind: 'net',
        ref: net.id,
        sourceOnPositiveSide: false,
      })
      labelShown = true
    }
  }

  layoutSeriesLoop(components, nodeById, edges)

  return { nodes, edges }
}

/** Part footprint + lane geometry for the series-loop layout (canvas px). */
const PART_W = 80
const HANDLE_Y = 22 // side terminals sit at the part's mid-height
const LANE_Y = 150 // the return wire's lane below the row
const LOOP_MARGIN = 40 // how far outside the row the loop's vertical runs sit

/**
 * Series-loop layout (S19-v3-71): when the circuit is one series loop (every
 * non-ground part touches exactly two wires), draw it the way a person does —
 * parts in WIRING order left to right, each rotated so the chain enters on
 * its left and leaves on its right (neighbor wires become short straight
 * runs), the loop-closing wire routed orthogonally around the outside on a
 * lane below, and ground tapped beneath the lane. The waypoints are authored
 * DATA, not an auto-router: a person chose this routing once, for the shape
 * every series loop shares. Anything that is not a series loop keeps the
 * plain grid and routes by hand on the canvas.
 */
function layoutSeriesLoop(
  components: Instance[],
  nodeById: Map<string, FlowNode>,
  edges: FlowEdge[],
): void {
  const chainComps = components.filter((c) => !isGround(c))
  if (chainComps.length < 2) return
  const groundIds = new Set(components.filter(isGround).map((c) => c.id))
  const circuitEdges = edges.filter((e) => !groundIds.has(e.source) && !groundIds.has(e.target))

  const touching = (id: string) => circuitEdges.filter((e) => e.source === id || e.target === id)
  if (chainComps.some((c) => touching(c.id).length !== 2)) return

  const handleAt = (edge: FlowEdge, id: string) =>
    edge.source === id ? edge.sourceHandle : edge.targetHandle
  const otherEnd = (edge: FlowEdge, id: string) => (edge.source === id ? edge.target : edge.source)

  // Walk the loop from the power source, leaving by its POSITIVE terminal —
  // the chain then runs the way the current does.
  const start = chainComps.find((c) => c.definition === 'power_source') ?? chainComps[0]
  if (start === undefined) return
  const startEdges = touching(start.id)
  const firstEdge =
    startEdges.find((e) => POSITIVE_SIDE.has(handleAt(e, start.id))) ?? startEdges[0]
  if (firstEdge === undefined) return

  const order: string[] = [start.id]
  const arrivedBy = new Map<string, FlowEdge>()
  const used = new Set<FlowEdge>([firstEdge])
  let cursor = otherEnd(firstEdge, start.id)
  arrivedBy.set(cursor, firstEdge)
  while (cursor !== start.id) {
    order.push(cursor)
    const next = touching(cursor).find((e) => !used.has(e))
    if (next === undefined) return // open chain end — not the loop shape
    used.add(next)
    const ahead = otherEnd(next, cursor)
    if (ahead !== start.id) arrivedBy.set(ahead, next)
    else arrivedBy.set(start.id, next) // the loop-closing wire, back into the source
    cursor = ahead
  }
  if (order.length !== chainComps.length) return // a side branch — not a series loop

  // The row: wiring order, left to right; a part whose incoming terminal
  // normally docks on its RIGHT is rotated 180° so it faces the chain.
  order.forEach((id, i) => {
    const node = nodeById.get(id)
    if (node === undefined) return
    node.position = { x: i * X_GAP_LOOP, y: 0 }
    const inbound = arrivedBy.get(id)
    const inTerminal = inbound === undefined ? undefined : handleAt(inbound, id)
    if (inTerminal !== undefined && !POSITIVE_SIDE.has(inTerminal)) {
      node.data.rotation = 180
    }
  })

  // The loop-closing wire goes AROUND the outside: right margin down, along
  // the lane, left margin up, into the first part.
  const closing = arrivedBy.get(start.id)
  const last = order[order.length - 1]
  if (closing === undefined || last === undefined) return
  const rightX = (order.length - 1) * X_GAP_LOOP + PART_W + LOOP_MARGIN
  const leftX = -LOOP_MARGIN
  const loop = [
    { id: 'loop_right_top', x: rightX, y: HANDLE_Y },
    { id: 'loop_right_lane', x: rightX, y: LANE_Y },
    { id: 'loop_left_lane', x: leftX, y: LANE_Y },
    { id: 'loop_left_top', x: leftX, y: HANDLE_Y },
  ]
  closing.waypoints = closing.source === last ? loop : [...loop].reverse()

  // Ground sits under the lane's left corner, its tap riding the margin up to
  // the terminal it references.
  let groundSlot = 0
  for (const edge of edges) {
    const groundId = groundIds.has(edge.source)
      ? edge.source
      : groundIds.has(edge.target)
        ? edge.target
        : undefined
    if (groundId === undefined) continue
    const node = nodeById.get(groundId)
    if (node === undefined) continue
    node.position = {
      x: leftX - PART_W / 2 - groundSlot * X_GAP_LOOP,
      y: LANE_Y + 30,
    }
    groundSlot += 1
    edge.waypoints = [{ id: `ground_tap_${groundId}`, x: leftX, y: HANDLE_Y }]
  }
}

const X_GAP_LOOP = 220

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
  data: { label: string; definition: string; parameters?: Instance['parameters'] }
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

  /** Component members of a net, preferring non-ground (ground is a tap, not a path end). */
  const componentEndpoint = (netId: string): string | undefined => {
    const members = world.nets.get(netId)?.members ?? []
    const comps = members.filter((m) => componentIds.has(m.instance))
    const nonGround = comps.find((m) => !isGround(world.instances.get(m.instance)))
    return (nonGround ?? comps[0])?.instance
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
    if (!source || !target || source === target) continue
    edges.push({
      id: `wire-${wire.id}`,
      source,
      target,
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
        label: net.id,
        showLabel: !labelShown,
        kind: 'net',
        ref: net.id,
        sourceOnPositiveSide: false,
      })
      labelShown = true
    }
  }

  return { nodes, edges }
}

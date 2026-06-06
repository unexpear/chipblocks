/**
 * World → React Flow mapping (Sprint 18 S18-v3-3).
 *
 * PURE function — no React, no DOM, no Vite. Takes the same `World` shape the
 * cross-FK validator + solver use and produces React Flow nodes + edges. Kept
 * pure so the load-bearing catalog→canvas transform is unit-testable without a
 * DOM harness; the React rendering layer (App.tsx) is a thin shell over this.
 */

import type { Instance, World } from '../cross-fk-validator.ts'

export type FlowNode = {
  id: string
  position: { x: number; y: number }
  data: { label: string; definition: string }
}

export type FlowEdge = {
  id: string
  source: string
  target: string
  label: string
  /**
   * Render the net-id label on this edge? A net's star produces N-1 edges that
   * all carry the same `label` (the net id, kept for identity/testing), but the
   * canvas shows it on only the first — otherwise a 3+ member net repeats its
   * name on every spoke (the `net_battery_neg` ×2 clutter). True on the first
   * drawn edge of each net, false on the rest.
   */
  showLabel: boolean
}

/** Instances that participate in the circuit (have at least one connection). */
function circuitInstances(world: World): Instance[] {
  const list: Instance[] = []
  for (const inst of world.instances.values()) {
    if (inst.connects && inst.connects.length > 0) list.push(inst)
  }
  return list
}

/**
 * Map a World to React Flow nodes + edges.
 *
 * Nodes: one per circuit-participating instance (laid out in a deterministic
 * grid so the result is stable + testable; a richer layout lands with the
 * symbols/interactivity sprints).
 *
 * Edges: each net becomes a star from its first member to every other member
 * — a single edge for a 2-member net, N-1 edges for an N-member net. The edge
 * is labeled with the net id. This renders the connectivity without needing a
 * separate net-junction node.
 */
export function worldToFlow(world: World): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const instances = circuitInstances(world)
  const present = new Set(instances.map((i) => i.id))

  const COLUMNS = 3
  const X_GAP = 220
  const Y_GAP = 140
  const nodes: FlowNode[] = instances.map((inst, i) => ({
    id: inst.id,
    position: { x: (i % COLUMNS) * X_GAP, y: Math.floor(i / COLUMNS) * Y_GAP },
    data: { label: inst.id, definition: inst.definition },
  }))

  const edges: FlowEdge[] = []
  for (const net of world.nets.values()) {
    if (net.members.length < 2) continue
    const first = net.members[0]
    if (first === undefined || !present.has(first.instance)) continue
    let labelShown = false
    for (let i = 1; i < net.members.length; i++) {
      const m = net.members[i]
      if (m === undefined || !present.has(m.instance)) continue
      edges.push({
        id: `${net.id}-${i}`,
        source: first.instance,
        target: m.instance,
        label: net.id,
        showLabel: !labelShown,
      })
      labelShown = true
    }
  }

  return { nodes, edges }
}

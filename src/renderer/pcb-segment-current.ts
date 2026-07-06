import type { Point } from './net-edge.tsx'

/**
 * The current each SEGMENT of a net's routed copper carries — so the over-current DRC checks a thin
 * branch trace against the small load IT feeds, not the whole net's trunk current.
 *
 * A routed net is (almost always) a TREE: one source pad drives the current, the rest are loads, and
 * the copper is a spanning tree with no redundant loops. Root the tree at the source (the pad carrying
 * the most current — by KCL it carries the sum of all the loads), and the current in the edge above a
 * node is the summed load current of the subtree hanging below it: the trunk near the source carries
 * every load; a branch to one load carries only that load.
 *
 * Vias don't need to be modelled explicitly: a plated via joins the layers at ONE point, so a trace
 * ending there on the top and another starting there on the bottom share the same (x, y) graph node —
 * the join is implicit. (Same-point same-net copper on two layers with NO via is an OPEN, which the
 * open-net DRC catches; it never occurs on a valid board.)
 *
 * If the net's copper is NOT a tree (it has a redundant loop, so the split isn't determined by
 * topology alone) the segment currents fall back to `netMax` — the conservative whole-net value the
 * check used before. Same fallback for an empty / disconnected net.
 */
export function netSegmentCurrents(
  traces: readonly { points: readonly Point[] }[],
  pads: readonly { at: Point; current: number }[],
  netMax: number,
): number[][] {
  const key = (p: Point) => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`
  const adjacency = new Map<string, Set<string>>()
  const ensure = (k: string) => {
    if (!adjacency.has(k)) adjacency.set(k, new Set())
  }
  const edges: { traceIndex: number; segment: number; a: string; b: string }[] = []
  traces.forEach((t, traceIndex) => {
    for (let i = 0; i + 1 < t.points.length; i++) {
      const from = t.points[i]
      const to = t.points[i + 1]
      if (from === undefined || to === undefined) continue
      const a = key(from)
      const b = key(to)
      ensure(a)
      ensure(b)
      if (a === b) continue // a zero-length segment carries nothing distinct
      adjacency.get(a)?.add(b)
      adjacency.get(b)?.add(a)
      edges.push({ traceIndex, segment: i, a, b })
    }
  })

  const perSegment = (): number[][] =>
    traces.map((t) => new Array(Math.max(0, t.points.length - 1)).fill(0))
  const fallback = (): number[][] =>
    traces.map((t) => new Array(Math.max(0, t.points.length - 1)).fill(netMax))

  const nodeCount = adjacency.size
  if (nodeCount === 0 || edges.length !== nodeCount - 1) return fallback() // not a spanning tree

  const nodeCurrent = new Map<string, number>()
  for (const pad of pads) {
    const k = key(pad.at)
    ensure(k)
    nodeCurrent.set(k, (nodeCurrent.get(k) ?? 0) + Math.abs(pad.current))
  }
  // A pad landing OFF the copper graph (its node isn't in the tree) means the net isn't the clean tree
  // we can reason about — fall back rather than mis-attribute its current.
  if (adjacency.size !== nodeCount) return fallback()

  // Root at the source: the node carrying the most current (it drives the whole net).
  let root: string | undefined
  let maxCurrent = -1
  for (const [k, current] of nodeCurrent) {
    if (current > maxCurrent) {
      maxCurrent = current
      root = k
    }
  }
  if (root === undefined) return fallback() // no currents at all

  // DFS from the root; a stack walk gives a parent for every node (and detects that it's connected).
  const parent = new Map<string, string>()
  const order: string[] = []
  const visited = new Set<string>([root])
  const stack = [root]
  while (stack.length > 0) {
    const u = stack.pop() as string
    order.push(u)
    for (const v of adjacency.get(u) ?? []) {
      if (visited.has(v)) continue
      visited.add(v)
      parent.set(v, u)
      stack.push(v)
    }
  }
  if (visited.size !== nodeCount) return fallback() // disconnected — not one tree

  // Subtree load current, bottom-up: a node's own load plus its children's subtrees. The root's own
  // current is the source (it collects the loads), so it is never part of any edge below it.
  const subtree = new Map<string, number>()
  for (let i = order.length - 1; i >= 0; i--) {
    const u = order[i] as string
    let sum = nodeCurrent.get(u) ?? 0
    for (const v of adjacency.get(u) ?? []) {
      if (parent.get(v) === u) sum += subtree.get(v) ?? 0
    }
    subtree.set(u, sum)
  }

  const out = perSegment()
  for (const e of edges) {
    // the deeper endpoint (the child) carries its whole subtree through this edge
    const child = parent.get(e.a) === e.b ? e.a : parent.get(e.b) === e.a ? e.b : undefined
    const row = out[e.traceIndex]
    if (row !== undefined)
      row[e.segment] = child !== undefined ? (subtree.get(child) ?? netMax) : netMax
  }
  return out
}

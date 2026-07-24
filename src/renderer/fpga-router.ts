/**
 * FPGA fabric — Stage 1 (the abstract "mini-VPR"), Engine #2: the PathFinder router.
 * The full staging is FPGA-FABRIC-RESEARCH.md Appendix A. This is the second genuinely-new engine (after
 * the LUT-covering mapper): it turns a set of logical nets into a set of ON pips on the routing-resource
 * graph (fpga-rrg.ts) that fpga-sim.ts's bridgeToSim then simulates — so a design goes place → ROUTE → sim
 * with no hand-chosen pips.
 *
 * The algorithm is McMurchie & Ebeling's PathFinder (1995), the negotiated-congestion router VPR/nextpnr
 * are built on. A routing resource (an RRG node — a track, a pin) has a finite capacity (a wire carries one
 * net). Nets are routed one at a time by a min-cost maze search (Dijkstra over the pips), but the cost of a
 * node rises with how many OTHER nets currently want it, so nets negotiate:
 *
 *   cost(n) = ( base(n) + history(n) ) · present(n)
 *   present(n) = 1                                  while n has spare capacity
 *              = 1 + (occupancy(n)+1 − capacity(n))·pfac   once it would overuse n
 *
 * Each outer iteration rips up and re-routes every net against the current costs; nodes that stay overused
 * accumulate `history` (a permanent penalty) and `pfac` grows, so persistently-contested resources become
 * expensive enough that some net detours. It terminates when every net reached all its sinks with no node
 * overused (a legal, congestion-free routing). If it cannot within `maxIterations`, it fails honestly and
 * names WHY: `overused` lists the contended nodes it could not decongest, and `unroutable` lists any net
 * whose sink was simply unreachable on this fabric — never a bare `routed:false` with no diagnostic.
 *
 * Router-independent by construction on the sim side: the output is exactly the ON-pip set bridgeToSim
 * already consumes, so the hand-traced routes in fpga-sim's tests and this engine's routes are interchangeable.
 *
 * Capacity model: EVERY routing resource — track, pin, and the `sink` aggregator alike — has capacity 1,
 * because bridgeToSim unions the endpoints of every ON pip, so ANY node shared by two nets shorts them
 * regardless of a nominal capacity ≥ 2. A tile's loads are therefore routed to its distinct `ipin`s (each a
 * capacity-1 node); routing two nets onto one node — a shared `sink` or a single `ipin` — is a request to
 * short them, which the router reports as overuse (routed:false) instead of silently accepting. Costs are
 * hop-count base costs (every resource = 1); a real delay-weighted base and segmentation come with the
 * Stage-2 device data. Base cost and capacity are both overridable via RouterOptions.
 */

import type { Pip, Rrg, WireNode } from './fpga-rrg.ts'

/** A logical net to route: its driver RRG node (`source`) and the load RRG nodes it must reach (`sinks`). */
export type RouteNet = { id: string; source: string; sinks: string[] }

/** One net's realized routing tree: the RRG nodes it occupies and the pips that connect them. */
export type RoutedNet = { netId: string; nodes: string[]; pips: string[] }

export type RouteResult = {
  /** true iff every net reached all its sinks AND no node is overused (a legal, congestion-free routing). */
  routed: boolean
  /** the union of every net's pips — exactly the ON-pip set fpga-sim's bridgeToSim consumes. */
  onPips: Set<string>
  /** per-net routing trees (present even on failure, for inspection). */
  routes: Map<string, RoutedNet>
  /** outer iterations run (1 = routed with no negotiation needed). */
  iterations: number
  /** node ids still overused (occupancy > capacity) when `routed` is false — a congestion failure (empty when routed). */
  overused: string[]
  /** `netId->sink` for any net whose sink was unreachable on this fabric — an unroutability failure (empty when routed). */
  unroutable: string[]
}

export type RouterOptions = {
  /** give up (routed:false) after this many negotiation rounds. */
  maxIterations?: number
  /** initial present-congestion factor pfac (McMurchie-Ebeling's; VPR default ≈ 0.5). */
  presentFacInit?: number
  /** pfac growth per iteration — makes present overuse progressively unaffordable. */
  presentFacMult?: number
  /** history growth per iteration of persistent overuse (hfac). */
  historyFac?: number
  /** base cost of routing through a node (default 1 = hop count; a delay model overrides). */
  baseCost?: (node: WireNode) => number
  /** node capacity (default: 1 for every node — see the capacity-model note in the file header). */
  capacity?: (node: WireNode) => number
}

/** A binary min-heap keyed by numeric priority — the Dijkstra frontier. */
class MinHeap<T> {
  private readonly items: { p: number; k: T }[] = []

  get size(): number {
    return this.items.length
  }

  private swap(i: number, j: number): void {
    const a = this.items[i] as { p: number; k: T }
    const b = this.items[j] as { p: number; k: T }
    this.items[i] = b
    this.items[j] = a
  }

  push(p: number, k: T): void {
    this.items.push({ p, k })
    let i = this.items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if ((this.items[parent] as { p: number }).p <= (this.items[i] as { p: number }).p) break
      this.swap(i, parent)
      i = parent
    }
  }

  pop(): { p: number; k: T } {
    const items = this.items
    const top = items[0] as { p: number; k: T }
    const last = items.pop() as { p: number; k: T }
    if (items.length > 0) {
      items[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = 2 * i + 2
        let m = i
        if (l < items.length && (items[l] as { p: number }).p < (items[m] as { p: number }).p) m = l
        if (r < items.length && (items[r] as { p: number }).p < (items[m] as { p: number }).p) m = r
        if (m === i) break
        this.swap(i, m)
        i = m
      }
    }
    return top
  }
}

/**
 * Route a set of nets onto the RRG with PathFinder negotiated congestion. Returns the ON-pip set (plus the
 * per-net trees and whether it converged to a legal, overuse-free routing).
 */
export function routeDesign(
  rrg: Rrg,
  nets: readonly RouteNet[],
  options: RouterOptions = {},
): RouteResult {
  const maxIterations = options.maxIterations ?? 50
  const presentFacInit = options.presentFacInit ?? 0.5
  const presentFacMult = options.presentFacMult ?? 1.5
  const historyFac = options.historyFac ?? 1
  const baseCostOf = options.baseCost ?? (() => 1)
  const capacityOf = options.capacity ?? (() => 1)

  const cap = (id: string): number => {
    const node = rrg.nodes.get(id)
    return node ? capacityOf(node) : 1
  }
  const base = (id: string): number => {
    const node = rrg.nodes.get(id)
    return node ? baseCostOf(node) : 1
  }

  const occupancy = new Map<string, number>()
  const history = new Map<string, number>()
  const occ = (id: string): number => occupancy.get(id) ?? 0
  const hist = (id: string): number => history.get(id) ?? 0
  const bump = (id: string, delta: number): void => {
    const next = occ(id) + delta
    if (next <= 0) occupancy.delete(id)
    else occupancy.set(id, next)
  }

  const routes = new Map<string, RoutedNet>()
  let pfac = presentFacInit

  // Present-congestion cost of ADDING one more net to `id`. The net being routed is ripped up first, so
  // occ(id) is other nets' demand: no penalty while there's spare capacity, then a pfac-scaled penalty.
  const presentCost = (id: string): number => {
    const over = occ(id) + 1 - cap(id)
    return over > 0 ? 1 + over * pfac : 1
  }
  const nodeCost = (id: string): number => (base(id) + hist(id)) * presentCost(id)

  const ripUp = (net: RouteNet): void => {
    const r = routes.get(net.id)
    if (!r) return
    for (const id of r.nodes) bump(id, -1)
    routes.delete(net.id)
  }

  // Min-cost path from ANY node already in `tree` (each a free root) to `target`, over the pips. A node
  // already in the tree costs 0 to reuse — that's what makes a multi-sink net a shared tree, not N paths.
  const searchToSink = (
    tree: Set<string>,
    target: string,
  ): { nodes: string[]; pips: string[] } | null => {
    const dist = new Map<string, number>()
    const prevPip = new Map<string, Pip>()
    const settled = new Set<string>()
    const heap = new MinHeap<string>()
    for (const root of tree) {
      dist.set(root, 0)
      heap.push(0, root)
    }
    while (heap.size > 0) {
      const { k: node } = heap.pop()
      if (settled.has(node)) continue
      settled.add(node)
      if (node === target) break
      const d = dist.get(node) as number
      for (const pip of rrg.edgesFrom.get(node) ?? []) {
        const next = pip.to
        if (settled.has(next)) continue
        const step = tree.has(next) ? 0 : nodeCost(next)
        const nd = d + step
        if (nd < (dist.get(next) ?? Number.POSITIVE_INFINITY)) {
          dist.set(next, nd)
          prevPip.set(next, pip)
          heap.push(nd, next)
        }
      }
    }
    if (!settled.has(target)) return null // unreachable from the current tree
    const nodes: string[] = []
    const pips: string[] = []
    let cur = target
    while (!tree.has(cur)) {
      const pip = prevPip.get(cur)
      if (pip === undefined) return null
      nodes.push(cur)
      pips.push(pip.id)
      cur = pip.from
    }
    return { nodes, pips }
  }

  // Route one net; returns the first sink it could NOT reach (an unroutability failure), or null on success.
  const routeNet = (net: RouteNet): string | null => {
    const treeNodes = new Set<string>([net.source])
    const treePips: string[] = []
    for (const sink of net.sinks) {
      if (treeNodes.has(sink)) continue
      const path = searchToSink(treeNodes, sink)
      if (path === null) return sink // unreachable from the net's current tree (⇒ from its source)
      for (const id of path.nodes) treeNodes.add(id)
      for (const p of path.pips) treePips.push(p)
    }
    const nodes = [...treeNodes]
    for (const id of nodes) bump(id, +1)
    routes.set(net.id, { netId: net.id, nodes, pips: treePips })
    return null
  }

  const stillOverused = (): string[] => [...occupancy.keys()].filter((id) => occ(id) > cap(id))

  let iterations = 0
  let unroutable: string[] = []
  for (let iter = 0; iter < maxIterations; iter++) {
    iterations = iter + 1
    unroutable = []
    for (const net of nets) {
      ripUp(net)
      const failedSink = routeNet(net)
      if (failedSink !== null) unroutable.push(`${net.id}->${failedSink}`)
    }
    const overused = stillOverused()
    if (unroutable.length === 0 && overused.length === 0) {
      return {
        routed: true,
        onPips: unionPips(routes),
        routes,
        iterations,
        overused: [],
        unroutable: [],
      }
    }
    for (const id of overused) history.set(id, hist(id) + historyFac * (occ(id) - cap(id)))
    pfac *= presentFacMult
  }
  return {
    routed: false,
    onPips: unionPips(routes),
    routes,
    iterations,
    overused: stillOverused(),
    unroutable,
  }
}

function unionPips(routes: Map<string, RoutedNet>): Set<string> {
  const on = new Set<string>()
  for (const r of routes.values()) for (const p of r.pips) on.add(p)
  return on
}

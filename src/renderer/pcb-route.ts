import type { FootprintProvenance } from './footprint.ts'
import {
  type Box,
  gridRouteAround,
  type Pt,
  segmentHitsBox,
  simplifyPath,
} from './orthogonal-route.ts'
import type { Airwire, PadBox, Ratsnest } from './pcb-board.ts'

/**
 * The copper router — turns the ratsnest's airwires into real copper on the board's copper layers
 * (TOOLCHAIN-ROADMAP.md Track 1: the step between placement and DRC/Gerber). Every trace is an
 * orthogonal polyline in real mm at a CITED width, routed with the same guaranteed obstacle-avoiding
 * engine the schematic's wires use (orthogonal-route.ts): a trace's centreline never comes closer
 * than width/2 + clearance to another net's copper on ITS layer — pads, routed traces, or via
 * barrels. Same-net copper may touch freely (that's a connection, not a short).
 *
 * Layers: `routeBoard` takes the board's copper-layer count (2 by default; 4 or 6 add inner layers).
 * Every connection tries the TOP layer first (SMD pads only exist there); a connection the top can't
 * take drops through plated VIAS. Three escalating strategies: (1) a through-hole pad is already on
 * every layer and needs no via; (2) an SMD pad gets a via beside it joined by a short top-layer stub
 * (bottomTerminal); (3) the full multi-layer A* (gridRouteMultiLayer) routes across ALL routable
 * layers at once, dropping vias MID-ROUTE to dive under a blocked region and surface again on any
 * layer. Whatever that search returns is committed only if its copper genuinely connects the
 * endpoints (twoLayerConnects) — the clearance/DRC audits check spacing, not continuity. What no
 * strategy can take stays an airwire in `unrouted`, honestly counted, never drawn as copper it
 * isn't. Routing is greedy shortest-airwire-first, the classic ordering. Traces may pass under part
 * bodies (real boards route under SMD parts) but never through other nets' copper.
 */

/** The routing rules a net class carries: trace width, copper-to-copper clearance, and the via it
 *  drops through — in mm, cited. */
export type RouteClass = {
  traceWidthMm: number
  clearanceMm: number
  /** Via pad (barrel) diameter — the copper the via puts on BOTH layers. */
  viaDiameterMm: number
  /** Via drill — the plated hole. */
  viaDrillMm: number
  provenance: FootprintProvenance
}

/**
 * The default net class — the MODAL Default class across the KiCad 10 project templates installed
 * on this machine (templates vary per project): track 0.25 mm / clearance 0.2 mm and a 0.6 mm via
 * barrel over a 0.4 mm drill (a 0.1 mm annular ring per side — twice JLCPCB's minimum).
 * Comfortably above the ~0.127 mm (5 mil) minimum common fabs manufacture.
 */
export const DEFAULT_ROUTE_CLASS: RouteClass = {
  traceWidthMm: 0.25,
  clearanceMm: 0.2,
  viaDiameterMm: 0.6,
  viaDrillMm: 0.4,
  provenance: {
    source_type: 'reference',
    title: 'KiCad Default net class (modal) — 0.25 mm track / 0.2 mm clearance / 0.6-0.4 mm via',
    citation:
      'KiCad 10 project templates (share/kicad/template/*/*.kicad_pro, net_settings.classes["Default"]) on the installed KiCad 10.0: the MODAL values — track_width 0.25 / clearance 0.2 in 12 of the 19 templates carrying a Default class, via_diameter 0.6 / via_drill 0.4 in 7 of 19 (the rest vary per project)',
    confidence: 'high',
    url: 'https://gitlab.com/kicad/code/kicad',
    date_accessed: '2026-07-04',
    notes:
      'Track well above the ~0.127 mm (5 mil) minimum common fabs manufacture (a 0.25 mm external trace carries ~1 A within a 10 °C rise per IPC-2221 sizing charts); the 0.6/0.4 via’s 0.1 mm annular ring is 2× JLCPCB’s minimum (via diameter ≥ hole + 0.1 mm).',
  },
}

/** The drilled-hole rules vias must obey — cited; the router respects them when placing vias and
 *  the DRC re-checks them explicitly (pcb-drc imports these so the two can never disagree). */
export const VIA_RULES: Record<
  'min_drill' | 'min_annular' | 'hole_to_hole',
  { limitMm: number; provenance: FootprintProvenance }
> = {
  // SUPERSEDED as the DRC drill floor by pcb-drc's `minDrillMm(thickness)` (the plating aspect-ratio floor);
  // kept as the cited via-drill reference the default via is sanity-checked against.
  min_drill: {
    limitMm: 0.3,
    provenance: {
      source_type: 'reference',
      title: 'KiCad 10 board rules — minimum through-hole (via drill) 0.3 mm',
      citation:
        'KiCad 10 project templates (board.design_settings.rules.min_through_hole_diameter = 0.3 in 15 of 19 installed templates; the rest larger) — the standard-capability drill floor',
      confidence: 'high',
      url: 'https://gitlab.com/kicad/code/kicad',
      date_accessed: '2026-07-04',
    },
  },
  min_annular: {
    limitMm: 0.05,
    provenance: {
      source_type: 'reference',
      title: 'JLCPCB via annular ring — via diameter ≥ hole + 0.1 mm (0.05 mm per side)',
      citation:
        'JLCPCB PCB capabilities: "Via diameter should be 0.1mm (0.15mm preferred) larger than Via hole size" — 0.05 mm of copper ring per side; matches the modal min_via_annular_width across the installed KiCad 10 templates',
      confidence: 'high',
      url: 'https://jlcpcb.com/capabilities/pcb-capabilities',
      date_accessed: '2026-07-04',
    },
  },
  hole_to_hole: {
    limitMm: 0.25,
    provenance: {
      source_type: 'reference',
      title: 'KiCad 10 board rules — minimum hole-to-hole 0.25 mm',
      citation:
        'KiCad 10 project templates (board.design_settings.rules.min_hole_to_hole = 0.25) — every installed template that sets the rule (19 of 20) says 0.25; the drill breaks out if two holes sit closer',
      confidence: 'high',
      url: 'https://gitlab.com/kicad/code/kicad',
      date_accessed: '2026-07-04',
    },
  },
}

export type CopperLayer = 'top' | 'inner1' | 'inner2' | 'inner3' | 'inner4' | 'bottom'

/** Every copper layer a trace could be on, top → bottom — the full universe (up to a 6-layer board).
 *  A plated through-via joins ALL of them at its point regardless of the board's actual layer count. */
export const ALL_COPPER_LAYERS: readonly CopperLayer[] = [
  'top',
  'inner1',
  'inner2',
  'inner3',
  'inner4',
  'bottom',
]

/**
 * The routable copper layers of a board with `copperLayerCount` copper layers, in stack order
 * (top → inner → bottom): 2 → [top, bottom]; 4 → [top, inner1, inner2, bottom]; 6 → adds inner3/4.
 * A trace and the route tool each carry one of these; the auto-router searches ALL of them at once
 * (gridRouteMultiLayer), and they can be hand-routed too.
 */
export function routableCopperLayers(copperLayerCount: number): CopperLayer[] {
  if (copperLayerCount <= 2) return ['top', 'bottom']
  const innerCount = Math.min(copperLayerCount - 2, 4)
  const inner = ALL_COPPER_LAYERS.slice(1, 1 + innerCount)
  return ['top', ...inner, 'bottom']
}

/** One routed copper trace: an orthogonal centreline polyline in board mm, at its class width,
 *  on one copper layer. */
export type CopperTrace = {
  net: string
  widthMm: number
  points: Pt[]
  layer: CopperLayer
}

/** A plated via — a drilled, plated barrel joining the two copper layers. Copper on BOTH. */
export type Via = {
  net: string
  at: Pt
  diameterMm: number
  drillMm: number
}

export type BoardRouting = {
  traces: CopperTrace[]
  vias: Via[]
  /** Connections neither copper layer could take — still owed, shown as airwires. */
  unrouted: Airwire[]
}

/**
 * Validate hand-drawn copper loaded from a `.chipblocks` file (the twin of sanitizeChipLayout /
 * the placements filter): keep only well-formed traces + vias, drop the rest. A malformed entry is
 * NOT a reason to reject the whole file — that trace/via just doesn't come back, exactly like a bad
 * placement falls back to its auto spot. A trace needs a net, a positive width, a real copper layer,
 * and at least two finite points (a 1-point trace draws nothing); a via needs a net, a finite point,
 * and positive drill + diameter. Untrusted input is `unknown` — this is the trust boundary.
 */
export function sanitizeCopper(
  traces: unknown,
  vias: unknown,
): { traces: CopperTrace[]; vias: Via[] } {
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  const point = (p: unknown): p is Pt => {
    const q = p as Record<string, unknown> | null
    return q !== null && typeof q === 'object' && finite(q.x) && finite(q.y)
  }
  const layers = new Set<string>(ALL_COPPER_LAYERS)
  const cleanTraces = Array.isArray(traces)
    ? (traces as unknown[]).filter((t): t is CopperTrace => {
        const q = t as Record<string, unknown> | null
        return (
          q !== null &&
          typeof q === 'object' &&
          typeof q.net === 'string' &&
          finite(q.widthMm) &&
          q.widthMm > 0 &&
          typeof q.layer === 'string' &&
          layers.has(q.layer) &&
          Array.isArray(q.points) &&
          q.points.length >= 2 &&
          (q.points as unknown[]).every(point)
        )
      })
    : []
  const cleanVias = Array.isArray(vias)
    ? (vias as unknown[]).filter((v): v is Via => {
        const q = v as Record<string, unknown> | null
        return (
          q !== null &&
          typeof q === 'object' &&
          typeof q.net === 'string' &&
          point(q.at) &&
          finite(q.diameterMm) &&
          q.diameterMm > 0 &&
          finite(q.drillMm) &&
          q.drillMm > 0
        )
      })
    : []
  return { traces: cleanTraces, vias: cleanVias }
}

/**
 * Merge the user's HAND-DRAWN copper into the auto-router's output, and RECOMPUTE which airwires are
 * still owed. Hand-drawn traces + vias are the exact same types the whole pipeline reads (the 3-D/2-D
 * views, DRC, and the Gerber/Excellon writers), so once they're in these arrays the copper is real end
 * to end — it draws, gets design-rule-checked, and ships in the manufacturing files identically to
 * auto-routed copper. The keystone is `unrouted`: an airwire the auto-router couldn't take is dropped
 * from the owed list once the user's copper physically joins its two pads — otherwise a fully
 * hand-routed board would never satisfy the export gate (which refuses to ship an unrouted board).
 *
 * `validLayers` (the board's actual copper layers) guards a hand trace tagged with a layer the board no
 * longer has — e.g. an inner-layer trace after the stack-up was reduced to fewer layers. Such copper
 * ships in NO Gerber (the export only writes the layers the stack-up declares), so counting it as
 * routed would let a physically-open net export as "fully routed" — a silently-wrong manufacturing ZIP.
 * Those traces are dropped from the merge (they stay in the user's saved state, so restoring the layer
 * count brings them back). Vias span every layer, so they always apply. Omit `validLayers` and nothing
 * is filtered (the older single-board-config callers + tests).
 */
export function mergeUserCopper(
  auto: BoardRouting,
  userTraces: CopperTrace[],
  userVias: Via[],
  validLayers?: ReadonlySet<CopperLayer>,
): BoardRouting {
  const keptTraces =
    validLayers === undefined ? userTraces : userTraces.filter((t) => validLayers.has(t.layer))
  if (keptTraces.length === 0 && userVias.length === 0) return auto
  const traces = [...auto.traces, ...keptTraces]
  const vias = [...auto.vias, ...userVias]
  const unrouted = auto.unrouted.filter((aw) => !copperConnects(aw.from, aw.to, traces, vias))
  return { traces, vias, unrouted }
}

/**
 * Physical copper connectivity: are points `a` and `b` joined by the given traces + vias? Union-find
 * over a 0.2 mm spatial grid, per layer — a trace joins all its own points on its layer, a via bridges
 * the two layers at its point, and copper landing in the same cell touches. A pad end reaches copper on
 * either layer near its point. This is how a real board connects, so it never over-reports a join.
 */
export function copperConnects(a: Pt, b: Pt, traces: CopperTrace[], vias: Via[]): boolean {
  const GRID = 0.2
  const parent = new Map<string, string>()
  const key = (x: number, y: number, layer: string) =>
    `${Math.round(x / GRID)}:${Math.round(y / GRID)}:${layer}`
  const ensure = (k: string) => {
    if (!parent.has(k)) parent.set(k, k)
  }
  const find = (k: string): string => {
    let root = k
    let p = parent.get(root)
    while (p !== undefined && p !== root) {
      root = p
      p = parent.get(root)
    }
    let cur = k
    let cp = parent.get(cur)
    while (cp !== undefined && cur !== root) {
      parent.set(cur, root)
      cur = cp
      cp = parent.get(cur)
    }
    return root
  }
  const union = (x: string, y: string) => {
    ensure(x)
    ensure(y)
    parent.set(find(x), find(y))
  }
  for (const t of traces) {
    let prev: string | null = null
    for (const p of t.points) {
      const k = key(p.x, p.y, t.layer)
      ensure(k)
      if (prev !== null) union(prev, k)
      prev = k
    }
  }
  // A plated through-via joins EVERY copper layer at its point (layers with no copper there just
  // become isolated grid cells, harmless) — so on a 2-layer board it still joins top↔bottom, and on
  // a 4-/6-layer board it bridges the inner layers too.
  for (const v of vias) {
    const anchor = key(v.at.x, v.at.y, ALL_COPPER_LAYERS[0] as string)
    for (let i = 1; i < ALL_COPPER_LAYERS.length; i++) {
      union(anchor, key(v.at.x, v.at.y, ALL_COPPER_LAYERS[i] as string))
    }
  }
  const comps = (p: Pt): Set<string> => {
    const s = new Set<string>()
    for (const layer of ALL_COPPER_LAYERS) {
      const k = key(p.x, p.y, layer)
      if (parent.has(k)) s.add(find(k))
    }
    return s
  }
  const ca = comps(a)
  const cb = comps(b)
  for (const c of ca) {
    if (cb.has(c)) return true
  }
  return false
}

/** Inflate a box by `pad` on every side — the forbidden zone for a trace CENTRELINE around copper. */
const inflate = (b: Box, pad: number): Box => ({
  x: b.x - pad,
  y: b.y - pad,
  w: b.w + 2 * pad,
  h: b.h + 2 * pad,
})

/** An axis-aligned segment's copper, as a box of the given half-thickness around its centreline. */
const segmentBox = (a: Pt, b: Pt, halfThickness: number): Box => {
  const x0 = Math.min(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  return {
    x: x0 - halfThickness,
    y: y0 - halfThickness,
    w: Math.abs(b.x - a.x) + 2 * halfThickness,
    h: Math.abs(b.y - a.y) + 2 * halfThickness,
  }
}

const pathClear = (points: Pt[], obstacles: Box[]): boolean => {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i] as Pt
    const b = points[i + 1] as Pt
    for (const o of obstacles) if (segmentHitsBox(a, b, o)) return false
  }
  return true
}

/** A via's copper as a box (the barrel's bounding square) — the shape the box engine reasons in. */
const viaBox = (v: Via): Box => ({
  x: v.at.x - v.diameterMm / 2,
  y: v.at.y - v.diameterMm / 2,
  w: v.diameterMm,
  h: v.diameterMm,
})

/** Do two boxes overlap (open intervals — touching edges are legal)? */
const boxesOverlap = (a: Box, b: Box): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** What using a via "costs" in equivalent trace millimetres — OUR routing weight (a heuristic,
 *  not a physical claim): high enough that the router never drops layers for a shortcut a small
 *  detour would serve, low enough that a genuinely blocked run takes the via. */
const VIA_COST_MM = 5

export type TwoLayerRoute = {
  /** Contiguous runs, each on one layer, in travel order; consecutive runs meet at a via. */
  runs: { layer: CopperLayer; points: Pt[] }[]
  /** Where the path changes layers — each is a plated via. */
  viaAt: Pt[]
}

/**
 * A* over EVERY copper layer at once — the full router. Nodes are (x, y, layer) on the combined Hanan
 * grid of every layer's obstacles; moves are orthogonal steps on the current layer, plus a layer
 * CHANGE (a plated through-via, at VIA_COST_MM) to ANY other layer wherever a via barrel is legal — a
 * through-via joins them all. This is what lets one connection start on the top, dive to an inner or
 * bottom layer under a blocked region, and surface again — vias mid-route, not just beside the
 * endpoints. A 2-layer board reduces to exactly the top/bottom search. `obstaclesByLayer` and `layers`
 * are index-aligned (obstaclesByLayer[i] = the forbidden zones on layers[i]). Exported for tests.
 */
export function gridRouteMultiLayer(
  a: Pt,
  aLayers: readonly CopperLayer[],
  b: Pt,
  bLayers: readonly CopperLayer[],
  obstaclesByLayer: readonly (readonly Box[])[],
  layers: readonly CopperLayer[],
  viaLegalAt: (p: Pt) => boolean,
  margin = 0.4,
  maxNodes = 500_000,
): TwoLayerRoute | null {
  const numLayers = layers.length
  const layerIndex = (l: CopperLayer) => layers.indexOf(l)
  const xsSet = new Set<number>([a.x, b.x])
  const ysSet = new Set<number>([a.y, b.y])
  for (const layerObs of obstaclesByLayer) {
    for (const o of layerObs) {
      xsSet.add(o.x - margin)
      xsSet.add(o.x + o.w + margin)
      ysSet.add(o.y - margin)
      ysSet.add(o.y + o.h + margin)
    }
  }
  const xs = [...xsSet].sort((p, q) => p - q)
  const ys = [...ysSet].sort((p, q) => p - q)
  if (xs.length * ys.length * numLayers > maxNodes) return null
  const W = xs.length
  const at = (ix: number, iy: number): Pt => ({ x: xs[ix] as number, y: ys[iy] as number })
  const layerObstacles = (li: number): readonly Box[] => obstaclesByLayer[li] ?? []
  const clear = (p: Pt, q: Pt, li: number) =>
    !layerObstacles(li).some((o) => segmentHitsBox(p, q, o))
  const pointFree = (p: Pt, li: number) =>
    !layerObstacles(li).some((o) => p.x > o.x && p.x < o.x + o.w && p.y > o.y && p.y < o.y + o.h)
  const key = (ix: number, iy: number, li: number) => (iy * W + ix) * numLayers + li
  const h = (ix: number, iy: number) =>
    Math.abs((xs[ix] as number) - b.x) + Math.abs((ys[iy] as number) - b.y)
  // memoize the (expensive) via-legality probe per grid point
  const viaOkCache = new Map<number, boolean>()
  const viaOk = (ix: number, iy: number): boolean => {
    const ck = iy * W + ix
    const hit = viaOkCache.get(ck)
    if (hit !== undefined) return hit
    const ok = viaLegalAt(at(ix, iy))
    viaOkCache.set(ck, ok)
    return ok
  }

  const startIx = xs.indexOf(a.x)
  const startIy = ys.indexOf(a.y)
  const goalIx = xs.indexOf(b.x)
  const goalIy = ys.indexOf(b.y)
  const gScore = new Map<number, number>()
  const cameFrom = new Map<number, number>()
  const open: { ix: number; iy: number; layer: number; f: number }[] = []
  for (const l of aLayers) {
    const li = layerIndex(l)
    if (li < 0) continue
    gScore.set(key(startIx, startIy, li), 0)
    open.push({ ix: startIx, iy: startIy, layer: li, f: h(startIx, startIy) })
  }
  const goalKeys = new Set(
    bLayers
      .map((l) => layerIndex(l))
      .filter((li) => li >= 0)
      .map((li) => key(goalIx, goalIy, li)),
  )
  let reachedGoal = -1
  while (open.length > 0) {
    let best = 0
    for (let i = 1; i < open.length; i++)
      if ((open[i] as { f: number }).f < (open[best] as { f: number }).f) best = i
    const cur = open.splice(best, 1)[0] as { ix: number; iy: number; layer: number }
    const ck = key(cur.ix, cur.iy, cur.layer)
    if (goalKeys.has(ck)) {
      reachedGoal = ck
      break
    }
    const cg = gScore.get(ck) ?? Number.POSITIVE_INFINITY
    const cp = at(cur.ix, cur.iy)
    const steps: [number, number][] = [
      [cur.ix - 1, cur.iy],
      [cur.ix + 1, cur.iy],
      [cur.ix, cur.iy - 1],
      [cur.ix, cur.iy + 1],
    ]
    for (const [nx, ny] of steps) {
      if (nx < 0 || nx >= W || ny < 0 || ny >= ys.length) continue
      const np = at(nx, ny)
      if (!clear(cp, np, cur.layer)) continue
      const tentative = cg + Math.abs(np.x - cp.x) + Math.abs(np.y - cp.y)
      const nk = key(nx, ny, cur.layer)
      if (tentative < (gScore.get(nk) ?? Number.POSITIVE_INFINITY)) {
        gScore.set(nk, tentative)
        cameFrom.set(nk, ck)
        open.push({ ix: nx, iy: ny, layer: cur.layer, f: tentative + h(nx, ny) })
      }
    }
    // A layer change — a plated through-via joins every layer at this point, so from here the path can
    // surface on ANY other layer whose copper is open there, for one via's cost.
    if (viaOk(cur.ix, cur.iy)) {
      for (let li = 0; li < numLayers; li++) {
        if (li === cur.layer || !pointFree(cp, li)) continue
        const tentative = cg + VIA_COST_MM
        const nk = key(cur.ix, cur.iy, li)
        if (tentative < (gScore.get(nk) ?? Number.POSITIVE_INFINITY)) {
          gScore.set(nk, tentative)
          cameFrom.set(nk, ck)
          open.push({ ix: cur.ix, iy: cur.iy, layer: li, f: tentative + h(cur.ix, cur.iy) })
        }
      }
    }
  }
  if (reachedGoal < 0) return null

  // Walk back, splitting the node chain into per-layer runs with a via at every layer change.
  const chain: { p: Pt; layer: number }[] = []
  let k = reachedGoal
  for (;;) {
    const cell = Math.floor(k / numLayers)
    chain.unshift({ p: at(cell % W, Math.floor(cell / W)), layer: k % numLayers })
    const prev = cameFrom.get(k)
    if (prev === undefined) break
    k = prev
  }
  const runs: { layer: CopperLayer; points: Pt[] }[] = []
  // A via at EVERY layer change — the A* only changes layers where the caller's viaLegalAt passed, so
  // every one is legal, and every one is NEEDED: it bridges the run (or the pad) at that point. A
  // change that lands exactly on an endpoint leaves a single-point run whose TRACE draws nothing, but
  // its via must stay — at an SMD (top-only) pad that via is the sole bridge from an inner/bottom run
  // up to the pad's top copper; dropping it opens the net (review-caught: the earlier "derive vias
  // from surviving runs" refactor silently opened exactly that case).
  const viaAt: Pt[] = []
  for (const node of chain) {
    const layerName = layers[node.layer] as CopperLayer
    const run = runs[runs.length - 1]
    if (run === undefined) {
      runs.push({ layer: layerName, points: [node.p] })
    } else if (run.layer !== layerName) {
      viaAt.push({ x: node.p.x, y: node.p.y }) // the change point (prev run ends here) is a via
      runs.push({ layer: layerName, points: [node.p] })
    } else {
      run.points.push(node.p)
    }
  }
  const kept = runs
    .map((r) => ({ layer: r.layer, points: simplifyPath(r.points) }))
    .filter((r) => r.points.length >= 2)
  return { runs: kept, viaAt }
}

/** The two-layer (top / bottom) form — the original signature, now a thin wrapper over the general
 *  N-layer router so both share one implementation. */
export function gridRouteTwoLayer(
  a: Pt,
  aLayers: readonly CopperLayer[],
  b: Pt,
  bLayers: readonly CopperLayer[],
  obstacles: { top: Box[]; bottom: Box[] },
  viaLegalAt: (p: Pt) => boolean,
  margin = 0.4,
  maxNodes = 500_000,
): TwoLayerRoute | null {
  return gridRouteMultiLayer(
    a,
    aLayers,
    b,
    bLayers,
    [obstacles.top, obstacles.bottom],
    ['top', 'bottom'],
    viaLegalAt,
    margin,
    maxNodes,
  )
}

/**
 * Does a two-layer route actually CONNECT its two endpoints through its committed copper? Builds the
 * (point, layer) graph — each run links its consecutive points on its layer, each via links the two
 * layers at its point — and BFSes from the start (on any of its pad's layers) to the goal (on any of
 * its pad's layers). The router uses this as a hard gate: the clearance/DRC audits check spacing, not
 * connectivity, so without this a disconnected route (a dropped endpoint via) would sail through as
 * "routed" straight into the Gerbers. A route that fails this is refused, not shipped.
 */
export function twoLayerConnects(
  route: TwoLayerRoute,
  from: Pt,
  fromLayers: readonly CopperLayer[],
  to: Pt,
  toLayers: readonly CopperLayer[],
): boolean {
  const key = (p: Pt, layer: CopperLayer) => `${p.x},${p.y},${layer}`
  const adj = new Map<string, string[]>()
  const link = (a: string, b: string) => {
    ;(adj.get(a) ?? adj.set(a, []).get(a))?.push(b)
    ;(adj.get(b) ?? adj.set(b, []).get(b))?.push(a)
  }
  for (const run of route.runs) {
    for (let i = 0; i < run.points.length - 1; i++) {
      link(key(run.points[i] as Pt, run.layer), key(run.points[i + 1] as Pt, run.layer))
    }
  }
  // A plated through-via joins EVERY copper layer at its point — chain them so any two layers of
  // the route are connected there (a 2-layer route still just joins top↔bottom).
  for (const v of route.viaAt) {
    for (let i = 0; i < ALL_COPPER_LAYERS.length - 1; i++) {
      link(
        key(v, ALL_COPPER_LAYERS[i] as CopperLayer),
        key(v, ALL_COPPER_LAYERS[i + 1] as CopperLayer),
      )
    }
  }
  const starts = fromLayers.map((l) => key(from, l))
  const goals = new Set(toLayers.map((l) => key(to, l)))
  if (starts.some((s) => goals.has(s))) return true
  const seen = new Set(starts)
  const queue = [...starts]
  while (queue.length > 0) {
    const cur = queue.shift() as string
    if (goals.has(cur)) return true
    for (const n of adj.get(cur) ?? []) {
      if (!seen.has(n)) {
        seen.add(n)
        queue.push(n)
      }
    }
  }
  return false
}

/** Try the natural shapes (straight, both L corners) then the A* grid. Null = this layer says no. */
function tryPath(a: Pt, b: Pt, obstacles: Box[]): Pt[] | null {
  const candidates: Pt[][] = []
  if (a.x === b.x || a.y === b.y) candidates.push([a, b])
  else {
    candidates.push([a, { x: b.x, y: a.y }, b])
    candidates.push([a, { x: a.x, y: b.y }, b])
  }
  const cheap = candidates.find((c) => pathClear(c, obstacles))
  if (cheap !== undefined) return cheap
  // The generous node cap matters: the default 4096 dies at ~16 placed parts' worth of Hanan
  // grid lines — the exact silent-death routeAllWires already hit and fixed the same way.
  const found = gridRouteAround(a, b, obstacles, 0.4, 1_000_000)
  return found === null ? null : simplifyPath(found)
}

/**
 * Route every airwire, shortest first: top layer, then bottom-through-vias. For each attempt the
 * obstacles are every OTHER net's copper on that layer — pad boxes (all pads block the top;
 * through-hole pads block the bottom too), routed trace centrelines, and via barrels — inflated so
 * the centreline keeps width/2 + clearance from the copper edge.
 */
export function routeBoard(
  ratsnest: Ratsnest,
  cls: RouteClass = DEFAULT_ROUTE_CLASS,
  copperLayers = 2,
): BoardRouting {
  const w = cls.traceWidthMm
  const clr = cls.clearanceMm
  const traces: CopperTrace[] = []
  const vias: Via[] = []
  const unrouted: Airwire[] = []
  // The layers the router may lay copper on, in stack order — [top, bottom] for a 2-layer board,
  // [top, inner1, …, bottom] once inner layers exist. The full A* searches all of them at once.
  const routable = routableCopperLayers(copperLayers)

  const ordered = [...ratsnest.airwires].sort(
    (p, q) =>
      Math.abs(p.to.x - p.from.x) +
      Math.abs(p.to.y - p.from.y) -
      (Math.abs(q.to.x - q.from.x) + Math.abs(q.to.y - q.from.y)),
  )

  /** Forbidden zones for a centreline of net `net` on `layer`. */
  const obstaclesFor = (net: string, layer: CopperLayer): Box[] => {
    const out: Box[] = []
    for (const pad of ratsnest.padBoxes) {
      if (pad.net === net) continue
      if (layer !== 'top' && !pad.throughHole) continue // SMD copper exists on the top layer only
      out.push(inflate(pad, clr + w / 2))
    }
    for (const t of traces) {
      if (t.net === net || t.layer !== layer) continue
      for (let i = 0; i < t.points.length - 1; i++) {
        out.push(segmentBox(t.points[i] as Pt, t.points[i + 1] as Pt, t.widthMm / 2 + clr + w / 2))
      }
    }
    for (const v of vias) {
      if (v.net === net) continue
      out.push(inflate(viaBox(v), clr + w / 2)) // a via barrel is copper on BOTH layers
    }
    return out
  }

  /** Is a via barrel at `at` legal for `net`? Two separate laws: its COPPER must keep clearance
   *  from every other net's copper on both layers (same-net copper may touch), and its DRILL must
   *  keep the hole-to-hole gap from EVERY plated hole — same net or not, the drill breaks out
   *  regardless (review-caught: skipping same-net holes stacked two vias on one coordinate and
   *  parked one against its own net's component hole). */
  const viaSpotLegal = (at: Pt, net: string): boolean => {
    const barrel: Box = {
      x: at.x - cls.viaDiameterMm / 2,
      y: at.y - cls.viaDiameterMm / 2,
      w: cls.viaDiameterMm,
      h: cls.viaDiameterMm,
    }
    const holeGapClear = (holeAt: Pt, holeMm: number): boolean =>
      Math.hypot(at.x - holeAt.x, at.y - holeAt.y) >=
      (cls.viaDrillMm + holeMm) / 2 + VIA_RULES.hole_to_hole.limitMm
    for (const pad of ratsnest.padBoxes) {
      if (pad.holeMm !== undefined) {
        const holeAt = { x: pad.x + pad.w / 2, y: pad.y + pad.h / 2 }
        if (!holeGapClear(holeAt, pad.holeMm)) return false
      }
      // A via must clear EVERY pad — other nets to avoid a short, and its OWN net too: a via sitting
      // in a pad (any net) wicks the component's solder down the barrel (via-in-pad). So there is NO
      // same-net exemption here, unlike a trace, where same-net copper may touch freely.
      if (boxesOverlap(inflate(pad, clr), barrel)) return false
    }
    for (const t of traces) {
      if (t.net === net) continue
      for (let i = 0; i < t.points.length - 1; i++) {
        const seg = segmentBox(t.points[i] as Pt, t.points[i + 1] as Pt, t.widthMm / 2 + clr)
        if (boxesOverlap(seg, barrel)) return false
      }
    }
    for (const v of vias) {
      if (!holeGapClear(v.at, v.drillMm)) return false
      if (v.net === net) continue
      if (boxesOverlap(inflate(viaBox(v), clr), barrel)) return false
    }
    return true
  }

  /** An airwire endpoint's presence on the bottom layer: a through-hole pad is already there; an
   *  SMD pad needs a via beside it plus a short top stub from pad centre to via. An EXISTING
   *  same-net via within stub reach is REUSED (one barrel, one drill — the second connection just
   *  joins it), never doubled. Returns the bottom-layer terminal plus the stub/via to commit if
   *  the whole route lands. */
  const bottomTerminal = (
    p: Pt,
    net: string,
    topObstacles: Box[],
  ): { at: Pt; stub: Pt[] | null; via: Via | null } | null => {
    const pad = ratsnest.padBoxes.find(
      (b) => b.net === net && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h,
    )
    if (pad?.throughHole) return { at: p, stub: null, via: null }
    // A committed same-net via already sits beside this pad? Ride it — same-net copper joining
    // same-net copper is a connection, and one hole serves both routes.
    for (const v of vias) {
      if (v.net !== net) continue
      if (Math.abs(v.at.x - p.x) + Math.abs(v.at.y - p.y) > 3) continue
      const isAxisAligned = v.at.x === p.x || v.at.y === p.y
      const stub = isAxisAligned ? [p, v.at] : [p, { x: v.at.x, y: p.y }, v.at]
      if (!pathClear(stub, topObstacles)) continue
      return { at: v.at, stub, via: null }
    }
    // SMD (or bare point): try fresh via spots on the four orthogonal sides, nearest first.
    for (const dist of [1.2, 1.8, 2.4]) {
      for (const [dx, dy] of [
        [dist, 0],
        [-dist, 0],
        [0, dist],
        [0, -dist],
      ]) {
        const at = { x: p.x + (dx as number), y: p.y + (dy as number) }
        if (!viaSpotLegal(at, net)) continue
        const stub = [p, at]
        if (!pathClear(stub, topObstacles)) continue
        return {
          at,
          stub,
          via: { net, at, diameterMm: cls.viaDiameterMm, drillMm: cls.viaDrillMm },
        }
      }
    }
    return null
  }

  for (const aw of ordered) {
    // Top layer first — the cheap, via-free home.
    const topObstacles = obstaclesFor(aw.net, 'top')
    const topPath = tryPath(aw.from, aw.to, topObstacles)
    if (topPath !== null) {
      traces.push({ net: aw.net, widthMm: w, points: topPath, layer: 'top' })
      continue
    }
    // Bottom layer through vias.
    const fromTerm = bottomTerminal(aw.from, aw.net, topObstacles)
    const toTerm = fromTerm === null ? null : bottomTerminal(aw.to, aw.net, topObstacles)
    // Twin vias of the SAME net may touch copper-wise, but their DRILLS still need the
    // hole-to-hole gap — the drill breaks out between two holes that close.
    const drillsClash =
      fromTerm?.via != null &&
      toTerm?.via != null &&
      Math.hypot(fromTerm.via.at.x - toTerm.via.at.x, fromTerm.via.at.y - toTerm.via.at.y) <
        cls.viaDrillMm + VIA_RULES.hole_to_hole.limitMm
    if (fromTerm !== null && toTerm !== null && !drillsClash) {
      // Both ends riding the SAME reused via: the via itself is the join — no bottom run at all.
      const sameSpot = fromTerm.at.x === toTerm.at.x && fromTerm.at.y === toTerm.at.y
      const bottomPath = sameSpot
        ? []
        : tryPath(fromTerm.at, toTerm.at, obstaclesFor(aw.net, 'bottom'))
      if (bottomPath !== null) {
        for (const term of [fromTerm, toTerm]) {
          if (term.stub !== null) {
            traces.push({ net: aw.net, widthMm: w, points: term.stub, layer: 'top' })
          }
          if (term.via !== null) vias.push(term.via)
        }
        if (bottomPath.length >= 2) {
          traces.push({ net: aw.net, widthMm: w, points: bottomPath, layer: 'bottom' })
        }
        continue
      }
    }
    // The full multi-layer search — vias MID-ROUTE, not just beside the endpoints: dive under a
    // blocked region and surface again, on ANY routable layer. A through-hole endpoint sits on
    // every layer; an SMD pad's copper is on the top only, so it must start there.
    const layersOf = (p: Pt): CopperLayer[] => {
      const pad = ratsnest.padBoxes.find(
        (bx) =>
          bx.net === aw.net &&
          p.x >= bx.x &&
          p.x <= bx.x + bx.w &&
          p.y >= bx.y &&
          p.y <= bx.y + bx.h,
      )
      return pad?.throughHole ? [...routable] : ['top']
    }
    const fromLayers = layersOf(aw.from)
    const toLayers = layersOf(aw.to)
    const two = gridRouteMultiLayer(
      aw.from,
      fromLayers,
      aw.to,
      toLayers,
      routable.map((l) => (l === 'top' ? topObstacles : obstaclesFor(aw.net, l))),
      routable,
      (p) => viaSpotLegal(p, aw.net),
    )
    if (two !== null) {
      // Its own pending vias must respect the hole gap between THEMSELVES too (viaSpotLegal only
      // sees committed copper) — a route needing two flips that close is refused, not emitted.
      const pendingClash = two.viaAt.some((p, i) =>
        two.viaAt.some(
          (q, j) =>
            j > i &&
            Math.hypot(p.x - q.x, p.y - q.y) < cls.viaDrillMm + VIA_RULES.hole_to_hole.limitMm,
        ),
      )
      // …and the emitted copper must genuinely CONNECT the endpoints (the clearance/DRC audits
      // check spacing, not continuity) — never commit a route with a hidden open.
      const connected = twoLayerConnects(two, aw.from, fromLayers, aw.to, toLayers)
      if (!pendingClash && connected) {
        for (const run of two.runs) {
          traces.push({ net: aw.net, widthMm: w, points: run.points, layer: run.layer })
        }
        for (const spot of two.viaAt) {
          vias.push({
            net: aw.net,
            at: spot,
            diameterMm: cls.viaDiameterMm,
            drillMm: cls.viaDrillMm,
          })
        }
        continue
      }
    }
    unrouted.push(aw)
  }
  return { traces, vias, unrouted }
}

export type ClearanceViolation = {
  kind: 'trace-trace' | 'trace-pad' | 'pad-pad' | 'via-copper'
  netA: string
  netB: string
  /** Where the copper comes too close, in board mm — the centre of the offending overlap. */
  at: Pt
}

/** The midpoint of the part of segment a→b that lies inside the zone (callers guarantee it hits). */
const overlapMidpoint = (a: Pt, b: Pt, zone: Box): Pt => {
  const xLo = Math.max(Math.min(a.x, b.x), zone.x)
  const xHi = Math.min(Math.max(a.x, b.x), zone.x + zone.w)
  const yLo = Math.max(Math.min(a.y, b.y), zone.y)
  const yHi = Math.min(Math.max(a.y, b.y), zone.y + zone.h)
  return { x: (xLo + xHi) / 2, y: (yLo + yHi) / 2 }
}

/**
 * The clearance audit — every place two different nets' copper comes closer than the class allows,
 * PER LAYER: trace centrelines vs each other and vs pad copper on their own layer (an SMD pad has
 * no copper on the bottom, so a bottom trace may pass under it — real boards route under SMD
 * parts), pad copper vs pad copper, and via barrels (copper on BOTH layers) vs everything. Each
 * violation carries WHERE, so the board can mark it. Used by the tests to prove the router's
 * output legal, and by the DRC pass. A tiny epsilon keeps exactly-at-clearance copper (flush
 * routes the router legally emits) from being flagged.
 */
export function clearanceViolations(
  routing: BoardRouting,
  padBoxes: readonly PadBox[],
  cls: RouteClass = DEFAULT_ROUTE_CLASS,
): ClearanceViolation[] {
  const epsilon = 1e-9
  const out: ClearanceViolation[] = []
  const traces = routing.traces
  /** Does this pad have copper on the given layer? */
  const padOnLayer = (pad: PadBox, layer: CopperLayer): boolean =>
    layer === 'top' || pad.throughHole
  for (let i = 0; i < traces.length; i++) {
    const t = traces[i] as CopperTrace
    for (let s = 0; s < t.points.length - 1; s++) {
      const a = t.points[s] as Pt
      const b = t.points[s + 1] as Pt
      // vs other nets' pads that share this trace's layer
      for (const pad of padBoxes) {
        if (pad.net === t.net || !padOnLayer(pad, t.layer)) continue
        const zone = inflate(pad, cls.clearanceMm + t.widthMm / 2 - epsilon)
        if (segmentHitsBox(a, b, zone)) {
          out.push({
            kind: 'trace-pad',
            netA: t.net,
            netB: pad.net,
            at: overlapMidpoint(a, b, zone),
          })
        }
      }
      // vs other traces on the same layer (later ones only — each pair once)
      for (let j = i + 1; j < traces.length; j++) {
        const u = traces[j] as CopperTrace
        if (u.net === t.net || u.layer !== t.layer) continue
        for (let r = 0; r < u.points.length - 1; r++) {
          const zone = segmentBox(
            u.points[r] as Pt,
            u.points[r + 1] as Pt,
            u.widthMm / 2 + cls.clearanceMm + t.widthMm / 2 - epsilon,
          )
          if (segmentHitsBox(a, b, zone)) {
            out.push({
              kind: 'trace-trace',
              netA: t.net,
              netB: u.net,
              at: overlapMidpoint(a, b, zone),
            })
          }
        }
      }
      // vs other nets' via barrels (both layers — a via is copper on each)
      for (const v of routing.vias) {
        if (v.net === t.net) continue
        const zone = inflate(viaBox(v), cls.clearanceMm + t.widthMm / 2 - epsilon)
        if (segmentHitsBox(a, b, zone)) {
          out.push({
            kind: 'via-copper',
            netA: t.net,
            netB: v.net,
            at: overlapMidpoint(a, b, zone),
          })
        }
      }
    }
  }
  // via barrels vs pads and vs each other (cross-net) — copper on both layers, so no layer filter
  for (const v of routing.vias) {
    const barrel = viaBox(v)
    for (const pad of padBoxes) {
      if (pad.net === v.net) continue
      const zone = inflate(pad, cls.clearanceMm - epsilon)
      if (boxesOverlap(zone, barrel)) {
        out.push({
          kind: 'via-copper',
          netA: v.net,
          netB: pad.net,
          at: { x: v.at.x, y: v.at.y },
        })
      }
    }
  }
  for (let i = 0; i < routing.vias.length; i++) {
    const a = routing.vias[i] as Via
    for (let j = i + 1; j < routing.vias.length; j++) {
      const b = routing.vias[j] as Via
      if (a.net === b.net) continue
      if (boxesOverlap(inflate(viaBox(a), cls.clearanceMm - epsilon), viaBox(b))) {
        out.push({
          kind: 'via-copper',
          netA: a.net,
          netB: b.net,
          at: { x: (a.at.x + b.at.x) / 2, y: (a.at.y + b.at.y) / 2 },
        })
      }
    }
  }
  // pad copper vs pad copper — different nets' pads closer than the clearance (stacked parts)
  for (let i = 0; i < padBoxes.length; i++) {
    const p = padBoxes[i] as PadBox
    for (let j = i + 1; j < padBoxes.length; j++) {
      const q = padBoxes[j] as PadBox
      if (p.net === q.net) continue
      const zone = inflate(p, cls.clearanceMm - epsilon)
      const xLo = Math.max(zone.x, q.x)
      const xHi = Math.min(zone.x + zone.w, q.x + q.w)
      const yLo = Math.max(zone.y, q.y)
      const yHi = Math.min(zone.y + zone.h, q.y + q.h)
      if (xLo < xHi && yLo < yHi) {
        out.push({
          kind: 'pad-pad',
          netA: p.net,
          netB: q.net,
          at: { x: (xLo + xHi) / 2, y: (yLo + yHi) / 2 },
        })
      }
    }
  }
  return out
}

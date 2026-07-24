/**
 * FPGA fabric — Stage 1 (the abstract "mini-VPR"), the packer + placer + net extractor.
 * The full staging is FPGA-FABRIC-RESEARCH.md Appendix A. This is the glue between the two hard engines: it
 * takes the LUT-covering mapper's output (fpga-fabric.ts `coverToLuts`), assigns each LUT to a physical tile
 * on the fabric (fpga-rrg.ts), and turns the logical LUT netlist into the RRG-level `RouteNet`s the
 * PathFinder router (fpga-router.ts) consumes and the `PlacedLut`s the sim bridge (fpga-sim.ts) simulates.
 * With this the whole flow closes: gates → LUTs (map) → tiles (pack + PLACE) → wires (route) → 0/1 sim.
 *
 * Packing (Stage-1 scope, honest): the generated fabric exposes exactly ONE output per logic tile (one
 * `source`/`opin`), so a tile holds ONE BLE — `packLuts` is the identity, one LUT per cluster. Multi-BLE
 * packing (grouping LUTs that share inputs into one cluster to cut routing) needs a fabric that models local
 * intra-cluster interconnect and N tile outputs; that is a later refinement, not faked here.
 *
 * Placement is the real engine: simulated annealing minimizing half-perimeter wirelength (HPWL) — the same
 * cost VPR's placer uses. HPWL(net) = width + height of the bounding box of the tiles the net touches
 * (its driver LUT's tile + every consumer LUT's tile); the total over all nets estimates routed wirelength,
 * so shrinking it makes the router's job easier and the design more routable. Moves (relocate/swap a LUT to
 * another tile) are accepted if they cut cost or, with probability e^(−Δ/T), uphill — T cooled geometrically.
 * It returns the BEST placement seen across the anneal, not the final (possibly uphill) state, so the result
 * is never worse than the initial placement under any schedule. A seeded PRNG makes every placement
 * reproducible (the annealer is deterministic given its seed).
 *
 * Cost scales: each move re-scores only the nets it can change — an EXACT incremental Δ over the nets touching
 * the moved (and displaced) clusters (via the `netsOf` map), not a full HPWL recompute. This is byte-identical
 * to the full recompute (same accept/reject decisions, same result — a test recomputes the returned HPWL from
 * scratch to prove it), but drops each move from O(all nets) to O(local), taking the annealer from O(n³) to
 * O(n²) with NO change to placement quality. (The move budget is still ≈N·tiles moves — the O(n²) term. A
 * VPR-standard ~N^(4/3) budget would improve the asymptotics further, but only with an adaptive-temperature
 * schedule + range-limited moves to preserve quality at fewer moves; a naive budget cut alone measurably
 * worsens wirelength, so it is deliberately left for a future quality-preserving placer.) A single very-high-
 * fanout net (fanout ∝ n) still costs O(fanout) per move it touches.
 *
 * Net extraction bridges logical nets to physical nodes: a LUT placed on tile (x,y) drives `src_x_y` and
 * reads each input on a distinct `ipin_x_y_p`. An input net driven by another LUT becomes a RouteNet from
 * that driver's `src` to this load's `ipin` (the router's job); a primary-input net (driven by nothing) is
 * left as its own node for the caller to drive directly (IO-pin routing is a later refinement — disclosed).
 */

import type { KLut } from './fpga-fabric.ts'
import type { RouteNet } from './fpga-router.ts'
import type { FabricDevice } from './fpga-rrg.ts'
import type { PlacedLut } from './fpga-sim.ts'

/** A cluster = the BLEs assigned to one tile. Stage-1 fabric is one BLE per tile, so `luts` has length 1. */
export type Cluster = { id: string; luts: KLut[] }

/**
 * Pack a LUT netlist into clusters. Stage-1 fabric has one output per tile ⇒ one BLE per tile, so this is the
 * identity: one LUT per cluster. (Kept as an explicit step so the pipeline reads pack → place → route, and so
 * a real N-BLE packer can replace it once the fabric models local interconnect.)
 */
export function packLuts(luts: readonly KLut[]): Cluster[] {
  return luts.map((lut, i) => ({ id: `c${i}`, luts: [lut] }))
}

/** A placement: cluster id → the tile it sits on. */
export type Placement = Map<string, { x: number; y: number }>

export type PlaceResult = {
  /** true iff every cluster got a distinct logic tile (false ⇒ the design has more LUTs than the fabric has tiles). */
  fits: boolean
  placement: Placement
  /** HPWL of the returned placement, and of the initial (pre-anneal) placement — so a test can see SA improved it. */
  hpwl: number
  initialHpwl: number
}

export type PlaceOptions = {
  /** PRNG seed — same seed ⇒ same placement (the annealer is deterministic). */
  seed?: number
  /** total annealing moves (default scales with design + fabric size: N·tiles·20, floored at 500). */
  moves?: number
  /** geometric cooling factor applied to the temperature each move (default 0.99). */
  cooling?: number
  /** per-channel congestion history from a failed routing round: key `chanx_<y>` / `chany_<x>` → penalty. A
   *  net crossing a congested row/column is charged `congestionWeight × penalty`, so the placer steers nets
   *  off it. Empty/absent ⇒ pure-HPWL placement (the default; existing behaviour unchanged). */
  congestion?: Map<string, number>
  /** weight on the congestion term relative to wirelength (default 0 ⇒ congestion ignored). */
  congestionWeight?: number
}

/** A small deterministic PRNG (mulberry32) so placement is reproducible from a seed. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The cluster-level connectivity a placement optimizes: which cluster drives a net and which consume it. */
type ClusterNet = { driver: string | undefined; consumers: string[] }

function buildClusterNets(clusters: readonly Cluster[]): ClusterNet[] {
  const driverOf = new Map<string, string>()
  for (const c of clusters) for (const lut of c.luts) driverOf.set(lut.output, c.id)
  const nets = new Map<string, ClusterNet>()
  for (const c of clusters) {
    for (const lut of c.luts) {
      for (const w of lut.inputs) {
        const cn = nets.get(w) ?? { driver: driverOf.get(w), consumers: [] }
        if (!cn.consumers.includes(c.id)) cn.consumers.push(c.id)
        nets.set(w, cn)
      }
    }
  }
  return [...nets.values()]
}

/**
 * Place clusters onto the fabric's logic tiles with simulated-annealing HPWL minimization. Returns the
 * placement plus the initial and final HPWL. If there are more clusters than logic tiles, `fits` is false and
 * the (partial) placement fills what it can.
 */
export function placeClusters(
  clusters: readonly Cluster[],
  device: FabricDevice,
  options: PlaceOptions = {},
): PlaceResult {
  const tiles = device.tiles.filter((t) => t.kind === 'logic')
  const clusterNets = buildClusterNets(clusters)

  // cluster id → tile index; tile index → occupant cluster id (or null).
  const pos = new Map<string, number>()
  const occupant: (string | null)[] = tiles.map(() => null)
  const n = Math.min(clusters.length, tiles.length)
  for (let i = 0; i < n; i++) {
    const cluster = clusters[i] as Cluster
    pos.set(cluster.id, i)
    occupant[i] = cluster.id
  }
  const fits = clusters.length <= tiles.length

  const tileOf = (id: string): { x: number; y: number } => {
    const idx = pos.get(id)
    return idx === undefined ? { x: 0, y: 0 } : (tiles[idx] as { x: number; y: number })
  }
  const congestion = options.congestion
  const congestionWeight = options.congestionWeight ?? 0
  const useCongestion = congestionWeight > 0 && congestion !== undefined && congestion.size > 0

  // The cost of ONE net: the half-perimeter of its bounding box (+ any congestion penalty over the rows and
  // columns that box spans). Factoring this out is what lets a move re-score only the nets it can change.
  const netCost = (cn: ClusterNet): number => {
    const ids = cn.driver === undefined ? cn.consumers : [cn.driver, ...cn.consumers]
    if (ids.length < 2) return 0
    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (const id of ids) {
      const t = tileOf(id)
      if (t.x < minX) minX = t.x
      if (t.x > maxX) maxX = t.x
      if (t.y < minY) minY = t.y
      if (t.y > maxY) maxY = t.y
    }
    let c = maxX - minX + (maxY - minY)
    if (useCongestion) {
      for (let y = minY; y <= maxY; y++)
        c += congestionWeight * ((congestion as Map<string, number>).get(`chanx_${y}`) ?? 0)
      for (let x = minX; x <= maxX; x++)
        c += congestionWeight * ((congestion as Map<string, number>).get(`chany_${x}`) ?? 0)
    }
    return c
  }
  const cost = (): number => {
    let total = 0
    for (const cn of clusterNets) total += netCost(cn)
    return total
  }

  // Which nets touch each cluster — so a move re-scores only those (a cluster appearing twice in one net,
  // e.g. a feedback net, is still counted once). This map turns each move from O(all nets) into O(local nets).
  const netsOf = new Map<string, ClusterNet[]>()
  for (const cn of clusterNets) {
    const ids = cn.driver === undefined ? cn.consumers : [cn.driver, ...cn.consumers]
    const seen = new Set<string>()
    for (const id of ids) {
      if (seen.has(id)) continue
      seen.add(id)
      const arr = netsOf.get(id)
      if (arr) arr.push(cn)
      else netsOf.set(id, [cn])
    }
  }

  const placementOf = (): Placement => {
    const p: Placement = new Map()
    for (const [id, idx] of pos) p.set(id, { ...(tiles[idx] as { x: number; y: number }) })
    return p
  }

  const initialHpwl = cost()
  // Nothing to optimize with 0/1 movable clusters or a single tile.
  if (n <= 1 || tiles.length <= 1) {
    return { fits, placement: placementOf(), hpwl: initialHpwl, initialHpwl }
  }

  const rng = makeRng(options.seed ?? 1)
  const cooling = options.cooling ?? 0.99
  const moves = options.moves ?? Math.max(500, clusters.length * tiles.length * 20)
  const movableIds = clusters.slice(0, n).map((c) => c.id)
  let current = initialHpwl
  let temperature = Math.max(1, initialHpwl)
  // The annealer accepts uphill moves and may end on a worse state than it passed through, so we return the
  // BEST placement SEEN, not the final one. The initial placement is best-seen at step 0, so the returned
  // hpwl is ≤ initialHpwl unconditionally — under any cooling/move schedule, never a placement worse than
  // doing nothing.
  let bestCost = initialHpwl
  let bestPos = new Map(pos)

  // One move: relocate a random cluster to a random tile — swapping with its occupant if any. Only the nets
  // touching the moved (and displaced) clusters can change, so we score the DELTA over just those nets, not
  // the whole design — the EXACT same accept/reject decision the full recompute made (byte-identical results),
  // but O(local) per move instead of O(all nets). That drops the annealer from O(n³) to O(n²).
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)] as T
  for (let m = 0; m < moves; m++) {
    const id = pick(movableIds)
    const from = pos.get(id) as number
    const to = Math.floor(rng() * tiles.length)
    if (to === from) continue
    const other = occupant[to] as string | null // `to` is in-bounds, so never undefined
    const affected = new Set<ClusterNet>(netsOf.get(id) ?? [])
    if (other !== null) for (const cn of netsOf.get(other) ?? []) affected.add(cn)
    let before = 0
    for (const cn of affected) before += netCost(cn)
    // apply
    pos.set(id, to)
    occupant[to] = id
    occupant[from] = other
    if (other !== null) pos.set(other, from)
    let after = 0
    for (const cn of affected) after += netCost(cn)
    const delta = after - before
    if (delta <= 0 || rng() < Math.exp(-delta / temperature)) {
      current += delta
      if (current < bestCost) {
        bestCost = current
        bestPos = new Map(pos)
      }
    } else {
      // revert
      pos.set(id, from)
      occupant[from] = id
      occupant[to] = other
      if (other !== null) pos.set(other, to)
    }
    temperature *= cooling
  }

  // Restore the best-seen placement and report its cost.
  pos.clear()
  for (const [id, idx] of bestPos) pos.set(id, idx)
  return { fits, placement: placementOf(), hpwl: bestCost, initialHpwl }
}

export type ExtractedRouting = {
  /** internal LUT→LUT nets to route (source `src_x_y` → sink `ipin_x_y_p`s). Primary-input nets are NOT here. */
  nets: RouteNet[]
  /** every LUT as a PlacedLut for bridgeToSim: output = its tile's `src`, inputs = ipins (internal) or PI net names. */
  placedLuts: PlacedLut[]
  /** logical net → the RRG `src` node that drives it — the node to READ a design output on. */
  netDriverNode: Map<string, string>
  /** logical nets driven by nothing (block inputs): drive these directly (their own node id). */
  primaryInputs: string[]
}

/**
 * Turn a placement into physical routing: RouteNets for the router, PlacedLuts for the sim bridge, the node to
 * read each driven net on, and the primary-input nets to drive. A LUT input driven by another LUT is routed
 * (a RouteNet to a distinct ipin); a primary-input net is passed through by name for the caller to drive.
 */
export function extractRouting(
  clusters: readonly Cluster[],
  placement: Placement,
): ExtractedRouting {
  const driverOf = new Map<string, string>() // net → cluster id that drives it
  for (const c of clusters) for (const lut of c.luts) driverOf.set(lut.output, c.id)
  // A cluster missing from the placement means a partial (`fits:false`) placement — extracting it would put
  // several LUTs on tile (0,0) and short distinct nets together. Fail loudly instead of shipping that circuit.
  const tileOf = (clusterId: string): { x: number; y: number } => {
    const t = placement.get(clusterId)
    if (t === undefined)
      throw new Error(
        `extractRouting: cluster ${clusterId} is not placed (pass a complete placeClusters result where fits === true)`,
      )
    return t
  }

  const netDriverNode = new Map<string, string>()
  for (const c of clusters) {
    const t = tileOf(c.id)
    for (const lut of c.luts) netDriverNode.set(lut.output, `src_${t.x}_${t.y}`)
  }

  const nets = new Map<string, RouteNet>()
  const primaryInputs = new Set<string>()
  const placedLuts: PlacedLut[] = []
  for (const c of clusters) {
    const t = tileOf(c.id)
    for (const lut of c.luts) {
      const inputs: string[] = []
      lut.inputs.forEach((w, p) => {
        const driverCluster = driverOf.get(w)
        if (driverCluster === undefined) {
          inputs.push(w) // primary input — driven directly by name
          primaryInputs.add(w)
          return
        }
        const ipin = `ipin_${t.x}_${t.y}_${p}` // a distinct input pin per input position
        inputs.push(ipin)
        const src = netDriverNode.get(w) as string
        const rn = nets.get(w) ?? { id: w, source: src, sinks: [] }
        rn.sinks.push(ipin)
        nets.set(w, rn)
      })
      placedLuts.push({ config: lut.config, inputs, output: `src_${t.x}_${t.y}` })
    }
  }

  return {
    nets: [...nets.values()],
    placedLuts,
    netDriverNode,
    primaryInputs: [...primaryInputs],
  }
}

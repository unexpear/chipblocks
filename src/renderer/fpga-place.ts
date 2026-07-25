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
 * so shrinking it makes the router's job easier and the design more routable. It returns the BEST placement
 * seen across the anneal, not the final (possibly uphill) state, so the result is never worse than the initial
 * placement under any schedule. A seeded PRNG makes every placement reproducible (deterministic given its seed).
 *
 * The default schedule is VPR's VPlace (Betz & Rose): ~10·N^(4/3) moves per temperature level, with BOTH the
 * temperature and a range limiter adapting to the measured acceptance rate α each level. The cooling factor
 * γ(α) has four bands (see `coolingGamma`): cool fast while far too hot (α > 0.96 ⇒ ×0.5), ease off in the
 * productive band (×0.9 then ×0.95), and cool faster again once nearly frozen (α ≤ 0.15 ⇒ ×0.8); the move
 * window shrinks toward α ≈ 0.44 so the low-temperature phase makes LOCAL swaps, not random long-distance ones.
 * The number of levels is set by the schedule (∝ log N), not by N, so the total move count grows ~N^(4/3)·log N
 * rather than N·tiles.
 *
 * The robust, load-bearing win is SCALING: the adaptive schedule reaches comparable-or-better wirelength using
 * far fewer moves, which is what turns the annealer from O(n³) into ~O(N^1.5). On wirelength specifically the
 * result is design-dependent — on larger, connectivity-rich designs (chains, meshes with room to spread) it is
 * typically ~10–25% shorter than the same placer run as a long fixed geometric anneal (a test pins that the
 * default beats that fixed anneal on a 60-LUT chain and a 7×7 mesh), while on small or tightly-packed designs
 * the two are comparable and it can occasionally be marginally worse. (Passing an explicit `moves` uses that
 * simple fixed geometric schedule instead — for tests/callers that want a specific budget.)
 *
 * Cost: each move re-scores only the nets it can change — an EXACT incremental Δ over the nets touching the
 * moved (and displaced) clusters (via `netsOf` + a version-stamped, allocation-free affected list), not a full
 * HPWL recompute. It is byte-identical to the full recompute (a test recomputes the returned HPWL from scratch
 * to prove it), so each move is O(local) not O(all nets). Net effect vs the original: O(n³) → ~O(N^1.5), and
 * better wirelength. (A single very-high-fanout net still costs O(fanout) per move it touches; and the hot path
 * is Map-lookup bound, so an integer-index refactor would give a further constant-factor speedup.)
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
  /** The placement COST of the returned placement, and of the initial (pre-anneal) placement — so a test can
   *  see SA improved it. With no congestion (the default) this is pure HPWL; when a `congestion` map + a
   *  nonzero `congestionWeight` are supplied it is the congestion-AUGMENTED anneal cost (HPWL + Σ
   *  congestionWeight·penalty over the bounding box's rows/cols) — the objective the annealer actually
   *  minimized, NOT pure half-perimeter wirelength. */
  hpwl: number
  initialHpwl: number
}

export type PlaceOptions = {
  /** PRNG seed — same seed ⇒ same placement (the annealer is deterministic). */
  seed?: number
  /** if set, use a FIXED schedule of exactly this many moves (geometric cooling). Omit for the default
   *  adaptive VPR schedule (better wirelength; move count set by acceptance, ~N^(4/3)·log N total). */
  moves?: number
  /** geometric cooling factor per move — only used with an explicit `moves` (default 0.99). */
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

/**
 * VPR VPlace temperature-cooling factor γ(α): how much to multiply the temperature by after a level, chosen
 * from the measured acceptance rate α (Betz & Rose, "VPR"). Cool fast when far too hot (α > 0.96 ⇒ ×0.5),
 * ease off through the productive band (×0.9 then ×0.95), and cool faster again once nearly frozen
 * (α ≤ 0.15 ⇒ ×0.8). Every band is < 1, so the schedule always cools (which is what bounds the level count).
 * Exported and factored out so the exact VPR band table is a guarded invariant: scrambling it barely moves
 * final wirelength (best-seen + range-limiting mask it), so no placement-quality test catches a broken γ — a
 * direct unit test on this function does.
 */
export function coolingGamma(alpha: number): number {
  if (alpha > 0.96) return 0.5
  if (alpha > 0.8) return 0.9
  if (alpha > 0.15) return 0.95
  return 0.8
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

  // Which net INDICES touch each cluster — so a move re-scores only those (a cluster appearing twice in one
  // net, e.g. a feedback net, is still counted once). Turns each move from O(all nets) into O(local nets).
  const netsOf = new Map<string, number[]>()
  clusterNets.forEach((cn, ni) => {
    const ids = cn.driver === undefined ? cn.consumers : [cn.driver, ...cn.consumers]
    const seen = new Set<string>()
    for (const id of ids) {
      if (seen.has(id)) continue
      seen.add(id)
      const arr = netsOf.get(id)
      if (arr) arr.push(ni)
      else netsOf.set(id, [ni])
    }
  })
  // Reusable buffers to score a move's affected nets with NO per-move allocation: a version-stamp dedups the
  // two clusters' net-index lists into `affectedList` in O(local) without building a Set each move.
  const stamp = new Int32Array(clusterNets.length)
  let stampVer = 0
  const affectedList: number[] = []

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
  const movableIds = clusters.slice(0, n).map((c) => c.id)
  let current = initialHpwl
  // The annealer accepts uphill moves and may end on a worse state than it passed through, so we return the
  // BEST placement SEEN, not the final one. The initial placement is best-seen at step 0, so the returned
  // hpwl is ≤ initialHpwl unconditionally — under any schedule, never a placement worse than doing nothing.
  let bestCost = initialHpwl
  let bestPos = new Map(pos)

  // Flat coordinate → tile-index grid (−1 where there is no logic tile), for range-limited moves: a target
  // tile is drawn from a window (±rlim) around the source tile, so the low-temperature phase makes local swaps
  // rather than random long-distance ones. A plain Int32Array lookup keeps the hot path allocation-free.
  const gw = device.gridWidth
  const tileAt = new Int32Array(gw * device.gridHeight).fill(-1)
  tiles.forEach((t, i) => {
    tileAt[t.y * gw + t.x] = i
  })
  const maxDim = Math.max(gw, device.gridHeight)
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)] as T

  // One move within range `rlim` at temperature `T`. Scores the DELTA over only the nets the moved (and
  // displaced) clusters touch — the EXACT change a full HPWL recompute would see (a test recomputes the
  // returned cost from scratch to prove it), but O(local) not O(all nets). Best-seen is updated on accept.
  const attemptMove = (rlim: number, T: number): 'accepted' | 'other' => {
    const id = pick(movableIds)
    const from = pos.get(id) as number
    const ft = tiles[from] as { x: number; y: number }
    const off = (): number => Math.floor(rng() * (2 * rlim + 1)) - rlim
    const nx = Math.min(gw - 1, Math.max(0, ft.x + off()))
    const ny = Math.min(device.gridHeight - 1, Math.max(0, ft.y + off()))
    const to = tileAt[ny * gw + nx] as number
    if (to < 0 || to === from) return 'other'
    const other = occupant[to] as string | null
    stampVer++
    affectedList.length = 0
    for (const ni of netsOf.get(id) ?? [])
      if (stamp[ni] !== stampVer) {
        stamp[ni] = stampVer
        affectedList.push(ni)
      }
    if (other !== null)
      for (const ni of netsOf.get(other) ?? [])
        if (stamp[ni] !== stampVer) {
          stamp[ni] = stampVer
          affectedList.push(ni)
        }
    let before = 0
    for (const ni of affectedList) before += netCost(clusterNets[ni] as ClusterNet)
    pos.set(id, to)
    occupant[to] = id
    occupant[from] = other
    if (other !== null) pos.set(other, from)
    let after = 0
    for (const ni of affectedList) after += netCost(clusterNets[ni] as ClusterNet)
    const delta = after - before
    if (delta <= 0 || rng() < Math.exp(-delta / T)) {
      current += delta
      if (current < bestCost) {
        bestCost = current
        bestPos = new Map(pos)
      }
      return 'accepted'
    }
    pos.set(id, from) // revert
    occupant[from] = id
    occupant[to] = other
    if (other !== null) pos.set(other, to)
    return 'other'
  }

  if (options.moves !== undefined) {
    // Explicit fixed schedule (a caller/test asking for a specific budget): `moves` moves over a
    // geometrically-cooled temperature. Best-seen still guarantees hpwl ≤ initialHpwl. Clamp the budget to a
    // finite non-negative integer so Termination holds under ANY input: a stray Infinity can't spin the loop
    // forever, and a NaN/negative degrades to "no moves" (returns the initial placement) rather than looping
    // on undefined behaviour. (The default adaptive schedule already has its own maxLevels backstop.)
    const budget =
      Number.isFinite(options.moves) && options.moves > 0 ? Math.floor(options.moves) : 0
    const cooling = options.cooling ?? 0.99
    let temperature = Math.max(1, initialHpwl)
    for (let m = 0; m < budget; m++) {
      attemptMove(maxDim, temperature)
      temperature *= cooling
    }
  } else {
    // Adaptive VPR schedule (the default): ~10·N^(4/3) moves per temperature level, and BOTH the temperature
    // and the range limiter adapt to the measured acceptance rate α — cool fast when α is high (too hot),
    // dwell in the productive band, and shrink the move window toward α ≈ 0.44. The number of levels is set by
    // the schedule, not N, so total moves grow ~N^(4/3) (vs N·tiles for the fixed budget) at full-anneal
    // quality — the asymptotic win without the quality loss a naive budget cut caused.
    const movesPerTemp = Math.max(1, Math.round(10 * n ** (4 / 3)))
    let numNets = 0
    for (const cn of clusterNets)
      if ((cn.driver === undefined ? 0 : 1) + cn.consumers.length >= 2) numNets++
    const exitT = 0.005 * (Math.max(1, initialHpwl) / Math.max(1, numNets))
    let temperature = Math.max(1, initialHpwl)
    let rlim = maxDim
    const maxLevels = 500 // backstop; γ ≤ 0.95 < 1 always cools, so this is only a safety cap
    for (let level = 0; level < maxLevels && temperature > exitT; level++) {
      let accepts = 0
      for (let i = 0; i < movesPerTemp; i++)
        if (attemptMove(rlim, temperature) === 'accepted') accepts++
      const alpha = accepts / movesPerTemp
      temperature *= coolingGamma(alpha)
      rlim = Math.max(1, Math.min(maxDim, Math.round(rlim * (1 - 0.44 + alpha))))
    }
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

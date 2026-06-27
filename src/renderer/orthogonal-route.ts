/**
 * Orthogonal wire router — the geometry-aware auto-router engine. Given two pin positions, the
 * direction each wire leaves its pin (perpendicular to the part's edge), and the part boxes to keep
 * clear, it returns straight HORIZONTAL / VERTICAL waypoints — breadboard-style, routed AROUND the
 * parts instead of cutting diagonally across them, with a per-wire LANE offset so wires sharing a
 * channel run parallel instead of on top of each other.
 *
 * Pure + deterministic (no rendering, no React) so it can drive the descend view, the canvas, and the
 * physics alike: the routed path's length is the SAME length the wire-resistance math (R = ρL/A)
 * measures, so the picture and the numbers can never disagree.
 *
 * A wire NEVER crosses a part: it first tries the natural shapes (a straight run, an L, a channel Z, a
 * detour over/under or left/right of the obstacles) and takes the first that stays clear; if every one
 * is blocked it falls back to `gridRouteAround` — A* on the Hanan grid — which is GUARANTEED to find a
 * part-free route if one exists. Only when even that can't (truly boxed in / too dense to search) does
 * it return the least-bad channel route rather than failing outright.
 */

export type Pt = { x: number; y: number }
export type Box = { x: number; y: number; w: number; h: number }
export type Dir = 'left' | 'right' | 'up' | 'down'

const STEP: Record<Dir, Pt> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
}

const isHorizontal = (d: Dir) => d === 'left' || d === 'right'

/** Does the axis-aligned segment a→b pass through a box's INTERIOR? (touching an edge doesn't count,
 *  so a wire may run flush along a part without being flagged as cutting through it). */
export function segmentHitsBox(a: Pt, b: Pt, box: Box): boolean {
  const x0 = box.x
  const x1 = box.x + box.w
  const y0 = box.y
  const y1 = box.y + box.h
  if (a.y === b.y) {
    if (a.y <= y0 || a.y >= y1) return false
    const lo = Math.min(a.x, b.x)
    const hi = Math.max(a.x, b.x)
    return lo < x1 && hi > x0
  }
  if (a.x === b.x) {
    if (a.x <= x0 || a.x >= x1) return false
    const lo = Math.min(a.y, b.y)
    const hi = Math.max(a.y, b.y)
    return lo < y1 && hi > y0
  }
  return false // diagonal — the router never emits these
}

function pathHitsAny(points: Pt[], obstacles: Box[]): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i] as Pt
    const b = points[i + 1] as Pt
    for (const box of obstacles) if (segmentHitsBox(a, b, box)) return true
  }
  return false
}

/**
 * The HARD rule "a wire never crosses a part" — a guaranteed obstacle-avoiding orthogonal route from
 * `a` to `b`, found by A* on the Hanan grid (the lattice of lines through every obstacle edge, inset by
 * `margin`, plus the two endpoints). Grid moves between adjacent lines are kept only if the segment
 * doesn't cut a part's interior, so any path A* returns is part-free by construction; ties break toward
 * fewer corners. Returns [a, …corners, b], or null if even this can't get around (fully boxed in) or the
 * grid is too large to search cheaply (the caller then falls back to the heuristic). Exported for tests.
 */
export function gridRouteAround(
  a: Pt,
  b: Pt,
  obstacles: Box[],
  margin = 12,
  maxNodes = 4096,
): Pt[] | null {
  if (a.x === b.x && a.y === b.y) return [a]
  const xsSet = new Set<number>([a.x, b.x])
  const ysSet = new Set<number>([a.y, b.y])
  for (const o of obstacles) {
    xsSet.add(o.x - margin)
    xsSet.add(o.x + o.w + margin)
    ysSet.add(o.y - margin)
    ysSet.add(o.y + o.h + margin)
  }
  const xs = [...xsSet].sort((p, q) => p - q)
  const ys = [...ysSet].sort((p, q) => p - q)
  if (xs.length * ys.length > maxNodes) return null // too dense to A* cheaply — let the caller fall back
  const startIx = xs.indexOf(a.x)
  const startIy = ys.indexOf(a.y)
  const goalIx = xs.indexOf(b.x)
  const goalIy = ys.indexOf(b.y)
  const key = (ix: number, iy: number) => iy * xs.length + ix
  const at = (ix: number, iy: number): Pt => ({ x: xs[ix] as number, y: ys[iy] as number })
  const clear = (p: Pt, q: Pt) => !obstacles.some((o) => segmentHitsBox(p, q, o))
  const h = (ix: number, iy: number) =>
    Math.abs((xs[ix] as number) - b.x) + Math.abs((ys[iy] as number) - b.y)
  const startKey = key(startIx, startIy)
  const goalKey = key(goalIx, goalIy)
  const gScore = new Map<number, number>([[startKey, 0]])
  const cameFrom = new Map<number, number>()
  const open: { ix: number; iy: number; f: number }[] = [
    { ix: startIx, iy: startIy, f: h(startIx, startIy) },
  ]
  while (open.length > 0) {
    let best = 0
    for (let i = 1; i < open.length; i++)
      if ((open[i] as { f: number }).f < (open[best] as { f: number }).f) best = i
    const cur = open.splice(best, 1)[0] as { ix: number; iy: number }
    const ck = key(cur.ix, cur.iy)
    if (ck === goalKey) break
    const cg = gScore.get(ck) ?? Number.POSITIVE_INFINITY
    const cp = at(cur.ix, cur.iy)
    const steps: [number, number][] = [
      [cur.ix - 1, cur.iy],
      [cur.ix + 1, cur.iy],
      [cur.ix, cur.iy - 1],
      [cur.ix, cur.iy + 1],
    ]
    for (const [nx, ny] of steps) {
      if (nx < 0 || nx >= xs.length || ny < 0 || ny >= ys.length) continue
      const np = at(nx, ny)
      if (!clear(cp, np)) continue
      const tentative = cg + Math.abs(np.x - cp.x) + Math.abs(np.y - cp.y)
      const nk = key(nx, ny)
      if (tentative < (gScore.get(nk) ?? Number.POSITIVE_INFINITY)) {
        gScore.set(nk, tentative)
        cameFrom.set(nk, ck)
        open.push({ ix: nx, iy: ny, f: tentative + h(nx, ny) })
      }
    }
  }
  if (goalKey !== startKey && !cameFrom.has(goalKey)) return null
  const path: Pt[] = []
  let k = goalKey
  while (k !== startKey) {
    path.unshift(at(k % xs.length, Math.floor(k / xs.length)))
    const prev = cameFrom.get(k)
    if (prev === undefined) return null
    k = prev
  }
  path.unshift(a)
  return path
}

/** Collapse coincident + collinear points so the path is the minimal set of corners. */
export function simplifyPath(points: Pt[]): Pt[] {
  const dedup: Pt[] = []
  for (const p of points) {
    const last = dedup[dedup.length - 1]
    if (last && last.x === p.x && last.y === p.y) continue
    dedup.push({ x: p.x, y: p.y })
  }
  const out: Pt[] = []
  for (let i = 0; i < dedup.length; i++) {
    const prev = out[out.length - 1]
    const cur = dedup[i] as Pt
    const next = dedup[i + 1]
    if (
      prev &&
      next &&
      ((prev.x === cur.x && cur.x === next.x) || (prev.y === cur.y && cur.y === next.y))
    ) {
      continue // cur is on the straight line prev→next
    }
    out.push(cur)
  }
  return out
}

/** Do two axis-aligned segments RUN ALONG each other — collinear (same row/column within `tol`) with
 *  overlapping extent? That's two wires sharing the same physical track (not merely crossing). */
function segmentsOverlap(a1: Pt, a2: Pt, b1: Pt, b2: Pt, tol: number): boolean {
  const aH = a1.y === a2.y
  const bH = b1.y === b2.y
  const aV = a1.x === a2.x
  const bV = b1.x === b2.x
  if (aH && bH && Math.abs(a1.y - b1.y) <= tol) {
    const lo = Math.max(Math.min(a1.x, a2.x), Math.min(b1.x, b2.x))
    const hi = Math.min(Math.max(a1.x, a2.x), Math.max(b1.x, b2.x))
    return hi - lo > tol
  }
  if (aV && bV && Math.abs(a1.x - b1.x) <= tol) {
    const lo = Math.max(Math.min(a1.y, a2.y), Math.min(b1.y, b2.y))
    const hi = Math.min(Math.max(a1.y, a2.y), Math.max(b1.y, b2.y))
    return hi - lo > tol
  }
  return false
}

/** Do two routed wires SHARE A TRACK anywhere — i.e. run on top of each other (within `tol`)? Used to
 *  keep wires in their own real space: a wire that would overlap an already-placed one is re-routed in
 *  the next lane until it's clear. (Crossing at a point is fine — that's a junction, not an overlap.) */
export function routesOverlap(a: Pt[], b: Pt[], tol = 4): boolean {
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < b.length - 1; j++) {
      if (segmentsOverlap(a[i] as Pt, a[i + 1] as Pt, b[j] as Pt, b[j + 1] as Pt, tol)) return true
    }
  }
  return false
}

/** Total length of an orthogonal path (px) — the geometry the wire-resistance math measures. */
export function pathLength(points: Pt[]): number {
  let total = 0
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i] as Pt
    const b = points[i + 1] as Pt
    total += Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
  }
  return total
}

/**
 * Route an orthogonal wire from `from` (leaving in `fromDir`) to `to` (entering against `toDir`),
 * keeping clear of `obstacles`. Returns the INTERMEDIATE waypoints (the caller's edge supplies the two
 * endpoints); concatenate as [from, ...waypoints, to]. `lane` shifts shared channels apart.
 */
export function orthogonalRoute(
  from: Pt,
  fromDir: Dir,
  to: Pt,
  toDir: Dir,
  obstacles: Box[],
  opts: { stub?: number; lane?: number; laneGap?: number; margin?: number; selfBoxes?: Box[] } = {},
): Pt[] {
  const stub = opts.stub ?? 14
  const off = (opts.lane ?? 0) * (opts.laneGap ?? 8)
  const margin = opts.margin ?? 12
  // The wire BODY must also stay out of its own two parts (source + target). A wire connects only at
  // their pins — it must never cut across their bodies — so the body avoids every box INCLUDING those
  // two; only the short perpendicular pin stubs (which leave each part outward) may touch them. Skipping
  // this is what let a wrap-around wire (e.g. an SRAM cell's feedback leg) cut straight back through its
  // own inverters.
  const selfBoxes = opts.selfBoxes ?? []
  const bodyObstacles = selfBoxes.length > 0 ? [...obstacles, ...selfBoxes] : obstacles
  // Leave each pin perpendicular to its edge by a short stub, so the wire meets the part squarely.
  const a: Pt = { x: from.x + STEP[fromDir].x * stub, y: from.y + STEP[fromDir].y * stub }
  const b: Pt = { x: to.x + STEP[toDir].x * stub, y: to.y + STEP[toDir].y * stub }
  const midX = (a.x + b.x) / 2 + off
  const midY = (a.y + b.y) / 2 + off

  const aboveY = Math.min(a.y, b.y, ...bodyObstacles.map((o) => o.y)) - margin - off
  const belowY = Math.max(a.y, b.y, ...bodyObstacles.map((o) => o.y + o.h)) + margin + off
  const leftX = Math.min(a.x, b.x, ...bodyObstacles.map((o) => o.x)) - margin - off
  const rightX = Math.max(a.x, b.x, ...bodyObstacles.map((o) => o.x + o.w)) + margin + off

  // Candidates, cheapest (fewest corners) first. The detours route fully around the obstacle field.
  const candidates: Pt[][] = isHorizontal(fromDir)
    ? [
        [a, { x: b.x, y: a.y }, b], // L
        [a, { x: midX, y: a.y }, { x: midX, y: b.y }, b], // Z through a vertical channel
        [a, { x: a.x, y: aboveY }, { x: b.x, y: aboveY }, b], // detour over the top
        [a, { x: a.x, y: belowY }, { x: b.x, y: belowY }, b], // detour under the bottom
      ]
    : [
        [a, { x: a.x, y: b.y }, b], // L
        [a, { x: a.x, y: midY }, { x: b.x, y: midY }, b], // Z through a horizontal channel
        [a, { x: leftX, y: a.y }, { x: leftX, y: b.y }, b], // detour around the left
        [a, { x: rightX, y: a.y }, { x: rightX, y: b.y }, b], // detour around the right
      ]

  // The pin stubs (from→a, b→to) leave each part perpendicular, so they only need to clear OTHER parts;
  // the wire body (a…b) must clear every box, including its own two endpoints.
  const stubsClear = !pathHitsAny([from, a], obstacles) && !pathHitsAny([b, to], obstacles)
  for (const mid of candidates) {
    if (stubsClear && !pathHitsAny(mid, bodyObstacles)) return simplifyPath(mid)
  }
  // None of the cheap shapes stayed clear. A wire must NEVER cross a part, so find a guaranteed
  // part-free route around everything (A* on the Hanan grid). Only if even that fails (truly boxed in,
  // or too dense to search) do we fall back to the least-bad channel.
  const around = gridRouteAround(a, b, bodyObstacles, margin + off)
  if (around && stubsClear && !pathHitsAny(around, bodyObstacles)) return simplifyPath(around)
  return simplifyPath(candidates[1] as Pt[])
}

export type WireReq = { id: string; from: Pt; to: Pt }

/**
 * GLOBAL router — routes a whole BATCH of wires, then NUDGES the parallel runs apart (per the orthogonal
 * connector routing of AUTO-ROUTER-RESEARCH.md). Each wire is routed on its OWN bounded Hanan VISIBILITY
 * lattice — the lines through nearby part edges + the two pins, within the wire's bounding box + a margin
 * — with a HEAVY bend penalty, so runs come out long and straight with few corners (not the stair-steps a
 * uniform grid gives) and never cross a part. Spreading the bundles is nudgeRoutes' job, not the A*'s.
 *
 * A bounded lattice is ~100-200 nodes even on a dense board, so the linear-scan A* stays fast (~35ms for
 * ~260 wires) without a heap. Safety: a wall-clock guard + per-wire expansion cap bound the worst case; a
 * strict fallback chain (margin-double → full-board gridRouteAround → box-checked L) NEVER emits a raw
 * diagonal that could cut a part; and after nudging, any path pushed through a part reverts to its routed
 * (part-free) version. If the time budget blows, it returns the wires routed SO FAR (a partial map); a
 * wire that's truly boxed in gets an empty path. Either way net-edge fills any wire missing a good global
 * path with the strict per-edge router — so the whole batch is never thrown away over a few hard wires.
 */
export function routeAllWires(
  wires: WireReq[],
  obstacles: Box[],
  opts: {
    grid?: number
    clearance?: number
    bendCost?: number
    bbMargin?: number
    maxNodes?: number
    timeBudgetMs?: number
  } = {},
): Map<string, Pt[]> {
  const out = new Map<string, Pt[]>()
  if (wires.length === 0) return out
  const G = opts.grid ?? 16
  const clearance = opts.clearance ?? 10
  const bendCost = opts.bendCost ?? G * 8 // HEAVY — prefer one long run over two short ones (the clean look)
  const bbMargin0 = opts.bbMargin ?? 80
  const maxNodes = opts.maxNodes ?? 8192
  const timeBudget = opts.timeBudgetMs ?? 800
  const nowMs = (): number =>
    typeof performance !== 'undefined' && performance.now ? performance.now() : 0
  const t0 = nowMs()
  const DX = [1, -1, 0, 0] // dir codes: 0=right 1=left 2=down 3=up 4=start
  const DY = [0, 0, 1, -1]

  // Route ONE wire on its OWN bounded Hanan visibility lattice (the lines through nearby part edges + the
  // two pins, within the wire's bbox + margin). Heavy bend penalty → long straight runs, few corners. Only
  // LOCAL obstacles are checked (the path lives in the bbox); the caller re-validates against all of them.
  const routeBounded = (from: Pt, to: Pt, bbMargin: number): Pt[] | null => {
    const loX = Math.min(from.x, to.x) - bbMargin
    const hiX = Math.max(from.x, to.x) + bbMargin
    const loY = Math.min(from.y, to.y) - bbMargin
    const hiY = Math.max(from.y, to.y) + bbMargin
    const local = obstacles.filter(
      (o) =>
        o.x - clearance < hiX &&
        o.x + o.w + clearance > loX &&
        o.y - clearance < hiY &&
        o.y + o.h + clearance > loY,
    )
    const cX = (x: number) => Math.round(Math.min(hiX, Math.max(loX, x)))
    const cY = (y: number) => Math.round(Math.min(hiY, Math.max(loY, y)))
    const xsSet = new Set<number>([cX(from.x), cX(to.x)])
    const ysSet = new Set<number>([cY(from.y), cY(to.y)])
    for (const o of local) {
      xsSet.add(cX(o.x - clearance))
      xsSet.add(cX(o.x + o.w + clearance))
      ysSet.add(cY(o.y - clearance))
      ysSet.add(cY(o.y + o.h + clearance))
    }
    const xs = [...xsSet].sort((p, q) => p - q)
    const ys = [...ysSet].sort((p, q) => p - q)
    const W = xs.length
    const H = ys.length
    if (W * H > maxNodes) return null
    const six = xs.indexOf(cX(from.x))
    const siy = ys.indexOf(cY(from.y))
    const tix = xs.indexOf(cX(to.x))
    const tiy = ys.indexOf(cY(to.y))
    if (six < 0 || siy < 0 || tix < 0 || tiy < 0) return null
    const at = (ix: number, iy: number): Pt => ({ x: xs[ix] as number, y: ys[iy] as number })
    const clear = (p: Pt, q: Pt) => !local.some((o) => segmentHitsBox(p, q, o))
    const tgt = at(tix, tiy)
    const skey = (ix: number, iy: number, d: number) => (iy * W + ix) * 5 + d
    const startK = skey(six, siy, 4)
    const gScore = new Map<number, number>([[startK, 0]])
    const came = new Map<number, number>()
    const hh = (p: Pt) => Math.abs(p.x - tgt.x) + Math.abs(p.y - tgt.y)
    const open: { k: number; ix: number; iy: number; d: number; f: number }[] = [
      { k: startK, ix: six, iy: siy, d: 4, f: hh(at(six, siy)) },
    ]
    let goalK = -1
    let expansions = 0
    while (open.length > 0) {
      if (++expansions > 20000) return null // one hard wire can't stall the batch
      let b = 0
      for (let i = 1; i < open.length; i++)
        if ((open[i] as { f: number }).f < (open[b] as { f: number }).f) b = i
      const cur = open.splice(b, 1)[0] as { k: number; ix: number; iy: number; d: number }
      if (cur.ix === tix && cur.iy === tiy) {
        goalK = cur.k
        break
      }
      const cg = gScore.get(cur.k) ?? Number.POSITIVE_INFINITY
      const cp = at(cur.ix, cur.iy)
      for (let di = 0; di < 4; di++) {
        const nx = cur.ix + (DX[di] as number)
        const ny = cur.iy + (DY[di] as number)
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue
        const np = at(nx, ny)
        if (!clear(cp, np)) continue
        const bend = cur.d !== 4 && cur.d !== di ? bendCost : 0
        const tentative = cg + Math.abs(np.x - cp.x) + Math.abs(np.y - cp.y) + bend
        const nk = skey(nx, ny, di)
        if (tentative < (gScore.get(nk) ?? Number.POSITIVE_INFINITY)) {
          gScore.set(nk, tentative)
          came.set(nk, cur.k)
          open.push({ k: nk, ix: nx, iy: ny, d: di, f: tentative + hh(np) })
        }
      }
    }
    if (goalK < 0) return null
    const cells: Pt[] = []
    let k = goalK
    while (k !== startK) {
      const cell = Math.floor(k / 5)
      cells.unshift(at(cell % W, Math.floor(cell / W)))
      const prev = came.get(k)
      if (prev === undefined) return null
      k = prev
    }
    cells.unshift(at(six, siy))
    // Stitch the EXACT pins back on + rectilinearize any snap diagonal so the wire meets the real pins.
    const raw = [from, ...cells, to]
    const rect: Pt[] = []
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i] as Pt
      rect.push(c)
      const n = raw[i + 1]
      if (n && c.x !== n.x && c.y !== n.y) rect.push({ x: n.x, y: c.y })
    }
    return simplifyPath(rect)
  }

  // Strict fallback chain — NEVER a raw [from,to] (that could be a diagonal cutting through a part).
  const routeFallback = (from: Pt, to: Pt): Pt[] => {
    for (const m of [bbMargin0 * 2, bbMargin0 * 4]) {
      const p = routeBounded(from, to, m)
      if (p && !pathHitsAny(p, obstacles)) return p
    }
    // Full-board Hanan A* — a HIGH cap (1M) because this runs only in the rare fallback; the old 16384
    // cap was below a dense board's (~2N)² grid, so this "guaranteed part-free" rung went dead exactly
    // when needed and hard wires silently degraded to part-cutting Ls.
    const around = gridRouteAround(from, to, obstacles, clearance, 1_000_000)
    if (around) {
      const s = simplifyPath(around)
      if (!pathHitsAny(s, obstacles)) return s
    }
    const lh = simplifyPath([from, { x: to.x, y: from.y }, to])
    if (!pathHitsAny(lh, obstacles)) return lh
    const lv = simplifyPath([from, { x: from.x, y: to.y }, to])
    if (!pathHitsAny(lv, obstacles)) return lv
    // Truly boxed in (e.g. a pin strictly inside another part). Return an EMPTY path — net-edge reads that
    // as "route me per-wire" and falls back to the strict per-edge router. We NEVER return a path that
    // cuts a part, not even an orthogonal one.
    return []
  }

  // Shortest wires first: local hops claim their lanes before long hauls sweep the board.
  const order = [...wires].sort(
    (a, b) =>
      Math.abs(a.from.x - a.to.x) +
      Math.abs(a.from.y - a.to.y) -
      (Math.abs(b.from.x - b.to.x) + Math.abs(b.from.y - b.to.y)),
  )
  for (const w of order) {
    if (nowMs() - t0 > timeBudget) break // budget blown → keep the wires already routed; net-edge fills the rest per-wire
    let path = routeBounded(w.from, w.to, bbMargin0)
    if (!path || pathHitsAny(path, obstacles)) path = routeFallback(w.from, w.to)
    out.set(w.id, path)
  }

  // Neatness: spread the parallel runs sharing a channel onto evenly-spaced tracks. Keep a pre-nudge copy
  // so a path the (obstacle-unaware) nudge pushes through a part is reverted to its routed, part-free run.
  const ids = [...out.keys()]
  const preNudge = ids.map((id) => out.get(id) ?? [])
  const nudged = nudgeRoutes(preNudge, { gap: Math.max(6, Math.round(G / 2)) })
  const result = new Map<string, Pt[]>()
  ids.forEach((wid, i) => {
    const np = nudged[i] ?? (preNudge[i] as Pt[])
    result.set(wid, pathHitsAny(np, obstacles) ? (preNudge[i] as Pt[]) : np)
  })
  return result
}

type NudgeSeg = { path: number; i: number; coord: number; lo: number; hi: number }

/**
 * NUDGING pass — the neatness step from orthogonal connector routing (see AUTO-ROUTER-RESEARCH.md). Takes
 * a batch of already-routed orthogonal paths and SPREADS the parallel runs that share a channel onto
 * evenly-spaced tracks, centered on the bundle, so wires stop stacking on top of each other (the thing
 * that makes routing read as "organized"). Only INTERIOR segments move — never the two pin endpoints —
 * and shifting a run is pure geometry: move its two corners to the new track coordinate and the
 * perpendicular connectors stretch to follow, so every path stays orthogonal. One pass per axis.
 */
export function nudgeRoutes(paths: Pt[][], opts: { gap?: number; tol?: number } = {}): Pt[][] {
  const gap = opts.gap ?? 8
  const tol = opts.tol ?? 1
  const out = paths.map((p) => p.map((pt) => ({ x: pt.x, y: pt.y })))
  // Collect the INTERIOR segments on one axis — never i=0 or the last segment (those touch the real pins).
  const collect = (horiz: boolean): NudgeSeg[] => {
    const segs: NudgeSeg[] = []
    out.forEach((p, pi) => {
      for (let i = 1; i <= p.length - 3; i++) {
        const a = p[i] as Pt
        const b = p[i + 1] as Pt
        if (horiz && a.y === b.y && a.x !== b.x)
          segs.push({ path: pi, i, coord: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) })
        else if (!horiz && a.x === b.x && a.y !== b.y)
          segs.push({ path: pi, i, coord: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) })
      }
    })
    return segs
  }
  const nudgeAxis = (horiz: boolean) => {
    const segs = collect(horiz)
    // Union-find segments that share a track (same coord within tol AND overlapping extent) into bundles.
    const parent = segs.map((_, i) => i)
    const find = (x: number): number => {
      let r = x
      while (parent[r] !== r) r = parent[r] as number
      let c = x
      while (parent[c] !== r) {
        const n = parent[c] as number
        parent[c] = r
        c = n
      }
      return r
    }
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const a = segs[i] as NudgeSeg
        const b = segs[j] as NudgeSeg
        if (Math.abs(a.coord - b.coord) <= tol && a.lo < b.hi - tol && b.lo < a.hi - tol)
          parent[find(i)] = find(j)
      }
    }
    const bundles = new Map<number, number[]>()
    segs.forEach((_, i) => {
      const r = find(i)
      const arr = bundles.get(r)
      if (arr) arr.push(i)
      else bundles.set(r, [i])
    })
    for (const idxs of bundles.values()) {
      if (idxs.length < 2) continue
      const base = idxs.reduce((s, i) => s + (segs[i] as NudgeSeg).coord, 0) / idxs.length
      idxs.sort((a, b) => (segs[a] as NudgeSeg).path - (segs[b] as NudgeSeg).path)
      idxs.forEach((idx, k) => {
        const s = segs[idx] as NudgeSeg
        const target = base + (k - (idxs.length - 1) / 2) * gap
        const p = out[s.path] as Pt[]
        const a = p[s.i] as Pt
        const b = p[s.i + 1] as Pt
        if (horiz) {
          a.y = target
          b.y = target
        } else {
          a.x = target
          b.x = target
        }
      })
    }
  }
  nudgeAxis(true)
  nudgeAxis(false)
  return out.map((p) => simplifyPath(p))
}

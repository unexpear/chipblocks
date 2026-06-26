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
export function gridRouteAround(a: Pt, b: Pt, obstacles: Box[], margin = 12): Pt[] | null {
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
  if (xs.length * ys.length > 4096) return null // too dense to A* cheaply — let the caller fall back
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
 * GLOBAL router — routes a whole BATCH of wires together on ONE shared uniform grid, so they spread into
 * parallel tracks instead of piling into the same channel (the failure of routing each wire alone, where
 * 200 wires funnel through the same gap and read as a tangle). Each wire is A* on the grid; a cell's cost
 * RISES with how many already-routed wires use it (congestion), so later wires detour into free lanes — a
 * flow-field idea from game crowd navigation. A turn cost keeps runs straight; obstacle cells are
 * hard-avoided so a wire never crosses a part. Scales by a fixed grid STEP (not the Hanan lattice, which
 * explodes on dense boards).
 *
 * Endpoints snap to the grid (pass grid-aligned points, or stitch the real pin on with a stub). Returns
 * each wire id → its waypoint path. Returns an EMPTY map if the board is too big to grid cheaply — the
 * signal for the caller to fall back to per-wire routing.
 */
export function routeAllWires(
  wires: WireReq[],
  obstacles: Box[],
  opts: {
    grid?: number
    clearance?: number
    turnCost?: number
    congestionCost?: number
    maxCells?: number
  } = {},
): Map<string, Pt[]> {
  const out = new Map<string, Pt[]>()
  if (wires.length === 0) return out
  const G = opts.grid ?? 16
  const clearance = opts.clearance ?? 10
  const turnCost = opts.turnCost ?? G * 2
  const congestionCost = opts.congestionCost ?? G * 4
  const xs: number[] = []
  const ys: number[] = []
  for (const w of wires) {
    xs.push(w.from.x, w.to.x)
    ys.push(w.from.y, w.to.y)
  }
  for (const o of obstacles) {
    xs.push(o.x - clearance, o.x + o.w + clearance)
    ys.push(o.y - clearance, o.y + o.h + clearance)
  }
  const pad = G * 2
  const minX = Math.min(...xs) - pad
  const minY = Math.min(...ys) - pad
  const cols = Math.ceil((Math.max(...xs) + pad - minX) / G) + 1
  const rows = Math.ceil((Math.max(...ys) + pad - minY) / G) + 1
  if (cols * rows > (opts.maxCells ?? 250000)) return out
  const cx = (x: number) => Math.round((x - minX) / G)
  const cy = (y: number) => Math.round((y - minY) / G)
  const ptAt = (ix: number, iy: number): Pt => ({ x: minX + ix * G, y: minY + iy * G })
  const inb = (ix: number, iy: number) => ix >= 0 && ix < cols && iy >= 0 && iy < rows
  const ci = (ix: number, iy: number) => iy * cols + ix
  const blocked = new Uint8Array(cols * rows)
  for (const o of obstacles) {
    const x0 = Math.max(0, cx(o.x - clearance))
    const x1 = Math.min(cols - 1, cx(o.x + o.w + clearance))
    const y0 = Math.max(0, cy(o.y - clearance))
    const y1 = Math.min(rows - 1, cy(o.y + o.h + clearance))
    for (let iy = y0; iy <= y1; iy++) for (let ix = x0; ix <= x1; ix++) blocked[ci(ix, iy)] = 1
  }
  const usage = new Float32Array(cols * rows)
  const DX = [1, -1, 0, 0]
  const DY = [0, 0, 1, -1]

  const routeOne = (from: Pt, to: Pt): Pt[] => {
    const sx = cx(from.x)
    const sy = cy(from.y)
    const tx = cx(to.x)
    const ty = cy(to.y)
    if (!inb(sx, sy) || !inb(tx, ty)) return [from, to]
    blocked[ci(sx, sy)] = 0
    blocked[ci(tx, ty)] = 0
    const skey = (ix: number, iy: number, d: number) => (iy * cols + ix) * 5 + d
    const startK = skey(sx, sy, 4) // d=4 = no direction yet (the start)
    const gScore = new Map<number, number>([[startK, 0]])
    const came = new Map<number, number>()
    const hMan = (ix: number, iy: number) => (Math.abs(ix - tx) + Math.abs(iy - ty)) * G
    const open: { k: number; ix: number; iy: number; d: number; f: number }[] = [
      { k: startK, ix: sx, iy: sy, d: 4, f: hMan(sx, sy) },
    ]
    let goalK = -1
    while (open.length > 0) {
      let b = 0
      for (let i = 1; i < open.length; i++)
        if ((open[i] as { f: number }).f < (open[b] as { f: number }).f) b = i
      const cur = open.splice(b, 1)[0] as { k: number; ix: number; iy: number; d: number }
      if (cur.ix === tx && cur.iy === ty) {
        goalK = cur.k
        break
      }
      const cg = gScore.get(cur.k) ?? Number.POSITIVE_INFINITY
      for (let di = 0; di < 4; di++) {
        const nx = cur.ix + (DX[di] as number)
        const ny = cur.iy + (DY[di] as number)
        if (!inb(nx, ny) || blocked[ci(nx, ny)]) continue
        const turn = cur.d !== 4 && cur.d !== di ? turnCost : 0
        const tentative = cg + G + turn + congestionCost * (usage[ci(nx, ny)] as number)
        const nk = skey(nx, ny, di)
        if (tentative < (gScore.get(nk) ?? Number.POSITIVE_INFINITY)) {
          gScore.set(nk, tentative)
          came.set(nk, cur.k)
          open.push({ k: nk, ix: nx, iy: ny, d: di, f: tentative + hMan(nx, ny) })
        }
      }
    }
    if (goalK < 0) return [from, to]
    const cells: Pt[] = []
    let k = goalK
    while (k !== startK) {
      const cell = Math.floor(k / 5)
      cells.unshift(ptAt(cell % cols, Math.floor(cell / cols)))
      const prev = came.get(k)
      if (prev === undefined) break
      k = prev
    }
    cells.unshift(ptAt(sx, sy))
    for (const c of cells) {
      const j = ci(cx(c.x), cy(c.y))
      usage[j] = (usage[j] ?? 0) + 1
    }
    // Stitch the EXACT pin endpoints back on (the grid snapped them up to half a cell) and rectilinearize
    // any diagonal the snap introduced, so the path connects the real pins with clean right angles.
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

  // Shortest wires first: local hops claim their lanes before long hauls sweep the board.
  const order = [...wires].sort(
    (a, b) =>
      Math.abs(a.from.x - a.to.x) +
      Math.abs(a.from.y - a.to.y) -
      (Math.abs(b.from.x - b.to.x) + Math.abs(b.from.y - b.to.y)),
  )
  for (const w of order) out.set(w.id, routeOne(w.from, w.to))
  // Neatness pass: spread the parallel runs that share a channel onto evenly-spaced tracks (the step that
  // makes the batch read as organized rather than a bundle of overlapping wires). nudgeRoutes is hoisted.
  const ids = [...out.keys()]
  const nudged = nudgeRoutes(
    ids.map((id) => out.get(id) ?? []),
    { gap: Math.max(6, Math.round(G / 2)) },
  )
  const result = new Map<string, Pt[]>()
  ids.forEach((wid, i) => {
    result.set(wid, nudged[i] ?? out.get(wid) ?? [])
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

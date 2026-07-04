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
 * The copper router — turns the ratsnest's airwires into real copper on the board's TWO layers
 * (TOOLCHAIN-ROADMAP.md Track 1: the step between placement and DRC/Gerber). Every trace is an
 * orthogonal polyline in real mm at a CITED width, routed with the same guaranteed obstacle-avoiding
 * engine the schematic's wires use (orthogonal-route.ts): a trace's centreline never comes closer
 * than width/2 + clearance to another net's copper on ITS layer — pads, routed traces, or via
 * barrels. Same-net copper may touch freely (that's a connection, not a short).
 *
 * Layers: every connection tries the TOP layer first (SMD pads only exist there); a connection the
 * top can't take drops to the BOTTOM through plated VIAS — a through-hole pad is already on both
 * layers and needs no via, an SMD pad gets a via beside it joined by a short top-layer stub. What
 * neither layer can take stays an airwire in `unrouted`, honestly counted, never drawn as copper
 * it isn't. Routing is greedy shortest-airwire-first, the classic ordering. Traces may pass under
 * part bodies (real boards route under SMD parts) but never through other nets' copper.
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

export type CopperLayer = 'top' | 'bottom'

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
): BoardRouting {
  const w = cls.traceWidthMm
  const clr = cls.clearanceMm
  const traces: CopperTrace[] = []
  const vias: Via[] = []
  const unrouted: Airwire[] = []

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
      if (layer === 'bottom' && !pad.throughHole) continue // SMD copper exists on top only
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
      if (pad.net === net) continue
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

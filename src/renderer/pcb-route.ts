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
 * The copper router — turns the ratsnest's airwires into real copper traces on the board's top layer
 * (TOOLCHAIN-ROADMAP.md Track 1: the step between placement and DRC/Gerber). Every trace is an
 * orthogonal polyline in real mm at a CITED width, routed with the same guaranteed obstacle-avoiding
 * engine the schematic's wires use (orthogonal-route.ts): a trace's centreline never comes closer
 * than width/2 + clearance to another net's copper — its pads or its already-routed traces. Same-net
 * copper may touch freely (that's a connection, not a short).
 *
 * Single copper layer for now, so two nets can genuinely fail to route (a real single-layer
 * constraint, not a bug) — whatever can't route stays an airwire in `unrouted`, honestly counted,
 * never drawn as copper it isn't. Routing is greedy shortest-airwire-first, the classic ordering.
 * Traces route point-to-point between pad centres; they may pass under part bodies (real boards route
 * under SMD parts) but never through other nets' copper.
 */

/** The routing rules a net class carries: trace width + copper-to-copper clearance, in mm, cited. */
export type RouteClass = {
  traceWidthMm: number
  clearanceMm: number
  provenance: FootprintProvenance
}

/**
 * The default net class — KiCad's own Default (track 0.25 mm, clearance 0.2 mm), read from the
 * KiCad 10 project templates installed on this machine; comfortably above the ~0.127 mm (5 mil)
 * minimum common fabs manufacture.
 */
export const DEFAULT_ROUTE_CLASS: RouteClass = {
  traceWidthMm: 0.25,
  clearanceMm: 0.2,
  provenance: {
    source_type: 'reference',
    title: 'KiCad Default net class — 0.25 mm track width, 0.2 mm clearance',
    citation:
      'KiCad 10 project templates (share/kicad/template/*/*.kicad_pro, net_settings.classes["Default"]): track_width 0.25, clearance 0.2 — verified identical across templates on the installed KiCad 10.0',
    confidence: 'high',
    url: 'https://gitlab.com/kicad/code/kicad',
    notes:
      'Well above the ~0.127 mm (5 mil) minimum trace/space common board fabs manufacture; a 0.25 mm external trace carries ~1 A within a 10 °C rise per IPC-2221 sizing charts.',
  },
}

/** One routed copper trace: an orthogonal centreline polyline in board mm, at its class width. */
export type CopperTrace = {
  net: string
  widthMm: number
  points: Pt[]
}

export type BoardRouting = {
  traces: CopperTrace[]
  /** Connections the single copper layer couldn't route — still owed, shown as airwires. */
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

/**
 * Route every airwire on one copper layer, shortest first. For each trace, the obstacles are every
 * OTHER net's pads and already-routed traces, inflated so the centreline keeps width/2 + clearance
 * from their copper edge. The cheap shapes (straight, both L corners) are tried before the A* grid.
 */
export function routeBoard(
  ratsnest: Ratsnest,
  cls: RouteClass = DEFAULT_ROUTE_CLASS,
): BoardRouting {
  const w = cls.traceWidthMm
  const clr = cls.clearanceMm
  const traces: CopperTrace[] = []
  const unrouted: Airwire[] = []

  const ordered = [...ratsnest.airwires].sort(
    (p, q) =>
      Math.abs(p.to.x - p.from.x) +
      Math.abs(p.to.y - p.from.y) -
      (Math.abs(q.to.x - q.from.x) + Math.abs(q.to.y - q.from.y)),
  )

  for (const aw of ordered) {
    // Forbidden zones for THIS trace's centreline: other nets' pad copper (edge + clearance + our
    // half-width) and other nets' routed centrelines (their half-width + clearance + our half-width).
    const obstacles: Box[] = []
    for (const pad of ratsnest.padBoxes) {
      if (pad.net === aw.net) continue
      obstacles.push(inflate(pad, clr + w / 2))
    }
    for (const t of traces) {
      if (t.net === aw.net) continue
      for (let i = 0; i < t.points.length - 1; i++) {
        obstacles.push(
          segmentBox(t.points[i] as Pt, t.points[i + 1] as Pt, t.widthMm / 2 + clr + w / 2),
        )
      }
    }

    const a = aw.from
    const b = aw.to
    // The natural shapes first: a straight run (same row/column), then either L corner.
    const candidates: Pt[][] = []
    if (a.x === b.x || a.y === b.y) candidates.push([a, b])
    else {
      candidates.push([a, { x: b.x, y: a.y }, b])
      candidates.push([a, { x: a.x, y: b.y }, b])
    }
    let path = candidates.find((c) => pathClear(c, obstacles)) ?? null
    if (path === null) {
      // The generous node cap matters: the default 4096 dies at ~16 placed parts' worth of Hanan
      // grid lines — the exact silent-death routeAllWires already hit and fixed the same way.
      const found = gridRouteAround(a, b, obstacles, 0.4, 1_000_000)
      path = found === null ? null : simplifyPath(found)
    }
    if (path === null) {
      unrouted.push(aw)
      continue
    }
    traces.push({ net: aw.net, widthMm: w, points: path })
  }
  return { traces, unrouted }
}

/**
 * The clearance audit — every place two different nets' copper comes closer than the class allows:
 * trace centrelines vs each other and vs pad copper. Used by the tests to prove the router's output
 * legal, and the seed of the DRC pass to come (which will run it over hand-edits too). A tiny epsilon
 * keeps exactly-at-clearance copper (flush routes the router legally emits) from being flagged.
 */
export function clearanceViolations(
  routing: BoardRouting,
  padBoxes: readonly PadBox[],
  cls: RouteClass = DEFAULT_ROUTE_CLASS,
): { kind: 'trace-trace' | 'trace-pad'; netA: string; netB: string }[] {
  const epsilon = 1e-9
  const out: { kind: 'trace-trace' | 'trace-pad'; netA: string; netB: string }[] = []
  const traces = routing.traces
  for (let i = 0; i < traces.length; i++) {
    const t = traces[i] as CopperTrace
    for (let s = 0; s < t.points.length - 1; s++) {
      const a = t.points[s] as Pt
      const b = t.points[s + 1] as Pt
      // vs other nets' pads
      for (const pad of padBoxes) {
        if (pad.net === t.net) continue
        const zone = inflate(pad, cls.clearanceMm + t.widthMm / 2 - epsilon)
        if (segmentHitsBox(a, b, zone)) {
          out.push({ kind: 'trace-pad', netA: t.net, netB: pad.net })
        }
      }
      // vs other traces (later ones only — each pair once)
      for (let j = i + 1; j < traces.length; j++) {
        const u = traces[j] as CopperTrace
        if (u.net === t.net) continue
        for (let r = 0; r < u.points.length - 1; r++) {
          const zone = segmentBox(
            u.points[r] as Pt,
            u.points[r + 1] as Pt,
            u.widthMm / 2 + cls.clearanceMm + t.widthMm / 2 - epsilon,
          )
          if (segmentHitsBox(a, b, zone)) {
            out.push({ kind: 'trace-trace', netA: t.net, netB: u.net })
          }
        }
      }
    }
  }
  return out
}

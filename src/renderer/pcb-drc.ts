import type { FootprintProvenance } from './footprint.ts'
import {
  type Board,
  footprintByPlacement,
  type Placement,
  placePoint,
  type Ratsnest,
  silkReferenceAnchor,
} from './pcb-board.ts'
import {
  type BoardRouting,
  clearanceViolations,
  copperConnects,
  DEFAULT_ROUTE_CLASS,
  type RouteClass,
  VIA_RULES,
} from './pcb-route.ts'
import { type CopperWeight, IPC2221, traceAmpacity } from './pcb-stackup.ts'
import { SILK_TEXT, strokeText } from './stroke-font.ts'

/**
 * Design-rule checking — the board's failure-mode checks, mirroring what the schematic side already
 * has. Each rule carries a CITED limit (the anti-placeholder rule applies to manufacturing rules
 * exactly like it does to physics values): violating copper clearance shorts nets, overlapping
 * courtyards means two parts physically collide at assembly, and copper closer than 0.3 mm to the
 * board edge gets torn by the mill's ±0.2 mm tolerance. Violations say WHERE (board mm), so the
 * board marks them; nothing is auto-"fixed" silently — the user sees exactly what a fab's DRC would
 * reject. This is the last gate before the Gerber export can be trusted.
 */

export type DrcCode =
  | 'copper-clearance'
  | 'courtyard-overlap'
  | 'edge-clearance'
  | 'track-width'
  | 'via-size'
  | 'hole-to-hole'
  | 'silk-over-pad'
  | 'over-current'
  | 'open-net'

/** The temperature rise (°C above ambient) the over-current check sizes to — IPC-2221's standard,
 *  conservative sizing point. A trace exceeding its ampacity at this rise runs hotter and ages fast. */
export const OVER_CURRENT_DELTA_T_C = 10

export type DrcViolation = {
  code: DrcCode
  message: string
  /** Where on the board, in mm — the marker position. */
  at: { x: number; y: number }
}

/** The cited limit behind each rule (copper clearance lives on the RouteClass itself; the via
 *  drill/annular/hole-spacing limits live in pcb-route's VIA_RULES so the router and this check
 *  can never disagree). */
export const DRC_RULES: Record<
  Exclude<DrcCode, 'copper-clearance' | 'via-size' | 'hole-to-hole' | 'over-current' | 'open-net'>,
  { limitMm: number; provenance: FootprintProvenance }
> = {
  'silk-over-pad': {
    limitMm: 0,
    provenance: {
      source_type: 'reference',
      title: 'Silkscreen must not print on exposed pads — fabs clip it; ink on a joint is a defect',
      citation:
        'JLCPCB PCB capabilities / order rules: silkscreen over pad openings is removed (clipped) during fabrication — lettering that lands there simply disappears from the board, and any ink that survives ends up under solder. KiCad ships the same check (DRC “silkscreen clipped by solder mask”).',
      confidence: 'high',
      url: 'https://jlcpcb.com/capabilities/pcb-capabilities',
      date_accessed: '2026-07-04',
    },
  },
  'courtyard-overlap': {
    limitMm: 0,
    provenance: {
      source_type: 'standard',
      title: 'IPC-7351 courtyard — the smallest keep-out providing minimum assembly clearance',
      citation:
        'IPC-7351B courtyard excess concept, as carried by every shipped footprint (courtyard geometry verbatim from the KiCad footprint library): two courtyards overlapping means two parts physically collide at assembly',
      confidence: 'high',
      url: 'https://gitlab.com/kicad/libraries/kicad-footprints',
    },
  },
  'edge-clearance': {
    limitMm: 0.3,
    provenance: {
      source_type: 'reference',
      title: 'JLCPCB PCB capabilities — copper to board edge ≥ 0.3 mm',
      citation:
        'JLCPCB manufacturing capabilities: minimum trace/copper to board-outline clearance 0.3 mm (routed edge; milling tolerance ±0.2 mm)',
      confidence: 'high',
      url: 'https://jlcpcb.com/capabilities/pcb-capabilities',
      date_accessed: '2026-07-04',
    },
  },
  'track-width': {
    limitMm: 0.2,
    provenance: {
      source_type: 'reference',
      title: 'KiCad board rules — minimum track width 0.2 mm',
      citation:
        'KiCad 10 project templates (board.design_settings.rules.min_track_width = 0.2), consistent across the templates on the installed KiCad 10.0; matches common fab standard capability',
      confidence: 'high',
      url: 'https://gitlab.com/kicad/code/kicad',
    },
  },
}

/** A placement's courtyard as a board-space box (corners turned with the part, then min/maxed). */
function courtyardBox(pl: Placement): { x: number; y: number; w: number; h: number } | undefined {
  const fp = footprintByPlacement(pl)
  if (fp === undefined) return undefined
  const c = fp.courtyard
  const corners = [
    placePoint(pl, { x: c.x, y: c.y }),
    placePoint(pl, { x: c.x + c.w, y: c.y }),
    placePoint(pl, { x: c.x + c.w, y: c.y + c.h }),
    placePoint(pl, { x: c.x, y: c.y + c.h }),
  ]
  const xs = corners.map((p) => p.x)
  const ys = corners.map((p) => p.y)
  const x0 = Math.min(...xs)
  const y0 = Math.min(...ys)
  return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 }
}

const fmt = (v: number) => (Math.round(v * 100) / 100).toString()
const fmtA = (v: number) => (Math.round(v * 1000) / 1000).toString() // amps, mA precision

/** Every copper rectangle on the board (pads as-is; trace segments at their real width). */
function copperBoxes(
  ratsnest: Ratsnest,
  routing: BoardRouting,
): { x: number; y: number; w: number; h: number; what: string }[] {
  const out: { x: number; y: number; w: number; h: number; what: string }[] = []
  for (const pad of ratsnest.padBoxes) {
    out.push({ x: pad.x, y: pad.y, w: pad.w, h: pad.h, what: `a pad (${pad.net})` })
  }
  for (const t of routing.traces) {
    for (let i = 0; i < t.points.length - 1; i++) {
      const a = t.points[i]
      const b = t.points[i + 1]
      if (a === undefined || b === undefined) continue
      const half = t.widthMm / 2
      const x0 = Math.min(a.x, b.x) - half
      const y0 = Math.min(a.y, b.y) - half
      out.push({
        x: x0,
        y: y0,
        w: Math.abs(b.x - a.x) + t.widthMm,
        h: Math.abs(b.y - a.y) + t.widthMm,
        what: `a trace (${t.net})`,
      })
    }
  }
  for (const v of routing.vias) {
    out.push({
      x: v.at.x - v.diameterMm / 2,
      y: v.at.y - v.diameterMm / 2,
      w: v.diameterMm,
      h: v.diameterMm,
      what: `a via (${v.net})`,
    })
  }
  return out
}

/**
 * Run every board rule and report each violation with its spot. Pure — the same inputs the panel
 * already derives (board, ratsnest, routing) in, a flat list out.
 */
export function runDrc(
  board: Board,
  ratsnest: Ratsnest,
  routing: BoardRouting,
  cls: RouteClass = DEFAULT_ROUTE_CLASS,
  opts?: { netCurrents?: Map<string, number>; copperWeight?: CopperWeight },
): DrcViolation[] {
  const out: DrcViolation[] = []

  // Copper-to-copper clearance (traces + pads, cross-net) — the audit the router itself honours.
  for (const v of clearanceViolations(routing, ratsnest.padBoxes, cls)) {
    out.push({
      code: 'copper-clearance',
      message: `${v.kind === 'pad-pad' ? 'pads' : v.kind === 'trace-trace' ? 'traces' : 'trace and pad'} of two nets closer than ${fmt(cls.clearanceMm)} mm`,
      at: v.at,
    })
  }

  // Courtyard overlap — two parts physically colliding at assembly.
  for (let i = 0; i < board.placements.length; i++) {
    const a = board.placements[i]
    const boxA = a === undefined ? undefined : courtyardBox(a)
    if (a === undefined || boxA === undefined) continue
    for (let j = i + 1; j < board.placements.length; j++) {
      const b = board.placements[j]
      const boxB = b === undefined ? undefined : courtyardBox(b)
      if (b === undefined || boxB === undefined) continue
      const xLo = Math.max(boxA.x, boxB.x)
      const xHi = Math.min(boxA.x + boxA.w, boxB.x + boxB.w)
      const yLo = Math.max(boxA.y, boxB.y)
      const yHi = Math.min(boxA.y + boxA.h, boxB.y + boxB.h)
      if (xLo < xHi && yLo < yHi) {
        out.push({
          code: 'courtyard-overlap',
          message: `${a.partId} and ${b.partId} collide — their courtyards overlap`,
          at: { x: (xLo + xHi) / 2, y: (yLo + yHi) / 2 },
        })
      }
    }
  }

  // Copper to board edge — the mill tears copper closer than the limit.
  const edge = DRC_RULES['edge-clearance'].limitMm
  const o = board.outline
  for (const c of copperBoxes(ratsnest, routing)) {
    const tooClose =
      c.x < o.x + edge ||
      c.y < o.y + edge ||
      c.x + c.w > o.x + o.w - edge ||
      c.y + c.h > o.y + o.h - edge
    if (tooClose) {
      out.push({
        code: 'edge-clearance',
        message: `${c.what} sits within ${fmt(edge)} mm of the board edge`,
        at: { x: c.x + c.w / 2, y: c.y + c.h / 2 },
      })
    }
  }

  // Minimum manufacturable track width.
  const minTrack = DRC_RULES['track-width'].limitMm
  for (const t of routing.traces) {
    if (t.widthMm >= minTrack) continue
    const p = t.points[0]
    if (p === undefined) continue
    out.push({
      code: 'track-width',
      message: `a ${fmt(t.widthMm)} mm trace is narrower than the ${fmt(minTrack)} mm minimum`,
      at: p,
    })
  }

  // Via geometry — the drill floor and the copper ring the plating needs (VIA_RULES, cited).
  for (const v of routing.vias) {
    if (v.drillMm < VIA_RULES.min_drill.limitMm) {
      out.push({
        code: 'via-size',
        message: `a ${fmt(v.drillMm)} mm via drill is under the ${fmt(VIA_RULES.min_drill.limitMm)} mm minimum`,
        at: v.at,
      })
    }
    const annular = (v.diameterMm - v.drillMm) / 2
    if (annular < VIA_RULES.min_annular.limitMm) {
      out.push({
        code: 'via-size',
        message: `a ${fmt(annular)} mm via annular ring is under the ${fmt(VIA_RULES.min_annular.limitMm)} mm minimum`,
        at: v.at,
      })
    }
  }

  // Hole-to-hole — every plated drill on the board (component holes + vias), pairwise: the drill
  // breaks out between two holes closer than the limit, same net or not.
  const holes: { at: { x: number; y: number }; drillMm: number }[] = routing.vias.map((v) => ({
    at: v.at,
    drillMm: v.drillMm,
  }))
  for (const pl of board.placements) {
    const fp = footprintByPlacement(pl)
    if (fp === undefined) continue
    for (const pad of fp.pads) {
      if (pad.holeDiameter === undefined) continue
      holes.push({ at: placePoint(pl, pad.center), drillMm: pad.holeDiameter })
    }
  }
  const minHoleGap = VIA_RULES.hole_to_hole.limitMm
  for (let i = 0; i < holes.length; i++) {
    const a = holes[i] as (typeof holes)[number]
    for (let j = i + 1; j < holes.length; j++) {
      const b = holes[j] as (typeof holes)[number]
      const gap = Math.hypot(a.at.x - b.at.x, a.at.y - b.at.y) - (a.drillMm + b.drillMm) / 2
      if (gap < minHoleGap - 1e-9) {
        out.push({
          code: 'hole-to-hole',
          message: `two plated holes sit ${fmt(Math.max(0, gap))} mm apart — under the ${fmt(minHoleGap)} mm minimum`,
          at: { x: (a.at.x + b.at.x) / 2, y: (a.at.y + b.at.y) / 2 },
        })
      }
    }
  }

  // Silkscreen over exposed pads — the fab CLIPS ink that lands on a mask opening (the opening
  // equals the pad, mask clearance 0), so lettering there disappears from the manufactured board
  // and any survivor sits under solder. Every silk stroke — outlines and designator lettering,
  // its OWN pads included — is sampled finely along its length (glyphs run diagonal; a bounding-box
  // test would flag near-misses) and each sample's EXACT distance to the pad rectangle is compared
  // to the stroke's half-width. True point-to-rect distance (not a grown axis box) so a stroke
  // passing just off a pad CORNER isn't falsely flagged. A stroke crossing several pads reports
  // each once (no early-out that would hide the later ones).
  const padRects = ratsnest.padBoxes
  const silkHits = new Set<string>()
  const distToRect = (
    px: number,
    py: number,
    r: { x: number; y: number; w: number; h: number },
  ): number => {
    const dx = Math.max(r.x - px, 0, px - (r.x + r.w))
    const dy = Math.max(r.y - py, 0, py - (r.y + r.h))
    return Math.hypot(dx, dy)
  }
  const checkStroke = (
    from: { x: number; y: number },
    to: { x: number; y: number },
    strokeWidth: number,
    partId: string,
  ) => {
    const g = strokeWidth / 2
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 0.05))
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const px = from.x + (to.x - from.x) * t
      const py = from.y + (to.y - from.y) * t
      for (const pad of padRects) {
        if (distToRect(px, py, pad) >= g) continue
        const key = `${partId}:${pad.pad}`
        if (silkHits.has(key)) continue
        silkHits.add(key)
        out.push({
          code: 'silk-over-pad',
          message: `${partId}'s silkscreen prints on an exposed pad (${pad.pad}) — the fab clips it`,
          at: { x: px, y: py },
        })
      }
    }
  }
  for (const pl of board.placements) {
    const fp = footprintByPlacement(pl)
    if (fp === undefined) continue
    for (const s of fp.silkscreen) {
      checkStroke(placePoint(pl, s.from), placePoint(pl, s.to), s.width, pl.partId)
    }
    const text = strokeText(pl.designator ?? pl.partId, silkReferenceAnchor(pl, fp))
    for (const seg of text.segments) {
      checkStroke(seg.from, seg.to, SILK_TEXT.thicknessMm, pl.partId)
    }
  }

  // Over-current — a trace carrying more current than its IPC-2221 ampacity for a modest rise: it runs
  // hot and ages fast (the electrical counterpart to the too-narrow-track check). Only run when the
  // caller supplies the SOLVED net currents + the copper weight (a solved board). A trace on a net can
  // carry that net's whole throughput, so each is checked against the max part current on its net.
  if (opts?.netCurrents !== undefined && opts.copperWeight !== undefined) {
    const weight = opts.copperWeight
    const oz = weight === 'two_oz' ? '2' : weight === 'half_oz' ? '0.5' : '1'
    for (const t of routing.traces) {
      const current = opts.netCurrents.get(t.net) ?? 0
      if (current <= 1e-9) continue
      // top + bottom are OUTER copper (the 'external' IPC-2221 constant); inner layers aren't routed.
      const ampacity = traceAmpacity(t.widthMm, weight, OVER_CURRENT_DELTA_T_C)
      if (ampacity <= 0 || current <= ampacity) continue
      const a = t.points[0]
      const b = t.points[1] ?? a
      if (a === undefined || b === undefined) continue
      out.push({
        code: 'over-current',
        message: `a ${fmt(t.widthMm)} mm trace on net ${t.net} carries ${fmtA(current)} A — over its ~${fmtA(ampacity)} A rating (IPC-2221, ${OVER_CURRENT_DELTA_T_C} °C rise, ${oz} oz). Widen the trace or split the current.`,
        at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      })
    }
  }

  // Open net — a net whose pads are NOT all joined by its OWN copper is BROKEN, even on a board that
  // reads "fully routed": the clearance/width checks are blind to continuity (they check spacing, not
  // whether copper actually connects), and the router can self-certify a connection it didn't make (a
  // layer change with no via leaves a pad meeting a trace through no plated hole). This verifies each
  // net's continuity INDEPENDENTLY, using only that net's copper, so a foreign trace touching a pad
  // can't mask an open. Nets still owed an airwire are skipped — those are already surfaced as
  // "unrouted" (the header's routed count) and blocked from export; this adds the router's blind spot.
  const unroutedNets = new Set(routing.unrouted.map((aw) => aw.net))
  const padsByNet = new Map<string, { x: number; y: number }[]>()
  for (const pad of ratsnest.padBoxes) {
    const center = { x: pad.x + pad.w / 2, y: pad.y + pad.h / 2 }
    const list = padsByNet.get(pad.net)
    if (list === undefined) padsByNet.set(pad.net, [center])
    else list.push(center)
  }
  for (const [net, pads] of padsByNet) {
    const anchor = pads[0]
    if (pads.length < 2 || anchor === undefined || unroutedNets.has(net)) continue
    const netTraces = routing.traces.filter((t) => t.net === net)
    const netVias = routing.vias.filter((v) => v.net === net)
    for (let i = 1; i < pads.length; i++) {
      const pad = pads[i]
      if (pad === undefined || copperConnects(anchor, pad, netTraces, netVias)) continue
      out.push({
        code: 'open-net',
        message: `net ${net} is not fully connected — a pad at (${fmt(pad.x)}, ${fmt(pad.y)}) mm has no copper path to the rest of the net (an open). Route the missing link, or add a via where the copper changes layer.`,
        at: pad,
      })
      break // one report per broken net is enough to flag it
    }
  }

  return out
}

/** The IPC-2221 provenance behind the over-current check (re-exported for the fab report's cited
 *  rules list — the ampacity curve fit + its constants live in pcb-stackup's IPC2221). */
export const OVER_CURRENT_PROVENANCE = IPC2221.provenance

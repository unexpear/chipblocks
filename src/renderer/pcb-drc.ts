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
import { netSegmentCurrents } from './pcb-segment-current.ts'
import {
  type CopperWeight,
  IPC2221,
  traceAmpacity,
  VIA_PLATING_MM,
  viaAmpacity,
} from './pcb-stackup.ts'
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
  | 'via-in-pad'
  | 'annular-ring'
  | 'drill-size'
  | 'hole-to-hole'
  | 'silk-over-pad'
  | 'silk-stroke'
  | 'over-current'
  | 'open-net'
  | 'board-size'

/** The temperature rise (°C above ambient) the over-current check sizes to — IPC-2221's standard,
 *  conservative sizing point. A trace exceeding its ampacity at this rise runs hotter and ages fast. */
export const OVER_CURRENT_DELTA_T_C = 10

/** The absolute fab floor for copper-to-copper spacing. The per-net-class clearance is USER-settable, so
 *  the copper-clearance check enforces the LARGER of the net class and this floor — the spacing twin of
 *  the cited track-width floor. Without it, tightening a net class below what any fab can hold would
 *  report sub-manufacturable spacing as clean. */
export const COPPER_CLEARANCE_FLOOR_MM = 0.127

export const COPPER_CLEARANCE_FLOOR_PROVENANCE: FootprintProvenance = {
  source_type: 'reference',
  title: 'Minimum copper-to-copper spacing 0.127 mm (5 mil) — common fab capability',
  citation:
    'JLCPCB PCB capabilities: minimum trace-to-trace / trace-to-pad spacing 0.127 mm (5 mil) on the standard process (0.0889 mm / 3.5 mil advanced). Used as the hard spacing floor a user-tightened net class cannot go below — the spacing counterpart to the track-width floor.',
  confidence: 'high',
  url: 'https://jlcpcb.com/capabilities/pcb-capabilities',
  date_accessed: '2026-07-17',
}

/**
 * Minimum manufacturable copper feature (track WIDTH and cross-net SPACING) as a function of COPPER WEIGHT:
 * thicker copper etches with more sideways undercut, so the finest feature a fab can hold GROWS with weight.
 * The old flat 0.2 mm track-width floor was KiCad's editor default, not a fab spec — it over-rejected makeable
 * 0.127 mm traces AND disagreed with the 0.127 mm spacing floor. These are the JLCPCB standard-process
 * capabilities (the advanced process goes finer); `one_oz` is the default when no weight is known and equals
 * the cited spacing floor, so a normal 1 oz board is unchanged and heavier copper is held to a wider minimum.
 */
export const MIN_COPPER_FEATURE_MM: Record<CopperWeight, number> = {
  half_oz: 0.1, // ~4 mil — thinner copper resolves finer
  one_oz: 0.127, // 5 mil — the standard-process minimum (equals the spacing floor)
  two_oz: 0.15, // 6 mil — heavier copper needs a wider minimum
}

export const MIN_COPPER_FEATURE_PROVENANCE: FootprintProvenance = {
  source_type: 'reference',
  title: 'Minimum track width / spacing scales with copper weight — JLCPCB capabilities',
  citation:
    'JLCPCB PCB capabilities: the finest trace width and spacing a fab can etch grows with copper weight — ~0.1 mm (4 mil) at 0.5 oz, 0.127 mm (5 mil) at 1 oz on the standard process, 0.15 mm (6 mil) at 2 oz (heavier copper etches with more undercut). Finer on the advanced process. Supersedes the flat 0.2 mm KiCad editor default.',
  confidence: 'high',
  url: 'https://jlcpcb.com/capabilities/pcb-capabilities',
  date_accessed: '2026-07-19',
}

/** The minimum manufacturable track width / cross-net spacing (mm) for a copper weight — 1 oz default. */
export const minCopperFeatureMm = (weight?: CopperWeight): number =>
  MIN_COPPER_FEATURE_MM[weight ?? 'one_oz']

/**
 * Minimum annular ring for a PLATED THROUGH-HOLE COMPONENT PAD (0.15 mm / 6 mil) — the copper the pad must
 * keep around its drilled hole so machine-registration drift cannot break the ring open. This is the fab
 * DESIGN rule and is DISTINCT FROM (and larger than) VIA_RULES.min_annular (0.05 mm), which is only the
 * geometric floor of the smallest allowable via — a small fabricated via, not a solderable component pad.
 * Every shipped through-hole footprint pad clears this comfortably (TO-92 ≈0.28 mm, DIP-8 ≈0.40 mm); it
 * catches a user-authored/edited pad whose copper is barely larger than its hole.
 */
export const PTH_PAD_ANNULAR_MM = 0.15

export const PTH_PAD_ANNULAR_PROVENANCE: FootprintProvenance = {
  source_type: 'reference',
  title: 'Plated through-hole component pad — minimum annular ring 0.15 mm (6 mil)',
  citation:
    'JLCPCB PCB capabilities: minimum annular ring for a plated through-hole 0.15 mm (6 mil), recommended 0.20 mm — larger than the 0.05 mm floor of the smallest allowable VIA. An NPTH pad, having no plating to aid registration, needs a larger pad still.',
  confidence: 'high',
  url: 'https://jlcpcb.com/capabilities/pcb-capabilities',
  date_accessed: '2026-07-19',
}

/**
 * Maximum mechanical DRILL diameter (6.30 mm). A round hole larger than this — or any elongated hole — is
 * MILLED as a routed slot/cutout at the fab, not drilled. A footprint declaring a >6.3 mm round hole is not
 * manufacturable as a drill and must be reworked as a slot.
 */
export const MAX_DRILL_MM = 6.3

export const MAX_DRILL_PROVENANCE: FootprintProvenance = {
  source_type: 'reference',
  title: 'Maximum mechanical drill 6.30 mm — larger holes are routed slots',
  citation:
    'JLCPCB PCB capabilities: mechanical drill range 0.15–6.30 mm; a round hole above 6.30 mm (or any elongated hole) is milled as a routed slot/cutout, not drilled.',
  confidence: 'high',
  url: 'https://jlcpcb.com/capabilities/pcb-capabilities',
  date_accessed: '2026-07-19',
}

/**
 * Single-board size window for the standard fab process: a board smaller than 3 mm on a side can't be run
 * on its own (it must be PANELIZED into an array), and one larger than 500 mm on a side exceeds the standard
 * production panel (a bigger board needs a special quote). These bound a single-up board — panelization is a
 * later feature, so the small-board case is a real "you must panelize this" signal, not a silent pass.
 */
export const MIN_BOARD_MM = 3
export const MAX_BOARD_MM = 500

export const BOARD_SIZE_PROVENANCE: FootprintProvenance = {
  source_type: 'reference',
  title: 'Single-board size window 3 mm – 500 mm per side (standard process)',
  citation:
    'JLCPCB PCB capabilities: minimum single board 3×3 mm (below → must be panelized into an array), and the standard production panel bounds a single board to roughly 500 mm per side on the common process (larger dimensions / higher layer counts need a quote).',
  confidence: 'high',
  url: 'https://jlcpcb.com/capabilities/pcb-capabilities',
  date_accessed: '2026-07-19',
}

/**
 * Minimum silkscreen character HEIGHT (1.0 mm / 40 mil) on the standard process — smaller lettering doesn't
 * print legibly. The board's designators render from the stroke font at exactly 1.0 mm (a fixed size, so
 * they can never violate this at runtime); this constant documents the limit + is asserted against the font.
 */
export const MIN_SILK_CHAR_HEIGHT_MM = 1.0

export const MIN_SILK_CHAR_HEIGHT_PROVENANCE: FootprintProvenance = {
  source_type: 'reference',
  title: 'Minimum silkscreen character height 1.0 mm (40 mil) on the standard process',
  citation:
    'JLCPCB PCB capabilities: minimum silkscreen text/character height 1.0 mm (40 mil) on the standard process (0.8 mm high-precision). Matches KiCad’s 1.0 mm silk_text_size default.',
  confidence: 'high',
  url: 'https://jlcpcb.com/capabilities/pcb-capabilities',
  date_accessed: '2026-07-19',
}

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
  Exclude<
    DrcCode,
    | 'copper-clearance'
    | 'via-size'
    | 'annular-ring'
    | 'drill-size'
    | 'hole-to-hole'
    | 'over-current'
    | 'open-net'
    | 'board-size'
  >,
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
  'silk-stroke': {
    limitMm: 0.15,
    provenance: {
      source_type: 'reference',
      title: 'Minimum silkscreen stroke width 0.15 mm (6 mil) on the standard process',
      citation:
        'JLCPCB PCB capabilities: minimum silkscreen line width / character stroke 0.15 mm (6 mil) on the standard process (0.10 mm high-precision); ink thinner than this does not print reliably and drops off the board. Matches KiCad’s 0.15 mm silk_text_thickness default.',
      confidence: 'high',
      url: 'https://jlcpcb.com/capabilities/pcb-capabilities',
      date_accessed: '2026-07-19',
    },
  },
  'via-in-pad': {
    limitMm: 0,
    provenance: {
      source_type: 'reference',
      title: 'A via inside a component pad wicks the joint’s solder down the barrel — fabs flag it',
      citation:
        'Standard PCB DFM / IPC-7093 & IPC-A-610: a via placed in a solderable component pad draws molten solder down the plated barrel during reflow, starving the joint (a "via-in-pad" needs a filled-and-capped process — an extra plated-over step — to be sound). Unfilled via-in-pad is a manufacturability defect fab DRC/DFM checks flag.',
      confidence: 'high',
      url: 'https://www.pcblibraries.com/',
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
    // The 1 oz nominal; the DRC check scales it per the board's copper weight (minCopperFeatureMm).
    limitMm: MIN_COPPER_FEATURE_MM.one_oz,
    provenance: MIN_COPPER_FEATURE_PROVENANCE,
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
  opts?: {
    netCurrents?: Map<string, number>
    copperWeight?: CopperWeight
    /** Per-pad current (magnitude), keyed by the pad's `partId/padId`. When present, a multi-drop
     *  net's copper is resolved into a tree and each TRACE SEGMENT is checked against the current it
     *  actually carries — so a thin branch off a high-current trunk is checked against its own small
     *  load, not the trunk. Absent ⇒ every segment falls back to the whole-net max (the old behaviour). */
    padCurrents?: Map<string, number>
  },
): DrcViolation[] {
  const out: DrcViolation[] = []

  // Single-board size window: too small must be panelized, too large exceeds the production panel.
  {
    const { w, h } = board.outline
    const center = { x: board.outline.x + w / 2, y: board.outline.y + h / 2 }
    const smallest = Math.min(w, h)
    const largest = Math.max(w, h)
    if (smallest < MIN_BOARD_MM) {
      out.push({
        code: 'board-size',
        message: `the board is ${fmt(smallest)} mm on its smallest side — under the ${fmt(MIN_BOARD_MM)} mm single-board minimum; a board this small must be panelized into an array`,
        at: center,
      })
    } else if (largest > MAX_BOARD_MM) {
      out.push({
        code: 'board-size',
        message: `the board is ${fmt(largest)} mm on its largest side — over the ${fmt(MAX_BOARD_MM)} mm standard-panel limit; a board this large needs a special quote`,
        at: center,
      })
    }
  }

  // Copper-to-copper clearance (traces + pads, cross-net) — the audit the router itself honours, but
  // enforced at the LARGER of the net class and the absolute fab floor, so a net class tightened below
  // what any fab can hold (sub-manufacturable spacing) is still caught (the spacing twin of the
  // track-width floor). For a normal board (clearance ≥ the floor) this is exactly the net-class value.
  // The spacing floor scales with copper weight (heavier copper needs wider gaps) — for 1 oz this is the
  // same 0.127 mm as before, so a normal board is unchanged; a 2 oz board is held to 0.15 mm.
  const spacingFloor = minCopperFeatureMm(opts?.copperWeight)
  const enforcedClearance = Math.max(cls.clearanceMm, spacingFloor)
  const clearanceCls =
    enforcedClearance === cls.clearanceMm ? cls : { ...cls, clearanceMm: enforcedClearance }
  const belowFloor = cls.clearanceMm < spacingFloor
  for (const v of clearanceViolations(routing, ratsnest.padBoxes, clearanceCls)) {
    out.push({
      code: 'copper-clearance',
      message:
        `${v.kind === 'pad-pad' ? 'pads' : v.kind === 'trace-trace' ? 'traces' : 'trace and pad'} of two nets closer than ${fmt(enforcedClearance)} mm` +
        (belowFloor
          ? ` (the ${fmt(spacingFloor)} mm fab minimum — the net class's ${fmt(cls.clearanceMm)} mm is below it)`
          : ''),
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

  // Minimum manufacturable track width — scales with the board's copper weight (thicker copper etches a
  // wider minimum feature); 1 oz keeps the 0.127 mm value, replacing the old flat 0.2 mm editor default.
  const minTrack = minCopperFeatureMm(opts?.copperWeight)
  for (const t of routing.traces) {
    if (t.widthMm >= minTrack) continue
    const p = t.points[0]
    if (p === undefined) continue
    out.push({
      code: 'track-width',
      message: `a ${fmt(t.widthMm)} mm trace is narrower than the ${fmt(minTrack)} mm minimum${opts?.copperWeight === 'two_oz' ? ' for 2 oz copper' : ''}`,
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

  // Via in pad — a via whose barrel sits inside a component pad's copper wicks that joint's solder
  // down the barrel (via-in-pad). It is its OWN defect, not a clearance one: it applies even same-net
  // (a via in its own net's pad still starves the joint). The auto-router keeps vias off every pad;
  // this catches a HAND-placed via dropped on a pad.
  for (const v of routing.vias) {
    const bx = v.at.x - v.diameterMm / 2
    const by = v.at.y - v.diameterMm / 2
    const bs = v.diameterMm
    for (const pad of ratsnest.padBoxes) {
      // open-interval overlap: a via touching a pad edge is legal; interior overlap is via-in-pad
      if (bx < pad.x + pad.w && pad.x < bx + bs && by < pad.y + pad.h && pad.y < by + bs) {
        const part = pad.pad.split('/')[0] ?? pad.net
        out.push({
          code: 'via-in-pad',
          message: `a via sits inside ${part}'s pad — solder wicks down the barrel (via-in-pad); keep vias off pads`,
          at: v.at,
        })
        break // one flag per via
      }
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
      const at = placePoint(pl, pad.center)
      holes.push({ at, drillMm: pad.holeDiameter })
      // A plated COMPONENT hole needs the same drill floor + annular ring a via does — IPC-2221 sizes
      // EVERY plated hole, not just fabricated vias. The shipped footprints are all sane, but a
      // user-authored/edited one can under-drill or under-ring a pad; the fab would reject it (the drill
      // breaks into the pad copper and opens the plated barrel), so DRC must catch it too. The ring is
      // measured on the pad's SMALLEST copper dimension — the thinnest side around the hole.
      const ref = pl.designator ?? pl.partId
      if (pad.holeDiameter < VIA_RULES.min_drill.limitMm) {
        out.push({
          code: 'drill-size',
          message: `${ref} pad ${pad.id}: a ${fmt(pad.holeDiameter)} mm hole is under the ${fmt(VIA_RULES.min_drill.limitMm)} mm minimum drill`,
          at,
        })
      }
      // A round hole larger than the max drill must be a routed slot, not a drill (6.3 mm mill limit).
      if (pad.holeDiameter > MAX_DRILL_MM) {
        out.push({
          code: 'drill-size',
          message: `${ref} pad ${pad.id}: a ${fmt(pad.holeDiameter)} mm hole is over the ${fmt(MAX_DRILL_MM)} mm max drill — it must be a routed slot, not a drilled hole`,
          at,
        })
      }
      // A plated component pad needs the PTH design-rule annular ring (0.15 mm) — larger than the via
      // floor: the ring is the copper the pad keeps around its hole so registration drift can't break it.
      const annular = (Math.min(pad.size.w, pad.size.h) - pad.holeDiameter) / 2
      if (annular < PTH_PAD_ANNULAR_MM) {
        out.push({
          code: 'annular-ring',
          message: `${ref} pad ${pad.id}: a ${fmt(annular)} mm annular ring is under the ${fmt(PTH_PAD_ANNULAR_MM)} mm minimum for a plated through-hole pad`,
          at,
        })
      }
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
  // Silk stroke too thin to print — ink under the fab minimum (0.15 mm) drops off the board. Checked on the
  // footprint's own F.SilkS strokes (the designator text is a fixed 0.15 mm, always compliant); one flag
  // per part so a whole under-inked footprint reports once, not per segment.
  const minSilkStroke = DRC_RULES['silk-stroke'].limitMm
  const silkWidthFlagged = new Set<string>()
  for (const pl of board.placements) {
    const fp = footprintByPlacement(pl)
    if (fp === undefined) continue
    for (const s of fp.silkscreen) {
      checkStroke(placePoint(pl, s.from), placePoint(pl, s.to), s.width, pl.partId)
      if (s.width < minSilkStroke - 1e-9 && !silkWidthFlagged.has(pl.partId)) {
        silkWidthFlagged.add(pl.partId)
        out.push({
          code: 'silk-stroke',
          message: `${pl.designator ?? pl.partId}: a ${fmt(s.width)} mm silkscreen stroke is under the ${fmt(minSilkStroke)} mm minimum — it won't print`,
          at: placePoint(pl, s.from),
        })
      }
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
    // Group traces by net so a multi-drop net's copper can be resolved into a tree and each segment
    // checked against the current it really carries (a thin branch off a trunk isn't the trunk's load).
    const tracesByNet = new Map<string, BoardRouting['traces'][number][]>()
    for (const t of routing.traces) {
      const list = tracesByNet.get(t.net)
      if (list === undefined) tracesByNet.set(t.net, [t])
      else list.push(t)
    }
    // Per-net pad currents (point + magnitude) — the input to the per-segment tree analysis. Absent
    // (no padCurrents) ⇒ every segment falls back to the whole-net max, the old behaviour.
    const padCurrentsByNet = new Map<string, { at: { x: number; y: number }; current: number }[]>()
    if (opts.padCurrents !== undefined) {
      for (const pb of ratsnest.padBoxes) {
        const current = opts.padCurrents.get(pb.pad)
        if (current === undefined) continue
        const entry = { at: { x: pb.x + pb.w / 2, y: pb.y + pb.h / 2 }, current }
        const list = padCurrentsByNet.get(pb.net)
        if (list === undefined) padCurrentsByNet.set(pb.net, [entry])
        else list.push(entry)
      }
    }
    for (const [net, netTraces] of tracesByNet) {
      const netMax = opts.netCurrents.get(net) ?? 0
      if (netMax <= 1e-9) continue
      const netPads = padCurrentsByNet.get(net)
      const segCurrents =
        netPads !== undefined
          ? netSegmentCurrents(netTraces, netPads, netMax)
          : netTraces.map((t) => new Array(Math.max(0, t.points.length - 1)).fill(netMax))
      netTraces.forEach((t, ti) => {
        // Top + bottom are OUTER copper (the higher 'external' IPC-2221 constant); a BURIED inner-layer
        // trace has no air to cool it, so it carries about HALF as much — the 'internal' constant.
        const external = t.layer === 'top' || t.layer === 'bottom'
        const ampacity = traceAmpacity(
          t.widthMm,
          weight,
          OVER_CURRENT_DELTA_T_C,
          external ? 'external' : 'internal',
        )
        if (ampacity <= 0) return
        // The worst segment on this trace — one violation per over-current trace, at that spot.
        const segs = segCurrents[ti] ?? []
        let worst = 0
        let worstSeg = 0
        segs.forEach((c, si) => {
          if (c > worst) {
            worst = c
            worstSeg = si
          }
        })
        if (worst <= ampacity) return
        const a = t.points[worstSeg]
        const b = t.points[worstSeg + 1] ?? a
        if (a === undefined || b === undefined) return
        out.push({
          code: 'over-current',
          message: `a ${fmt(t.widthMm)} mm ${external ? '' : 'inner-layer '}trace on net ${net} carries ${fmtA(worst)} A — over its ~${fmtA(ampacity)} A rating (IPC-2221 ${external ? 'external' : 'internal'}, ${OVER_CURRENT_DELTA_T_C} °C rise, ${oz} oz). Widen the trace or split the current.`,
          at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        })
      })
    }
    // A plated via's barrel is a current bottleneck — far less copper than a wide trace — and often the
    // narrowest point on a high-current net. Check each via's barrel ampacity against its net current.
    for (const v of routing.vias) {
      const current = opts.netCurrents.get(v.net) ?? 0
      if (current <= 1e-9) continue
      const ampacity = viaAmpacity(v.drillMm, VIA_PLATING_MM, OVER_CURRENT_DELTA_T_C)
      if (ampacity <= 0 || current <= ampacity) continue
      out.push({
        code: 'over-current',
        message: `a via on net ${v.net} (${fmt(v.drillMm)} mm drill) carries ${fmtA(current)} A — over its ~${fmtA(ampacity)} A plated-barrel rating (IPC-2221 internal on a ${VIA_PLATING_MM * 1000} µm IPC-6012 barrel, ${OVER_CURRENT_DELTA_T_C} °C rise). Add a parallel via, or use a larger drill.`,
        at: v.at,
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

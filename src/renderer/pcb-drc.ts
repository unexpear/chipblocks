import { type FootprintProvenance, fabricationBounds } from './footprint.ts'
import {
  type Board,
  type BoardSide,
  castellatedBoardSide,
  footprintByPlacement,
  outlineRing,
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
  traceResistanceOhm,
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
  | 'voltage-clearance'
  | 'component-edge'
  | 'ir-drop'
  | 'castellated-hole'

/** The temperature rise (°C above ambient) the over-current check sizes to — IPC-2221's standard,
 *  conservative sizing point. A trace exceeding its ampacity at this rise runs hotter and ages fast. */
export const OVER_CURRENT_DELTA_T_C = 10

/**
 * IR-drop budget as a fraction of the rail voltage (5%): a power rail may pass the ampacity (thermal) check
 * yet drop too much RESISTIVE voltage (I·R) along its copper, sagging the rail below what the load needs.
 * 5% of the nominal rail is a common design guideline (keep supply IR-drop under ~3–5%). The drop here is the
 * conservative SERIES estimate (I_net × total rail-trace resistance) — exact for a simple source→load rail,
 * an over-estimate for a heavily-branched star. A normal board (mA currents, short traces) drops µV–mV, far
 * under budget, so this fires only on a genuinely under-sized power rail.
 */
export const IR_DROP_BUDGET_FRACTION = 0.05

export const IR_DROP_PROVENANCE: FootprintProvenance = {
  source_type: 'reference',
  title: 'DC IR-drop budget ≈ 5% of the rail voltage (supply integrity guideline)',
  citation:
    'Common power-integrity design guideline (e.g. Altium / Cadence PDN notes, IPC-2152 copper resistance): keep the DC IR-drop from the supply to the load under ~3–5% of the rail voltage so the rail stays in tolerance. Separate from the thermal ampacity limit — a trace can pass ampacity yet drop too much voltage.',
  confidence: 'medium',
  date_accessed: '2026-07-19',
}

/**
 * Castellated half-hole minimums — the plated notch-pads on a solder-down module's edge (an ESP-12, an
 * RF module). The profile route BISECTS the plated hole, leaving a half-barrel, so a castellated pad needs
 * MORE margin than a normal through-hole to keep that half of the plating from tearing off during the edge
 * cut: a bigger drill (≥ 0.6 mm), a wider copper ring (≥ 0.25 mm), and a wider hole-to-hole pitch (≥ 0.6 mm
 * edge-to-edge). Fabs publish 0.6 mm as the standard castellated-hole minimum (0.5 mm on special processes).
 */
/**
 * Copper-to-edge clearance on a V-SCORED board edge — larger than the 0.3 mm routed-edge rule. A V-score
 * is a shallow groove cut into the top and bottom of the panel along the separation line; the board is
 * later snapped along it. The scoring blade has a finite tip radius and the snap flexes the board, so
 * copper too close to a V-scored line chips or lifts. Fabs ask for ≥ 0.4 mm copper-to-edge on a V-cut
 * (vs ≥ 0.3 mm on a routed edge). Only the edges a board declares V-scored use this tighter value.
 */
export const V_CUT_EDGE_CLEARANCE_MM = 0.4
export const V_CUT_PROVENANCE: FootprintProvenance = {
  source_type: 'reference',
  title: 'V-scored edge copper-to-edge ≥ 0.4 mm (vs 0.3 mm routed)',
  citation:
    'JLCPCB / PCBWay V-scoring (V-cut) design rules: keep copper ≥ 0.4 mm from a V-scored edge — larger than a routed edge — because the scoring groove + snap can chip or lift copper at the score line.',
  confidence: 'high',
  url: 'https://jlcpcb.com/capabilities/pcb-capabilities',
  date_accessed: '2026-07-19',
}

export const CASTELLATED_MIN_DRILL_MM = 0.6
export const CASTELLATED_RING_MM = 0.25
export const CASTELLATED_EDGE_TO_EDGE_MM = 0.6
export const CASTELLATED_PROVENANCE: FootprintProvenance = {
  source_type: 'reference',
  title: 'Castellated half-hole ≥ 0.6 mm drill, ≥ 0.25 mm ring, ≥ 0.6 mm edge-to-edge',
  citation:
    'JLCPCB castellated-hole design requirements: minimum castellated hole 0.6 mm, plated half-hole on the board edge; keep ≥ 0.6 mm between adjacent castellated holes so the edge cut does not tear the shared plating. The half-barrel needs a wider ring (~0.25 mm) than a normal PTH (0.15 mm). 0.5 mm is an absolute floor on special processes.',
  confidence: 'high',
  url: 'https://jlcpcb.com/blog/castellated-pcbs-introduction-and-design-requirements',
  date_accessed: '2026-07-19',
}

/**
 * Minimum manufacturable copper feature (track WIDTH and cross-net SPACING) as a function of COPPER WEIGHT:
 * thicker copper etches with more sideways undercut, so the finest feature a fab can hold GROWS with weight.
 * The old flat 0.2 mm track-width floor was KiCad's editor default, not a fab spec — it over-rejected makeable
 * 0.127 mm traces AND disagreed with the 0.127 mm spacing floor. These are the JLCPCB standard-process
 * capabilities (a fab can go finer at higher cost); `one_oz` is the value when 1 oz is chosen and equals
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
    'JLCPCB PCB capabilities: the finest trace width and spacing a fab can reliably etch grows with copper weight — ~0.1 mm (4 mil) at 0.5 oz, 0.127 mm (5 mil) at 1 oz, 0.15 mm (6 mil) at 2 oz (heavier copper etches with more undercut). These are the reliable low-cost design minimums; a fab can go finer (to ~0.09 mm / 3.5 mil at 1 oz) at higher cost / lower yield — we use the conservative recommended floor. Supersedes the flat 0.2 mm KiCad editor default.',
  confidence: 'high',
  url: 'https://jlcpcb.com/capabilities/pcb-capabilities',
  date_accessed: '2026-07-19',
}

/** The minimum manufacturable track width / cross-net spacing (mm) for a copper weight — 1 oz default. */
export const minCopperFeatureMm = (weight?: CopperWeight): number =>
  MIN_COPPER_FEATURE_MM[weight ?? 'one_oz']

/**
 * IPC-2221B Table 6-1, column B2 (external conductors, UNCOATED, sea level to 3050 m) — the minimum copper
 * spacing between two conductors as a function of the PEAK voltage BETWEEN them (peak = amplitude for AC).
 * A manufacturing spacing floor (~0.13 mm) is plenty at logic voltages, but two nets hundreds of volts
 * apart need MILLIMETRES of air/board or they arc or track across the surface. This is the electrical
 * requirement, separate from (and usually larger than) the etch-capability floor. Values verified against
 * multiple independent reproductions of IPC-2221B Table 6-1 (2026-07-19).
 */
export function ipc2221ClearanceMm(peakVoltsBetween: number): number {
  const v = Math.abs(peakVoltsBetween)
  if (v <= 30) return 0.1
  if (v <= 150) return 0.6 // 31–150 V band
  if (v <= 300) return 1.25 // 151–300 V band
  if (v <= 500) return 2.5 // 301–500 V band
  return 2.5 + (v - 500) * 0.005 // > 500 V: +0.005 mm per volt
}

export const VOLTAGE_CLEARANCE_PROVENANCE: FootprintProvenance = {
  source_type: 'standard',
  title: 'IPC-2221B Table 6-1 (B2) — voltage-based conductor spacing (external, uncoated, ≤3050 m)',
  citation:
    'IPC-2221B Generic Standard on Printed Board Design, Table 6-1, column B2 (external conductors, uncoated, sea level to 3050 m): minimum spacing keyed on the PEAK voltage between two conductors — ≤30 V: 0.1 mm; 31–150 V: 0.6 mm; 151–300 V: 1.25 mm; 301–500 V: 2.5 mm; >500 V: 2.5 + (V−500)·0.005 mm. The voltage is the peak (AC amplitude or DC) potential difference between the conductors.',
  confidence: 'high',
  date_accessed: '2026-07-19',
}

/**
 * IEC 60664-1 Table 4 CREEPAGE distances — the minimum SURFACE separation two conductors need so the board
 * material doesn't slowly TRACK (carbonise a conductive path) between them. Distinct from air CLEARANCE
 * (IPC-2221B above): creepage is over the FR4 surface and, at higher voltages / dirtier environments, is the
 * LARGER (governing) requirement. This is the pollution-degree-2 (typical enclosed board), material-group
 * IIIa column — FR4's CTI (~175) puts it at the bottom of group IIIa, the conservative choice. The table is
 * indexed by RMS / DC WORKING voltage. Below the 60 V DC touch-safe (SELV) threshold the stringent creepage
 * is not a safety requirement (and applying it would flag every logic board), so this returns 0 there.
 */
export const CREEPAGE_SELV_THRESHOLD_V = 60
const CREEPAGE_TABLE_PD2_IIIA: readonly [number, number][] = [
  [25, 0.5],
  [32, 0.53],
  [40, 1.1],
  [50, 1.2],
  [63, 1.25],
  [80, 1.3],
  [100, 1.4],
  [125, 1.5],
  [160, 1.6],
  [200, 2.0],
  [250, 2.5],
  [320, 3.2],
  [400, 4.0],
  [500, 5.0],
  [630, 6.3],
  [800, 8.0],
  [1000, 10.0],
]
export function creepageMm(workingVoltsBetween: number): number {
  const v = Math.abs(workingVoltsBetween)
  if (v <= CREEPAGE_SELV_THRESHOLD_V) return 0 // SELV / touch-safe — no creepage safety requirement
  const t = CREEPAGE_TABLE_PD2_IIIA
  for (let i = 1; i < t.length; i++) {
    const lo = t[i - 1] as [number, number]
    const hi = t[i] as [number, number]
    if (v <= hi[0]) return lo[1] + ((hi[1] - lo[1]) * (v - lo[0])) / (hi[0] - lo[0])
  }
  // Above 1000 V: extend on the last table slope (0.01 mm/V), never smaller than the top value.
  const last = t[t.length - 1] as [number, number]
  const prev = t[t.length - 2] as [number, number]
  return last[1] + ((last[1] - prev[1]) / (last[0] - prev[0])) * (v - last[0])
}

export const CREEPAGE_PROVENANCE: FootprintProvenance = {
  source_type: 'standard',
  title: 'IEC 60664-1 Table 4 — creepage distance (pollution degree 2, material group IIIa / FR4)',
  citation:
    'IEC 60664-1 (insulation coordination for low-voltage equipment) Table 4 "Creepage distances to avoid failure due to tracking", pollution degree 2, material group IIIa (FR4, CTI ≈ 175). Keyed on RMS/DC working voltage: 100 V → 1.4 mm, 250 V → 2.5 mm, 400 V → 4.0 mm, 500 V → 5.0 mm, 1000 V → 10.0 mm (linearly interpolated). Values reproduced in Sierra Circuits "PCB Line Spacing, Creepage & Clearance", cross-checked against the Standard Clarity IEC 60664-1 calculator at multiple anchor voltages.',
  confidence: 'high',
  url: 'https://www.protoexpress.com/blog/importance-pcb-line-spacing-creepage-clearance/',
  date_accessed: '2026-07-19',
  notes:
    'Conditions: pollution degree 2, material group IIIa, applied only above the 60 V DC (SELV) touch-safe threshold. The required conductor separation is max(IPC-2221B clearance, this creepage); creepage governs at higher voltages.',
}

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
 * Minimum plated DRILL diameter = max(0.15 mm hard floor, board thickness ÷ 8). A plated through-hole has an
 * ASPECT-RATIO limit (hole depth ÷ diameter ≤ ~8:1 on the standard process): a hole too narrow for the
 * board's thickness can't be evenly copper-plated down its barrel. So the min drill GROWS with board
 * thickness — a 1.6 mm board allows 0.20 mm, a 2.4 mm board 0.30 mm. The old flat 0.3 mm was only correct
 * for a 2.4 mm board and over-rejected finer holes on thinner boards. Omitted thickness assumes the thickest
 * standard board (2.4 mm → 0.30 mm), reproducing the old floor as a fail-safe for unknown-thickness callers.
 */
export const DRILL_ASPECT_RATIO = 8
export const MIN_DRILL_HARD_MM = 0.15
const FALLBACK_THICKNESS_MM = 2.4

export const minDrillMm = (boardThicknessMm?: number): number =>
  Math.max(MIN_DRILL_HARD_MM, (boardThicknessMm ?? FALLBACK_THICKNESS_MM) / DRILL_ASPECT_RATIO)

export const MIN_DRILL_PROVENANCE: FootprintProvenance = {
  source_type: 'reference',
  title: 'Minimum plated drill = max(0.15 mm, board thickness ÷ 8) — hard floor + 8:1 aspect ratio',
  citation:
    'JLCPCB PCB capabilities + IPC-2221B / IPC-6012 plated-through-hole aspect ratio: the smallest reliably platable hole is the larger of a 0.15 mm hard drill minimum (0.2 mm recommended) and thickness ÷ 8 (the 8:1 standard plating aspect ratio — a thin hole in a thick board cannot be evenly plated). A 1.6 mm board → 0.20 mm, a 2.4 mm board → 0.30 mm. Replaces the flat 0.3 mm, which was only correct for a 2.4 mm board.',
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

/**
 * Component-to-board-edge assembly keepout (3 mm) — the minimum part-free RAIL an SMT line needs at the
 * board edge for the conveyor to grip and the pick-and-place to reach (a part body closer than this can be
 * clipped by handling or unreachable by the nozzle). Distinct from the 0.3 mm COPPER edge clearance (that's
 * the mill tolerance; this is the physical part body). Measured to the fabrication (body) outline. The
 * auto-derived board fits with a 3 mm margin so it passes; this fires if a part is dragged too close.
 */
export const COMPONENT_EDGE_KEEPOUT_MM = 3

export const COMPONENT_EDGE_KEEPOUT_PROVENANCE: FootprintProvenance = {
  source_type: 'reference',
  title: 'Component-to-board-edge assembly keepout ≈ 3 mm (SMT conveyor rail)',
  citation:
    'IPC-2221 / IPC-7351 assembly guidance + common SMT-assembler DFM (e.g. JLCPCB, PCBWay assembly rules): parts should sit ≥ ~3 mm (rail edges) from the board edge so the conveyor rails can grip the board and the placement head can reach every part; tighter needs a breakaway rail. Separate from the 0.3 mm copper-to-edge (mill) clearance.',
  confidence: 'medium',
  url: 'https://jlcpcb.com/capabilities/pcb-assembly-capabilities',
  date_accessed: '2026-07-19',
}

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
    | 'voltage-clearance'
    | 'component-edge'
    | 'ir-drop'
    | 'castellated-hole'
  >,
  { limitMm: number; provenance: FootprintProvenance }
> = {
  'silk-over-pad': {
    // A POSITIVE gap, not just non-overlap: the solder-mask opening is slightly larger than the copper pad,
    // and silk within ~0.15 mm of it gets clipped or bleeds onto the joint. So silk ink must clear the pad
    // copper by ≥ 0.15 mm (which also covers the mask expansion), not merely avoid overlapping it.
    limitMm: 0.15,
    provenance: {
      source_type: 'reference',
      title: 'Silkscreen must clear pads by ≥ 0.15 mm — fabs clip ink near the mask opening',
      citation:
        'JLCPCB / OSH Park PCB capabilities: silkscreen must keep ≥ ~0.15 mm from a pad (its solder-mask opening); ink closer is clipped during fabrication (it disappears) or bleeds onto the solder joint. KiCad ships the same check (DRC “silkscreen clipped by solder mask”).',
      confidence: 'high',
      url: 'https://jlcpcb.com/capabilities/pcb-capabilities',
      date_accessed: '2026-07-19',
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

/** A placement's fabrication (component BODY) outline as a board-space box — the physical part extent (
 *  smaller than the courtyard), for the assembly edge-keepout. undefined when the footprint has no body. */
function bodyBox(pl: Placement): { x: number; y: number; w: number; h: number } | undefined {
  const fp = footprintByPlacement(pl)
  if (fp === undefined) return undefined
  const b = fabricationBounds(fp)
  if (b === undefined) return undefined
  const corners = [
    placePoint(pl, { x: b.x, y: b.y }),
    placePoint(pl, { x: b.x + b.w, y: b.y }),
    placePoint(pl, { x: b.x + b.w, y: b.y + b.h }),
    placePoint(pl, { x: b.x, y: b.y + b.h }),
  ]
  const xs = corners.map((p) => p.x)
  const ys = corners.map((p) => p.y)
  const x0 = Math.min(...xs)
  const y0 = Math.min(...ys)
  return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 }
}

const fmt = (v: number) => (Math.round(v * 100) / 100).toString()
const fmtA = (v: number) => (Math.round(v * 1000) / 1000).toString() // amps, mA precision

/** Min distance (mm) from a copper box (AABB) to a closed board-edge RING — the ring sampled finely (0.1 mm),
 *  each sample's point-to-box distance taken. Used to check copper clearance to a HAND-DRAWN (polygon) edge;
 *  a rectangular board uses the exact per-side comparison instead. Targets simple/convex outlines. */
function distRingToBox(
  ring: readonly { x: number; y: number }[],
  box: { x: number; y: number; w: number; h: number },
): number {
  const pointToBox = (px: number, py: number) =>
    Math.hypot(
      Math.max(box.x - px, 0, px - (box.x + box.w)),
      Math.max(box.y - py, 0, py - (box.y + box.h)),
    )
  let min = Number.POSITIVE_INFINITY
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const a = ring[i] as { x: number; y: number }
    const b = ring[(i + 1) % n] as { x: number; y: number }
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.1))
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const d = pointToBox(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
      if (d < min) min = d
    }
  }
  return min
}

/** Is a point INSIDE a closed board-edge ring (even-odd ray cast)? A copper box or part body whose centre
 *  falls outside the real polygon is off the board even when it is far from any single edge — the concave
 *  L-cutaway case a distance-to-edge test alone would miss. */
function pointInRing(px: number, py: number, ring: readonly { x: number; y: number }[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as { x: number; y: number }
    const b = ring[j] as { x: number; y: number }
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x)
      inside = !inside
  }
  return inside
}

/** Every copper rectangle on the board (pads as-is; trace segments at their real width). A castellated
 *  pad is tagged so the edge checks can exempt it — it BELONGS on the board edge. */
function copperBoxes(
  ratsnest: Ratsnest,
  routing: BoardRouting,
): { x: number; y: number; w: number; h: number; what: string; castellated?: boolean }[] {
  const out: { x: number; y: number; w: number; h: number; what: string; castellated?: boolean }[] =
    []
  for (const pad of ratsnest.padBoxes) {
    out.push({
      x: pad.x,
      y: pad.y,
      w: pad.w,
      h: pad.h,
      what: `a pad (${pad.net})`,
      ...(pad.castellated ? { castellated: true } : {}),
    })
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
    /** The board's finished thickness (mm) — sets the min plated-drill floor via the 8:1 aspect ratio.
     *  Omitted ⇒ assumes the thickest standard board (fail-safe: the strictest 0.30 mm floor). */
    boardThicknessMm?: number
    /** Per-net SIGNED node voltage (V) from the solve — enables the voltage-clearance check (two nets far
     *  apart in potential need extra spacing so they don't arc). Signed so a +150/−150 pair reads 300 V,
     *  not 0. Absent ⇒ the check is skipped (no faked voltages). DC operating point today; AC-peak later. */
    netVolts?: Map<string, number>
    /** Per-pad current (magnitude), keyed by the pad's `partId/padId`. When present, a multi-drop
     *  net's copper is resolved into a tree and each TRACE SEGMENT is checked against the current it
     *  actually carries — so a thin branch off a high-current trunk is checked against its own small
     *  load, not the trunk. Absent ⇒ every segment falls back to the whole-net max (the old behaviour). */
    padCurrents?: Map<string, number>
  },
): DrcViolation[] {
  // The plated-drill floor grows with board thickness (8:1 aspect ratio); shared by the via + pad checks.
  const minDrill = minDrillMm(opts?.boardThicknessMm)
  const out: DrcViolation[] = []

  // Single-board size window: too small must be panelized, too large exceeds the production panel.
  {
    const { w, h } = board.outline
    const center = { x: board.outline.x + w / 2, y: board.outline.y + h / 2 }
    const smallest = Math.min(w, h)
    const largest = Math.max(w, h)
    // Independent checks (not else-if): a pathological outline can be both too narrow AND too long.
    if (smallest < MIN_BOARD_MM) {
      out.push({
        code: 'board-size',
        message: `the board is ${fmt(smallest)} mm on its smallest side — under the ${fmt(MIN_BOARD_MM)} mm single-board minimum; a board this small must be panelized into an array`,
        at: center,
      })
    }
    if (largest > MAX_BOARD_MM) {
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
  // same 0.127 mm as before, a 2 oz board is held to 0.15 mm. When the weight is UNKNOWN (a caller that
  // omits it) we assume the HEAVIEST, widest floor so it fails SAFE — over-reject rather than pass an
  // unmakeable gap. The live board always passes its real weight, so this only guards other callers.
  const spacingFloor = minCopperFeatureMm(opts?.copperWeight ?? 'two_oz')
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

  // Voltage clearance (IPC-2221B Table 6-1, B2) — two nets far apart in POTENTIAL need extra copper-to-copper
  // spacing or they arc / surface-track. Separate from the manufacturing spacing floor and usually larger.
  // Only pairs whose required spacing EXCEEDS that floor add anything (below ~50 V the floor already covers
  // them), so a normal logic board does no extra work. For each distinct required spacing R among the
  // high-ΔV pairs, run the clearance check at R and flag the pairs whose OWN requirement is exactly R and
  // whose copper is closer than it. Uses the solved SIGNED per-net voltage (DC operating point today).
  const netVolts = opts?.netVolts
  if (netVolts !== undefined) {
    const boardNets = new Set<string>()
    for (const p of ratsnest.padBoxes) boardNets.add(p.net)
    for (const t of routing.traces) boardNets.add(t.net)
    const nets = [...boardNets]
    const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
    const requiredByPair = new Map<
      string,
      { req: number; dv: number; governs: 'clearance' | 'creepage' }
    >()
    const distinctReq = new Set<number>()
    for (let i = 0; i < nets.length; i++) {
      for (let j = i + 1; j < nets.length; j++) {
        const a = nets[i] as string
        const b = nets[j] as string
        const dv = Math.abs((netVolts.get(a) ?? 0) - (netVolts.get(b) ?? 0))
        // The required separation is the LARGER of air clearance (IPC-2221B) and surface creepage
        // (IEC 60664-1); creepage governs at higher voltages / over the FR4 surface.
        const clearanceReq = ipc2221ClearanceMm(dv)
        const creepageReq = creepageMm(dv)
        const req = Math.max(clearanceReq, creepageReq)
        if (req > spacingFloor + 1e-9) {
          requiredByPair.set(pairKey(a, b), {
            req,
            dv,
            governs: creepageReq > clearanceReq ? 'creepage' : 'clearance',
          })
          distinctReq.add(req)
        }
      }
    }
    const voltageFlagged = new Set<string>()
    for (const R of distinctReq) {
      for (const cv of clearanceViolations(routing, ratsnest.padBoxes, {
        ...cls,
        clearanceMm: R,
      })) {
        const key = pairKey(cv.netA, cv.netB)
        const entry = requiredByPair.get(key)
        if (entry === undefined || Math.abs(entry.req - R) > 1e-9 || voltageFlagged.has(key))
          continue
        voltageFlagged.add(key)
        const rule =
          entry.governs === 'creepage'
            ? 'IEC 60664-1 surface creepage, pollution degree 2'
            : 'IPC-2221B air clearance'
        out.push({
          code: 'voltage-clearance',
          message: `two nets ~${fmt(entry.dv)} V apart are closer than the ${fmt(entry.req)} mm they need (${rule}) — they can arc or track across the gap`,
          at: cv.at,
        })
      }
    }
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

  // Copper to board edge — the mill tears (or the V-score snap chips) copper closer than the limit. Each
  // of the four sides has its OWN limit: a V-SCORED edge needs the wider 0.4 mm, a routed edge the 0.3 mm.
  // A castellated pad is EXEMPT: it is a plated half-hole meant to sit ON the edge (the profile bisects it),
  // held instead to the wider castellated minimums below.
  const routedEdge = DRC_RULES['edge-clearance'].limitMm
  const scoredSides = new Set(board.vScoredSides ?? [])
  const sideLimit = (side: BoardSide) =>
    scoredSides.has(side) ? V_CUT_EDGE_CLEARANCE_MM : routedEdge
  const o = board.outline
  // A HAND-DRAWN profile: measure each copper box against the real polygon edge (every edge treated as
  // routed — per-edge V-score is a later increment). A plain rectangular board keeps the exact, per-side
  // (V-cut-aware) comparison below.
  const profileRing = board.profile !== undefined ? outlineRing(board) : undefined
  for (const c of copperBoxes(ratsnest, routing)) {
    if (c.castellated === true) continue
    if (profileRing !== undefined) {
      const cx = c.x + c.w / 2
      const cy = c.y + c.h / 2
      // Flag copper OFF the board (its centre outside the polygon — the concave-cutaway case), or copper
      // within the routed clearance of the real edge.
      const offBoard = !pointInRing(cx, cy, profileRing)
      if (offBoard || distRingToBox(profileRing, c) < routedEdge - 1e-9) {
        out.push({
          code: 'edge-clearance',
          message: offBoard
            ? `${c.what} sits outside the board outline`
            : `${c.what} sits within ${fmt(routedEdge)} mm of the board edge`,
          at: { x: cx, y: cy },
        })
      }
      continue
    }
    // The box's actual clearance from each side; a side is violated when that is under the side's limit.
    // Report the WORST (smallest-clearance) violated side by name — near a corner that's the edge the copper
    // is really closest to, with its own limit + V-scored/routed label (not just the first side in priority).
    const clearance: Record<BoardSide, number> = {
      left: c.x - o.x,
      right: o.x + o.w - (c.x + c.w),
      top: c.y - o.y,
      bottom: o.y + o.h - (c.y + c.h),
    }
    let worstSide: BoardSide | undefined
    for (const side of ['left', 'right', 'top', 'bottom'] as const) {
      if (
        clearance[side] < sideLimit(side) &&
        (worstSide === undefined || clearance[side] < clearance[worstSide])
      ) {
        worstSide = side
      }
    }
    if (worstSide !== undefined) {
      const limitMm = sideLimit(worstSide)
      const kind = scoredSides.has(worstSide) ? 'V-scored ' : ''
      out.push({
        code: 'edge-clearance',
        message: `${c.what} sits within ${fmt(limitMm)} mm of the ${kind}board edge (${worstSide})`,
        at: { x: c.x + c.w / 2, y: c.y + c.h / 2 },
      })
    }
  }

  // Component-to-edge assembly keepout — a part BODY closer than the rail keepout to the board edge can be
  // clipped by the conveyor rails or unreachable by the placement head. Measured on the fabrication (body)
  // outline; the auto-derived board's matching margin clears it, so this fires only when a part is dragged
  // too close (or a future user-tightened outline crowds a part).
  const keepout = COMPONENT_EDGE_KEEPOUT_MM
  for (const pl of board.placements) {
    const cfp = footprintByPlacement(pl)
    const body = bodyBox(pl)
    if (body === undefined) continue
    if (profileRing !== undefined) {
      // A hand-drawn edge: the part body must sit inside the real polygon and clear it by the rail keepout.
      // A castellated module is exempt (it butts the edge by design); the per-side exemption is rect-only.
      const hasCastellated = cfp?.pads.some((p) => p.castellated === true) === true
      if (hasCastellated) continue
      const bcx = body.x + body.w / 2
      const bcy = body.y + body.h / 2
      if (
        !pointInRing(bcx, bcy, profileRing) ||
        distRingToBox(profileRing, body) < keepout - 1e-6
      ) {
        out.push({
          code: 'component-edge',
          message: `${pl.designator ?? pl.partId}'s body is within ${fmt(keepout)} mm of the board edge — an SMT line needs that part-free rail to grip and place the board`,
          at: { x: bcx, y: bcy },
        })
      }
      continue
    }
    // A castellated module is DESIGNED to butt the edge(s) its half-holes sit on — exempt ONLY those sides
    // (per castellatedBoardSide). Its body still needs the conveyor-rail keepout on every OTHER edge.
    const castSides = new Set<BoardSide>()
    if (cfp !== undefined) {
      for (const pad of cfp.pads) {
        if (pad.castellated === true) castSides.add(castellatedBoardSide(cfp, pad, pl.rotation))
      }
    }
    const nearSide: BoardSide | undefined =
      !castSides.has('left') && body.x < o.x + keepout - 1e-6
        ? 'left'
        : !castSides.has('right') && body.x + body.w > o.x + o.w - keepout + 1e-6
          ? 'right'
          : !castSides.has('top') && body.y < o.y + keepout - 1e-6
            ? 'top'
            : !castSides.has('bottom') && body.y + body.h > o.y + o.h - keepout + 1e-6
              ? 'bottom'
              : undefined
    if (nearSide !== undefined) {
      out.push({
        code: 'component-edge',
        message: `${pl.designator ?? pl.partId}'s body is within ${fmt(keepout)} mm of the board edge (${nearSide}) — an SMT line needs that part-free rail to grip and place the board`,
        at: { x: body.x + body.w / 2, y: body.y + body.h / 2 },
      })
    }
  }

  // Minimum manufacturable track width — scales with the board's copper weight (thicker copper etches a
  // wider minimum feature); 1 oz keeps the 0.127 mm value, replacing the old flat 0.2 mm editor default.
  // Omitted weight assumes the heaviest (fail-safe, matching the spacing floor above).
  const minTrack = minCopperFeatureMm(opts?.copperWeight ?? 'two_oz')
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
    if (v.drillMm < minDrill) {
      out.push({
        code: 'via-size',
        message: `a ${fmt(v.drillMm)} mm via drill is under the ${fmt(minDrill)} mm minimum (0.15 mm floor or board thickness ÷ 8)`,
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
  // this catches a HAND-placed via dropped on a pad. EXEMPTION: a THERMAL pad intentionally carries a
  // filled same-net via array to conduct heat, so a same-net via inside a thermal pad is by design.
  const thermalPadKeys = new Set<string>()
  for (const pl of board.placements) {
    const fp = footprintByPlacement(pl)
    if (fp === undefined) continue
    for (const pad of fp.pads)
      if (pad.thermal === true) thermalPadKeys.add(`${pl.partId}/${pad.id}`)
  }
  for (const v of routing.vias) {
    const bx = v.at.x - v.diameterMm / 2
    const by = v.at.y - v.diameterMm / 2
    const bs = v.diameterMm
    for (const pad of ratsnest.padBoxes) {
      // open-interval overlap: a via touching a pad edge is legal; interior overlap is via-in-pad
      if (bx < pad.x + pad.w && pad.x < bx + bs && by < pad.y + pad.h && pad.y < by + bs) {
        // A same-net via inside a THERMAL pad is a deliberate (filled) thermal-via array, not a defect.
        if (v.net === pad.net && thermalPadKeys.has(pad.pad)) continue
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
      // The min-drill floor is the plating aspect-ratio (thickness ÷ 8) for a PLATED hole; a NON-plated hole
      // isn't plated, so only the mechanical hard minimum (0.15 mm) applies — else a fine mounting hole on a
      // thick board is falsely blocked.
      const padDrillFloor = pad.plated === false ? MIN_DRILL_HARD_MM : minDrill
      if (pad.holeDiameter < padDrillFloor) {
        out.push({
          code: 'drill-size',
          message: `${ref} pad ${pad.id}: a ${fmt(pad.holeDiameter)} mm hole is under the ${fmt(padDrillFloor)} mm minimum drill${pad.plated === false ? ' (non-plated hard floor)' : ' (0.15 mm floor or board thickness ÷ 8)'}`,
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
      // A PLATED component pad needs the PTH design-rule annular ring (0.15 mm) — the copper it keeps around
      // its hole so registration drift can't break the plating. A NON-plated hole (a mounting/tooling hole)
      // has no plating and no ring requirement, so it's exempt (its "pad" may be a bare hole with no copper).
      const annular = (Math.min(pad.size.w, pad.size.h) - pad.holeDiameter) / 2
      if (pad.plated !== false && annular < PTH_PAD_ANNULAR_MM) {
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

  // Castellated half-holes — the plated notch-pads on a solder-down module's edge (an ESP-12, an RF can).
  // The profile route BISECTS each plated hole, so they need the WIDER castellated minimums (bigger drill,
  // wider ring, wider pitch) to keep the half-barrel plating from tearing off, AND each must actually sit ON
  // the board edge — a castellated pad in the interior would drill a normal FULL hole (silent mismanufacture).
  const castellatedHoles: { at: { x: number; y: number }; drillMm: number; side: BoardSide }[] = []
  // A castellated pad's centre sits on the profile line; allow a small band for float + hand placement.
  const onEdgeBandMm = 0.15
  for (const pl of board.placements) {
    const fp = footprintByPlacement(pl)
    if (fp === undefined) continue
    for (const pad of fp.pads) {
      if (pad.castellated !== true) continue
      const at = placePoint(pl, pad.center)
      const ref = pl.designator ?? pl.partId
      const drill = pad.holeDiameter
      if (drill === undefined) {
        out.push({
          code: 'castellated-hole',
          message: `${ref} pad ${pad.id}: a castellated pad must be a plated hole on the edge, but it has no drill`,
          at,
        })
        continue
      }
      castellatedHoles.push({
        at,
        drillMm: drill,
        side: castellatedBoardSide(fp, pad, pl.rotation),
      })
      if (drill < CASTELLATED_MIN_DRILL_MM) {
        out.push({
          code: 'castellated-hole',
          message: `${ref} pad ${pad.id}: a ${fmt(drill)} mm castellated half-hole is under the ${fmt(CASTELLATED_MIN_DRILL_MM)} mm minimum — the edge cut would tear its half-barrel plating`,
          at,
        })
      }
      const ring = (Math.min(pad.size.w, pad.size.h) - drill) / 2
      if (ring < CASTELLATED_RING_MM) {
        out.push({
          code: 'castellated-hole',
          message: `${ref} pad ${pad.id}: a ${fmt(ring)} mm ring around a castellated half-hole is under the ${fmt(CASTELLATED_RING_MM)} mm minimum (a half-barrel needs more copper than a normal ${fmt(PTH_PAD_ANNULAR_MM)} mm ring)`,
          at,
        })
      }
      const distToEdge = Math.min(
        Math.abs(at.x - o.x),
        Math.abs(at.x - (o.x + o.w)),
        Math.abs(at.y - o.y),
        Math.abs(at.y - (o.y + o.h)),
      )
      if (distToEdge > onEdgeBandMm) {
        out.push({
          code: 'castellated-hole',
          message: `${ref} pad ${pad.id}: a castellated pad sits ${fmt(distToEdge)} mm from the nearest board edge — a half-hole must be ON the edge (the profile route bisects it) or it drills as a normal full hole`,
          at,
        })
      }
    }
  }
  // Adjacent castellated half-holes need a wider edge-to-edge pitch than a normal drill, so the shared
  // profile cut between them doesn't tear the plating off either one. Only holes on the SAME board edge
  // share a cut — two on opposite/perpendicular edges are separated by solid FR4, so they're not paired.
  for (let i = 0; i < castellatedHoles.length; i++) {
    const a = castellatedHoles[i]
    if (a === undefined) continue
    for (let j = i + 1; j < castellatedHoles.length; j++) {
      const b = castellatedHoles[j]
      if (b === undefined || b.side !== a.side) continue
      const gap = Math.hypot(a.at.x - b.at.x, a.at.y - b.at.y) - (a.drillMm + b.drillMm) / 2
      if (gap < CASTELLATED_EDGE_TO_EDGE_MM - 1e-9) {
        out.push({
          code: 'castellated-hole',
          message: `two castellated half-holes sit ${fmt(Math.max(0, gap))} mm apart — under the ${fmt(CASTELLATED_EDGE_TO_EDGE_MM)} mm minimum; the edge cut can tear the plating between them`,
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
    // The ink must clear the pad copper by ≥ the silk-to-pad clearance (which covers the mask opening) — so
    // a stroke sample is a violation when its distance-to-pad is under stroke-half + that clearance.
    const g = strokeWidth / 2 + DRC_RULES['silk-over-pad'].limitMm
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
          message: `${partId}'s silkscreen is within ${fmt(DRC_RULES['silk-over-pad'].limitMm)} mm of an exposed pad (${pad.pad}) — the fab clips ink that close to the mask opening`,
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

  // IR-drop — a power rail can pass ampacity (a thermal limit) yet drop too much RESISTIVE voltage (I·R)
  // across its copper, sagging the rail below what the load needs. Runs only with solved currents + voltages
  // + copper weight. For each POWER net (|V| ≥ 1 V — a rail, not ground/signal), the conservative series drop
  // I × total-rail-trace-resistance vs the 5%-of-rail budget.
  if (
    opts?.netCurrents !== undefined &&
    opts.netVolts !== undefined &&
    opts.copperWeight !== undefined
  ) {
    const weight = opts.copperWeight
    const railResistance = new Map<string, number>()
    for (const t of routing.traces) {
      let len = 0
      for (let i = 0; i < t.points.length - 1; i++) {
        const a = t.points[i]
        const b = t.points[i + 1]
        if (a === undefined || b === undefined) continue
        len += Math.hypot(b.x - a.x, b.y - a.y)
      }
      if (len <= 0) continue
      railResistance.set(
        t.net,
        (railResistance.get(t.net) ?? 0) + traceResistanceOhm(t.widthMm, len, weight),
      )
    }
    for (const [net, r] of railResistance) {
      const railV = Math.abs(opts.netVolts.get(net) ?? 0)
      const railI = opts.netCurrents.get(net) ?? 0
      if (railV < 1 || railI <= 1e-9 || r <= 0) continue // only real power rails carrying current
      const dropV = railI * r
      const budgetV = IR_DROP_BUDGET_FRACTION * railV
      if (dropV <= budgetV) continue
      const at = routing.traces.find((t) => t.net === net)?.points[0] ?? { x: 0, y: 0 }
      out.push({
        code: 'ir-drop',
        message: `net ${net} (~${fmt(railV)} V rail) drops ${fmt(dropV * 1000)} mV of IR (${fmt((dropV / railV) * 100)}% at ${fmtA(railI)} A) — over its ${fmt(budgetV * 1000)} mV (${fmt(IR_DROP_BUDGET_FRACTION * 100)}%) budget. Widen the rail's copper or shorten its path.`,
        at,
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

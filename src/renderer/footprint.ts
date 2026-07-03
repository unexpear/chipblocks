/**
 * The footprint model — a part's PHYSICAL package: the copper pads it solders to, its silkscreen
 * outline, and its courtyard (the keep-out the assembly machine needs around it). This is the first
 * brick of the board road (TOOLCHAIN-ROADMAP.md Track 1): the schematic says what a part IS, the
 * footprint says how it physically lands on copper — the bridge from a drawn circuit to a real PCB.
 *
 * All geometry is in REAL millimetres, origin at the footprint's centre (the KiCad/EDA convention), so
 * a footprint's numbers ARE its manufacturing dimensions. Per the project's anti-placeholder rule every
 * shipped footprint's dimensions are cited to a real land-pattern source (IPC-7351 via the public KiCad
 * footprint library), so "where did this pad size come from?" always has an answer.
 */

/** How a footprint value was sourced — the same provenance shape the YAML catalog uses (OBJECT-MODEL §9). */
export type FootprintProvenance = {
  source_type: 'reference' | 'standard' | 'datasheet' | 'measurement' | 'derived'
  title: string
  citation: string
  confidence: 'high' | 'medium' | 'low' | 'unknown'
  url?: string
  date_accessed?: string
  notes?: string
}

export type PadShape = 'rect' | 'roundrect' | 'circle' | 'oval'
/** SMD = a flat pad on one copper layer; through-hole = a plated hole a leg passes through. */
export type PadType = 'smd' | 'through_hole'

export type Pad = {
  /** Pad name/number as the part's datasheet labels it ('1', '2', 'A1', 'GND', …). */
  id: string
  /** Copper centre in mm, relative to the footprint origin. */
  center: { x: number; y: number }
  /** Copper extent in mm (the land the pin solders to). */
  size: { w: number; h: number }
  shape: PadShape
  type: PadType
  /** Drill diameter in mm — through-hole pads only. */
  holeDiameter?: number
}

/** A silkscreen line segment (the white outline printed on the board), in mm. */
export type SilkLine = {
  from: { x: number; y: number }
  to: { x: number; y: number }
  width: number
}

/** The courtyard keep-out rectangle (assembly clearance), in mm, as a min-corner + extent. */
export type Courtyard = { x: number; y: number; w: number; h: number }

/** Where the two board texts anchor — KiCad's Reference (the R1/C3 designator) + Value. */
export type FootprintLabels = {
  reference: { x: number; y: number }
  value: { x: number; y: number }
}

export type Footprint = {
  /** Stable id, EDA-style ('R_0603_1608Metric'). */
  id: string
  /** Human label for the picker. */
  name: string
  description: string
  pads: Pad[]
  /** The white outline PRINTED on the board (F.SilkS) — what a human sees on the assembled PCB. */
  silkscreen: SilkLine[]
  /** The actual component BODY outline (KiCad's F.Fab layer) — the part's real footprint on the board,
   *  used for assembly drawings + collision checks. Distinct from silkscreen: silk is ink, fab is the part. */
  fabrication: SilkLine[]
  /** Anchors for the reference designator + value text the board places on this footprint. */
  labels: FootprintLabels
  courtyard: Courtyard
  provenance: FootprintProvenance
}

/**
 * 0603 (imperial) / 1608 (metric) two-terminal chip land pattern — the workhorse SMD package for
 * resistors and small capacitors. Geometry is the IPC-7351 nominal (density level B) land pattern as
 * published in the public KiCad footprint library (Resistor_SMD.pretty/R_0603_1608Metric.kicad_mod):
 * two 0.8 × 0.95 mm pads on 1.65 mm centres, a 2.96 × 1.46 mm courtyard. Reproducible — the identical
 * footprint opens in KiCad.
 */
export const FOOTPRINT_0603: Footprint = {
  id: 'R_0603_1608Metric',
  name: '0603 (1608 metric) chip',
  description:
    'Two-terminal SMD chip land pattern — resistors, small capacitors. IPC-7351 nominal.',
  pads: [
    {
      id: '1',
      center: { x: -0.825, y: 0 },
      size: { w: 0.8, h: 0.95 },
      shape: 'roundrect',
      type: 'smd',
    },
    {
      id: '2',
      center: { x: 0.825, y: 0 },
      size: { w: 0.8, h: 0.95 },
      shape: 'roundrect',
      type: 'smd',
    },
  ],
  silkscreen: [
    { from: { x: -0.237258, y: -0.5225 }, to: { x: 0.237258, y: -0.5225 }, width: 0.12 },
    { from: { x: -0.237258, y: 0.5225 }, to: { x: 0.237258, y: 0.5225 }, width: 0.12 },
  ],
  // The component body outline (F.Fab): a 1.6 × 0.825 mm rectangle — the actual chip, as KiCad draws it
  // on the fabrication layer. Four edges of the rect (-0.8, -0.4125) → (0.8, 0.4125).
  fabrication: [
    { from: { x: -0.8, y: -0.4125 }, to: { x: 0.8, y: -0.4125 }, width: 0.1 },
    { from: { x: 0.8, y: -0.4125 }, to: { x: 0.8, y: 0.4125 }, width: 0.1 },
    { from: { x: 0.8, y: 0.4125 }, to: { x: -0.8, y: 0.4125 }, width: 0.1 },
    { from: { x: -0.8, y: 0.4125 }, to: { x: -0.8, y: -0.4125 }, width: 0.1 },
  ],
  labels: { reference: { x: 0, y: -1.43 }, value: { x: 0, y: 1.43 } },
  courtyard: { x: -1.48, y: -0.73, w: 2.96, h: 1.46 },
  provenance: {
    source_type: 'standard',
    title: 'IPC-7351 nominal (density level B) 0603/1608 chip land pattern',
    citation:
      'KiCad footprint library (kicad-footprints), Resistor_SMD.pretty/R_0603_1608Metric.kicad_mod — IPC-7351-derived; two 0.8×0.95 mm pads on 1.65 mm centres',
    confidence: 'high',
    url: 'https://gitlab.com/kicad/libraries/kicad-footprints',
    notes:
      'Reproducible: the identical footprint opens in KiCad. Body size 1.6×0.8 mm (the 1608 metric name).',
  },
}

/** Every built-in footprint, keyed by id. Grows as the starter set lands (SOIC-8, DIP-8, headers). */
export const BUILTIN_FOOTPRINTS: Record<string, Footprint> = {
  [FOOTPRINT_0603.id]: FOOTPRINT_0603,
}

/**
 * The mm bounding box that contains everything a footprint draws (pads + silkscreen + courtyard) — the
 * courtyard is the outermost by construction, but pads/silk are unioned in so a bad courtyard can't clip
 * the render. Used to frame + scale the footprint viewer.
 */
export function footprintBounds(fp: Footprint): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  let minX = fp.courtyard.x
  let minY = fp.courtyard.y
  let maxX = fp.courtyard.x + fp.courtyard.w
  let maxY = fp.courtyard.y + fp.courtyard.h
  const grow = (x: number, y: number) => {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  for (const p of fp.pads) {
    grow(p.center.x - p.size.w / 2, p.center.y - p.size.h / 2)
    grow(p.center.x + p.size.w / 2, p.center.y + p.size.h / 2)
  }
  for (const s of [...fp.silkscreen, ...fp.fabrication]) {
    grow(s.from.x, s.from.y)
    grow(s.to.x, s.to.y)
  }
  // The reference/value text sits outside the courtyard (KiCad places them at ±1.43 on a 0603) —
  // include the anchors so the framed viewer doesn't clip the designator.
  grow(fp.labels.reference.x, fp.labels.reference.y)
  grow(fp.labels.value.x, fp.labels.value.y)
  return { minX, minY, maxX, maxY }
}

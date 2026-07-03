/**
 * The footprint model — a part's PHYSICAL package: the copper pads it solders to, its silkscreen
 * outline, and its courtyard (the keep-out the assembly machine needs around it). This is the first
 * brick of the board road (TOOLCHAIN-ROADMAP.md Track 1): the schematic says what a part IS, the
 * footprint says how it physically lands on copper — the bridge from a drawn circuit to a real PCB.
 *
 * All geometry is in REAL millimetres relative to the footprint origin (the part centre for SMD chips,
 * or pin 1 for through-hole ICs — the KiCad/EDA convention), so a footprint's numbers ARE its
 * manufacturing dimensions. Per the project's anti-placeholder rule every
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

/**
 * Where the three board texts anchor — mirroring KiCad's footprint text set:
 *  - `reference`: the R1/C3 designator, on silkscreen (what's printed on the board);
 *  - `value`: the part value / footprint name, on the fabrication layer;
 *  - `fabReference`: a SECOND copy of the designator, on the fabrication layer at the part centre, so an
 *    assembler can read which part is which on the bare board (KiCad's `${REFERENCE}` fab text).
 */
export type FootprintLabels = {
  reference: { x: number; y: number }
  value: { x: number; y: number }
  fabReference: { x: number; y: number }
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
  labels: {
    reference: { x: 0, y: -1.43 },
    value: { x: 0, y: 1.43 },
    fabReference: { x: 0, y: 0 },
  },
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

/** A rectangle as four line segments (the common body-outline / silk shape), in mm. */
function rectOutline(x0: number, y0: number, x1: number, y1: number, width = 0.1): SilkLine[] {
  return [
    { from: { x: x0, y: y0 }, to: { x: x1, y: y0 }, width },
    { from: { x: x1, y: y0 }, to: { x: x1, y: y1 }, width },
    { from: { x: x1, y: y1 }, to: { x: x0, y: y1 }, width },
    { from: { x: x0, y: y1 }, to: { x: x0, y: y0 }, width },
  ]
}

/**
 * SOIC-8 (3.9×4.9 mm body, 1.27 mm pitch) — the 8-lead small-outline IC, gull-wing SMD. Pads + courtyard
 * + text anchors are verbatim from KiCad (Package_SO.pretty/SOIC-8_3.9x4.9mm_P1.27mm.kicad_mod); the
 * silk + fab body are the outline rectangles (KiCad additionally chamfers the pin-1 corner). Pin 1 is
 * the roundrect pad (2–8 keep the same size); orientation reads off that, KiCad's convention.
 */
export const FOOTPRINT_SOIC8: Footprint = {
  id: 'SOIC-8_3.9x4.9mm_P1.27mm',
  name: 'SOIC-8 (3.9×4.9 mm, 1.27 mm pitch)',
  description: '8-lead small-outline IC — gull-wing SMD, 1.27 mm pitch. JEDEC MS-012 / IPC-7351.',
  pads: [
    {
      id: '1',
      center: { x: -2.475, y: -1.905 },
      size: { w: 1.95, h: 0.6 },
      shape: 'roundrect',
      type: 'smd',
    },
    {
      id: '2',
      center: { x: -2.475, y: -0.635 },
      size: { w: 1.95, h: 0.6 },
      shape: 'roundrect',
      type: 'smd',
    },
    {
      id: '3',
      center: { x: -2.475, y: 0.635 },
      size: { w: 1.95, h: 0.6 },
      shape: 'roundrect',
      type: 'smd',
    },
    {
      id: '4',
      center: { x: -2.475, y: 1.905 },
      size: { w: 1.95, h: 0.6 },
      shape: 'roundrect',
      type: 'smd',
    },
    {
      id: '5',
      center: { x: 2.475, y: 1.905 },
      size: { w: 1.95, h: 0.6 },
      shape: 'roundrect',
      type: 'smd',
    },
    {
      id: '6',
      center: { x: 2.475, y: 0.635 },
      size: { w: 1.95, h: 0.6 },
      shape: 'roundrect',
      type: 'smd',
    },
    {
      id: '7',
      center: { x: 2.475, y: -0.635 },
      size: { w: 1.95, h: 0.6 },
      shape: 'roundrect',
      type: 'smd',
    },
    {
      id: '8',
      center: { x: 2.475, y: -1.905 },
      size: { w: 1.95, h: 0.6 },
      shape: 'roundrect',
      type: 'smd',
    },
  ],
  silkscreen: rectOutline(-2.06, -2.56, 2.06, 2.56, 0.12),
  fabrication: rectOutline(-1.95, -2.45, 1.95, 2.45),
  labels: { reference: { x: 0, y: -3.4 }, value: { x: 0, y: 3.4 }, fabReference: { x: 0, y: 0 } },
  courtyard: { x: -3.7, y: -2.7, w: 7.4, h: 5.4 },
  provenance: {
    source_type: 'standard',
    title: 'JEDEC MS-012 / IPC-7351 SOIC-8 3.9×4.9 mm 1.27 mm-pitch land pattern',
    citation:
      'KiCad footprint library, Package_SO.pretty/SOIC-8_3.9x4.9mm_P1.27mm.kicad_mod — 8 pads 1.95×0.6 mm on 1.27 mm pitch, rows at x=±2.475 mm',
    confidence: 'high',
    url: 'https://gitlab.com/kicad/libraries/kicad-footprints',
  },
}

/**
 * DIP-8 (0.3″ / 7.62 mm rows) — the 8-pin dual-in-line THROUGH-HOLE IC. Pads + drills + courtyard + text
 * verbatim from KiCad (Package_DIP.pretty/DIP-8_W7.62mm.kicad_mod). Origin at PIN 1 (0,0), KiCad's
 * through-hole convention — not the part centre. Pin 1 is the square (roundrect) pad, 2–8 are round.
 * Silk + fab are the body-outline rectangles (KiCad chamfers pin 1).
 */
export const FOOTPRINT_DIP8: Footprint = {
  id: 'DIP-8_W7.62mm',
  name: 'DIP-8 (0.3″ / 7.62 mm)',
  description: '8-pin dual-in-line through-hole IC — 2.54 mm pitch, 7.62 mm rows. JEDEC MS-001.',
  pads: [
    {
      id: '1',
      center: { x: 0, y: 0 },
      size: { w: 1.6, h: 1.6 },
      shape: 'roundrect',
      type: 'through_hole',
      holeDiameter: 0.8,
    },
    {
      id: '2',
      center: { x: 0, y: 2.54 },
      size: { w: 1.6, h: 1.6 },
      shape: 'circle',
      type: 'through_hole',
      holeDiameter: 0.8,
    },
    {
      id: '3',
      center: { x: 0, y: 5.08 },
      size: { w: 1.6, h: 1.6 },
      shape: 'circle',
      type: 'through_hole',
      holeDiameter: 0.8,
    },
    {
      id: '4',
      center: { x: 0, y: 7.62 },
      size: { w: 1.6, h: 1.6 },
      shape: 'circle',
      type: 'through_hole',
      holeDiameter: 0.8,
    },
    {
      id: '5',
      center: { x: 7.62, y: 7.62 },
      size: { w: 1.6, h: 1.6 },
      shape: 'circle',
      type: 'through_hole',
      holeDiameter: 0.8,
    },
    {
      id: '6',
      center: { x: 7.62, y: 5.08 },
      size: { w: 1.6, h: 1.6 },
      shape: 'circle',
      type: 'through_hole',
      holeDiameter: 0.8,
    },
    {
      id: '7',
      center: { x: 7.62, y: 2.54 },
      size: { w: 1.6, h: 1.6 },
      shape: 'circle',
      type: 'through_hole',
      holeDiameter: 0.8,
    },
    {
      id: '8',
      center: { x: 7.62, y: 0 },
      size: { w: 1.6, h: 1.6 },
      shape: 'circle',
      type: 'through_hole',
      holeDiameter: 0.8,
    },
  ],
  silkscreen: rectOutline(1.16, -1.33, 6.46, 8.95, 0.12),
  fabrication: rectOutline(0.635, -1.27, 6.985, 8.89),
  labels: {
    reference: { x: 3.81, y: -2.33 },
    value: { x: 3.81, y: 9.95 },
    fabReference: { x: 3.81, y: 3.81 },
  },
  courtyard: { x: -1.06, y: -1.52, w: 9.73, h: 10.66 },
  provenance: {
    source_type: 'standard',
    title: 'JEDEC MS-001 DIP-8, 2.54 mm pitch / 7.62 mm (0.3″) rows',
    citation:
      'KiCad footprint library, Package_DIP.pretty/DIP-8_W7.62mm.kicad_mod — 8 through-hole pads 1.6 mm, 0.8 mm drill, 2.54 mm pitch, rows 7.62 mm apart',
    confidence: 'high',
    url: 'https://gitlab.com/kicad/libraries/kicad-footprints',
    notes: 'Origin at pin 1 (0,0), not the part centre — KiCad convention for through-hole ICs.',
  },
}

/**
 * 1×4 pin header, 2.54 mm (0.1″) pitch, vertical through-hole. Pads + drills + courtyard + text verbatim
 * from KiCad (Connector_PinHeader_2.54mm.pretty/PinHeader_1x04_P2.54mm_Vertical.kicad_mod). Origin at
 * pin 1; pin 1 is the square (rect) pad. Silk + fab are the body-outline rectangles.
 */
export const FOOTPRINT_PINHDR_1X4: Footprint = {
  id: 'PinHeader_1x04_P2.54mm_Vertical',
  name: '1×4 pin header (0.1″ / 2.54 mm)',
  description: 'Single-row 4-pin 2.54 mm pin header, vertical through-hole.',
  pads: [
    {
      id: '1',
      center: { x: 0, y: 0 },
      size: { w: 1.7, h: 1.7 },
      shape: 'rect',
      type: 'through_hole',
      holeDiameter: 1.0,
    },
    {
      id: '2',
      center: { x: 0, y: 2.54 },
      size: { w: 1.7, h: 1.7 },
      shape: 'circle',
      type: 'through_hole',
      holeDiameter: 1.0,
    },
    {
      id: '3',
      center: { x: 0, y: 5.08 },
      size: { w: 1.7, h: 1.7 },
      shape: 'circle',
      type: 'through_hole',
      holeDiameter: 1.0,
    },
    {
      id: '4',
      center: { x: 0, y: 7.62 },
      size: { w: 1.7, h: 1.7 },
      shape: 'circle',
      type: 'through_hole',
      holeDiameter: 1.0,
    },
  ],
  silkscreen: rectOutline(-1.38, -1.38, 1.38, 9.0, 0.12),
  fabrication: rectOutline(-1.27, -1.27, 1.27, 8.89),
  labels: {
    reference: { x: 0, y: -2.38 },
    value: { x: 0, y: 10 },
    fabReference: { x: 0, y: 3.81 },
  },
  courtyard: { x: -1.77, y: -1.77, w: 3.54, h: 11.16 },
  provenance: {
    source_type: 'standard',
    title: '2.54 mm (0.1″) pitch single-row pin header, 1×4 vertical',
    citation:
      'KiCad footprint library, Connector_PinHeader_2.54mm.pretty/PinHeader_1x04_P2.54mm_Vertical.kicad_mod — 4 through-hole pads 1.7 mm, 1.0 mm drill, 2.54 mm pitch',
    confidence: 'high',
    url: 'https://gitlab.com/kicad/libraries/kicad-footprints',
    notes: 'Origin at pin 1 (0,0); pin 1 square. The universal 0.1″ prototyping connector.',
  },
}

/** Every built-in footprint, keyed by id. The board road's starter set (TOOLCHAIN-ROADMAP.md Track 1). */
export const BUILTIN_FOOTPRINTS: Record<string, Footprint> = {
  [FOOTPRINT_0603.id]: FOOTPRINT_0603,
  [FOOTPRINT_SOIC8.id]: FOOTPRINT_SOIC8,
  [FOOTPRINT_DIP8.id]: FOOTPRINT_DIP8,
  [FOOTPRINT_PINHDR_1X4.id]: FOOTPRINT_PINHDR_1X4,
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

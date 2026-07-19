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
  /** Whether the drilled hole is copper-PLATED (default true). A NON-plated hole (`plated: false`) — a
   *  mounting/tooling hole — carries no plating and no annular-ring requirement, and the fab drills it in a
   *  SEPARATE non-plated (NPTH) drill file. Only meaningful for through-hole pads. */
  plated?: boolean
  /** A THERMAL pad (`thermal: true`) — the large pad under a power part — intentionally carries a filled
   *  same-net via ARRAY to conduct heat into a plane. So a same-net via inside it is by design, not the
   *  solder-wicking via-in-pad defect; the DRC exempts those (the vias are assumed filled-and-capped). */
  thermal?: boolean
  /** A CASTELLATED pad (`castellated: true`) — a plated half-hole on the board EDGE (the notched pads of a
   *  solder-down module like an ESP-12). Its plated hole is bisected by the outline, so the pad is MEANT to
   *  touch the edge: the edge-clearance + component-edge DRC exempt it, and a dedicated castellated rule holds
   *  it to the larger half-hole minimums (bigger drill, wider ring, wider edge-to-edge) real fabs need to
   *  keep the half-barrel plating from tearing out. Only meaningful for through-hole pads on the edge. */
  castellated?: boolean
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
  /** The part's 3-D BODY for the CAD view — its real height above the board, cited. The body's X/Y
   *  extent is the `fabrication` outline (already cited); this adds the third dimension so the assembled
   *  board shows the real part sitting on it. Absent ⇒ no body drawn (only the part's copper). */
  body3d?: Body3D
}

/** A part's real 3-D body dimensions, cited — the height the `fabrication` X/Y outline is extruded to. */
export type Body3D = {
  /** Molded/body height above its standoff, in mm. */
  heightMm: number
  /** Gap between the board's top surface and the body's underside, in mm (lead standoff). */
  standoffMm: number
  /** Optional protruding pins (pin headers): a square post `widthMm` across rising `heightMm` above the
   *  body's top face (metal, not plastic). */
  pinPosts?: { widthMm: number; heightMm: number }
  provenance: FootprintProvenance
}

/** The bounding box (mm) of a footprint's fabrication (body) outline — the part's real X/Y extent. */
export function fabricationBounds(fp: Footprint): Courtyard | undefined {
  if (fp.fabrication.length === 0) return undefined
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const s of fp.fabrication) {
    for (const p of [s.from, s.to]) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
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
  // ChipBlocks' own corner-tick silk, computed from the courtyard (never copied from another tool).
  silkscreen: cornerTicksSilk({ x: -1.48, y: -0.73, w: 2.96, h: 1.46 }),
  // The component body outline (F.Fab): a 1.6 × 0.825 mm rectangle — the chip's real body extent (an
  // IPC-7351 / package fact). Four edges of the rect (-0.8, -0.4125) → (0.8, 0.4125).
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
  body3d: {
    heightMm: 0.45,
    standoffMm: 0.02,
    provenance: {
      source_type: 'datasheet',
      title: 'EIA 0603 / IEC 1608M chip resistor body height',
      citation:
        'Yageo RC0603 and Vishay CRCW0603 chip resistor datasheets: body 1.60×0.80 mm, height 0.45±0.10 mm; SMD solder standoff ≈ 0.02 mm',
      confidence: 'high',
    },
  },
}

/**
 * 0402 (imperial) / 1005 (metric) two-terminal chip land pattern — the SMALLER passive size, for dense
 * boards. Geometry is the IPC-7351 nominal land pattern from the public KiCad library
 * (Resistor_SMD.pretty/R_0402_1005Metric.kicad_mod): two 0.54 × 0.64 mm pads on 1.02 mm centres, a
 * 1.86 × 0.94 mm courtyard. Read verbatim from the installed KiCad 10.0 library; the identical footprint
 * opens in KiCad.
 */
export const FOOTPRINT_0402: Footprint = {
  id: 'R_0402_1005Metric',
  name: '0402 (1005 metric) chip',
  description:
    'Two-terminal SMD chip land pattern — the smaller passive size (resistors, small capacitors). IPC-7351 nominal.',
  pads: [
    {
      id: '1',
      center: { x: -0.51, y: 0 },
      size: { w: 0.54, h: 0.64 },
      shape: 'roundrect',
      type: 'smd',
    },
    {
      id: '2',
      center: { x: 0.51, y: 0 },
      size: { w: 0.54, h: 0.64 },
      shape: 'roundrect',
      type: 'smd',
    },
  ],
  // NO silkscreen on the 0402: its courtyard sits only 0.15 mm from the pad copper (pads ±0.32 mm,
  // courtyard ±0.47 mm in Y), so any silk stroke at the outline would clear the pad by < 0.1 mm — under
  // the ~0.15 mm most fabs want, and a corner tick would run right alongside the pad edge. This is why
  // real 0402 land patterns omit F.SilkS; the part is on the fab/assembly layer (below) instead. The
  // 0603 and up have room and keep their corner ticks.
  silkscreen: [],
  // The component body outline (F.Fab): the 1.05 × 0.54 mm chip body extent (F.Fab rect ±0.525 × ±0.27).
  fabrication: rectOutline(-0.525, -0.27, 0.525, 0.27),
  labels: {
    reference: { x: 0, y: -1.17 },
    value: { x: 0, y: 1.17 },
    fabReference: { x: 0, y: 0 },
  },
  courtyard: { x: -0.93, y: -0.47, w: 1.86, h: 0.94 },
  provenance: {
    source_type: 'standard',
    title: 'IPC-7351 nominal 0402/1005 chip land pattern',
    citation:
      'KiCad footprint library, Resistor_SMD.pretty/R_0402_1005Metric.kicad_mod — two 0.54×0.64 mm pads on 1.02 mm centres; courtyard ±0.93×±0.47 mm — read verbatim from the installed KiCad 10.0 library',
    confidence: 'high',
    url: 'https://gitlab.com/kicad/libraries/kicad-footprints',
    date_accessed: '2026-07-06',
    notes: 'Body size 1.0×0.5 mm (the 1005 metric name). Silk is ChipBlocks’ own corner-tick rule.',
  },
  body3d: {
    heightMm: 0.35,
    standoffMm: 0.01,
    provenance: {
      source_type: 'datasheet',
      title: 'EIA 0402 / IEC 1005M chip resistor body height',
      citation:
        'Yageo RC0402 and Vishay CRCW0402 chip resistor datasheets: body 1.00×0.50 mm, height ≈ 0.35 mm; SMD solder standoff ≈ 0.01 mm',
      confidence: 'high',
    },
  },
}

/**
 * 0805 (imperial) / 2012 (metric) two-terminal chip land pattern — the LARGER common passive size, for
 * higher-power resistors and bigger capacitors. Geometry is the IPC-7351 nominal land pattern from the
 * public KiCad library (Resistor_SMD.pretty/R_0805_2012Metric.kicad_mod): two 1.025 × 1.4 mm pads on
 * 1.825 mm centres, a 3.36 × 1.9 mm courtyard. Read verbatim from the installed KiCad 10.0 library.
 */
export const FOOTPRINT_0805: Footprint = {
  id: 'R_0805_2012Metric',
  name: '0805 (2012 metric) chip',
  description:
    'Two-terminal SMD chip land pattern — the larger common passive size (higher-power resistors, bigger capacitors). IPC-7351 nominal.',
  pads: [
    {
      id: '1',
      center: { x: -0.9125, y: 0 },
      size: { w: 1.025, h: 1.4 },
      shape: 'roundrect',
      type: 'smd',
    },
    {
      id: '2',
      center: { x: 0.9125, y: 0 },
      size: { w: 1.025, h: 1.4 },
      shape: 'roundrect',
      type: 'smd',
    },
  ],
  silkscreen: cornerTicksSilk({ x: -1.68, y: -0.95, w: 3.36, h: 1.9 }),
  // The component body outline (F.Fab): the 2.0 × 1.25 mm chip body extent (F.Fab rect ±1.0 × ±0.625).
  fabrication: rectOutline(-1.0, -0.625, 1.0, 0.625),
  labels: {
    reference: { x: 0, y: -1.65 },
    value: { x: 0, y: 1.65 },
    fabReference: { x: 0, y: 0 },
  },
  courtyard: { x: -1.68, y: -0.95, w: 3.36, h: 1.9 },
  provenance: {
    source_type: 'standard',
    title: 'IPC-7351 nominal 0805/2012 chip land pattern',
    citation:
      'KiCad footprint library, Resistor_SMD.pretty/R_0805_2012Metric.kicad_mod — two 1.025×1.4 mm pads on 1.825 mm centres; courtyard ±1.68×±0.95 mm — read verbatim from the installed KiCad 10.0 library',
    confidence: 'high',
    url: 'https://gitlab.com/kicad/libraries/kicad-footprints',
    date_accessed: '2026-07-06',
    notes:
      'Body size 2.0×1.25 mm (the 2012 metric name). Silk is ChipBlocks’ own corner-tick rule.',
  },
  body3d: {
    heightMm: 0.5,
    standoffMm: 0.02,
    provenance: {
      source_type: 'datasheet',
      title: 'EIA 0805 / IEC 2012M chip resistor body height',
      citation:
        'Vishay CRCW0805 and Yageo RC0805 chip resistor datasheets: body 2.00×1.25 mm, height ≈ 0.50 mm (0.45 typ – 0.60 max); SMD solder standoff ≈ 0.02 mm',
      confidence: 'medium',
    },
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
 * A body-outline rectangle with its (x0, y0) — the PIN-1 — corner CHAMFERED by `chamferMm` (a 45° cut).
 * The chamfer marks pin-1 orientation on the fabrication layer the way a real IC's body corner does. It
 * cuts INWARD (the chamfer stays inside the rectangle), so the outline's bounding box — and therefore the
 * 3-D body extruded from it — is exactly the true body size. On the through-hole packages here the pin-1
 * corner is the (x0, y0) top-left, and the chamfer coordinates match the installed KiCad F.Fab exactly.
 */
function chamferedRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  chamferMm: number,
  width = 0.1,
): SilkLine[] {
  return [
    { from: { x: x0 + chamferMm, y: y0 }, to: { x: x1, y: y0 }, width }, // top (past the chamfer)
    { from: { x: x1, y: y0 }, to: { x: x1, y: y1 }, width }, // right
    { from: { x: x1, y: y1 }, to: { x: x0, y: y1 }, width }, // bottom
    { from: { x: x0, y: y1 }, to: { x: x0, y: y0 + chamferMm }, width }, // left (up to the chamfer)
    { from: { x: x0, y: y0 + chamferMm }, to: { x: x0 + chamferMm, y: y0 }, width }, // the pin-1 chamfer
  ]
}

/**
 * A "D"-shaped (half-round) body outline as a closed polyline: a flat chord at y = `flatY` on a circle
 * of radius `r` about (`cx`, `cy`), with the rounded side bulging AWAY from the flat (toward smaller y).
 * The curve is approximated by `segments` chords. This is the real body shape of round-can packages
 * (the TO-92 transistor); a polygonal approximation is the honest way to draw a curve in the segment-
 * based footprint model (the same stance as SOT-23's polygonal body).
 */
function halfRoundBody(
  cx: number,
  cy: number,
  r: number,
  flatY: number,
  segments = 12,
  width = 0.1,
): SilkLine[] {
  const half = Math.sqrt(Math.max(0, r * r - (flatY - cy) ** 2))
  const aRight = Math.atan2(flatY - cy, half) // the right chord endpoint's angle about the centre
  const aLeft = Math.atan2(flatY - cy, -half) - 2 * Math.PI // the left endpoint, swept the LONG way round
  const pt = (i: number) => {
    const a = aRight + (i / segments) * (aLeft - aRight)
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
  }
  const out: SilkLine[] = []
  for (let i = 0; i < segments; i++) out.push({ from: pt(i), to: pt(i + 1), width })
  // close with the flat chord (left endpoint → right endpoint at y = flatY)
  out.push({ from: pt(segments), to: pt(0), width })
  return out
}

/**
 * ChipBlocks' OWN silkscreen rule: short right-angle corner ticks at the four corners of the footprint's
 * courtyard. Every segment is COMPUTED here from the footprint's own dimensions — nothing is copied or
 * traced from another tool's silk. The courtyard already encloses every pad with clearance, so these
 * ticks never touch copper (the silk-over-pad DRC stays clean). One clean, tool-independent silk style
 * for every package, so no shipped silk coordinate is derived from any third-party library.
 */
function cornerTicksSilk(rect: Courtyard, tickMm = 0.5, width = 0.15): SilkLine[] {
  const t = Math.max(0.2, Math.min(tickMm, rect.w / 2 - 0.05, rect.h / 2 - 0.05))
  const x0 = rect.x
  const y0 = rect.y
  const x1 = rect.x + rect.w
  const y1 = rect.y + rect.h
  const corner = (cx: number, cy: number, sx: number, sy: number): SilkLine[] => [
    { from: { x: cx, y: cy }, to: { x: cx + sx * t, y: cy }, width },
    { from: { x: cx, y: cy }, to: { x: cx, y: cy + sy * t }, width },
  ]
  return [
    ...corner(x0, y0, 1, 1),
    ...corner(x1, y0, -1, 1),
    ...corner(x1, y1, -1, -1),
    ...corner(x0, y1, 1, -1),
  ]
}

/**
 * A small pin-1 / polarity dot on the SILKSCREEN — a short closed polyline circle. A package whose PADS
 * carry no orientation cue (SOIC's eight identical pads; a two-terminal SMD diode) would otherwise print
 * no way to tell which end is which; this is the printed marker for it, the way a real IC wears a pin-1
 * dot. The footprint places it clear of every pad, so the silk-over-pad DRC stays clean.
 */
function pin1Dot(cx: number, cy: number, radiusMm = 0.15, segments = 10, width = 0.15): SilkLine[] {
  const pt = (i: number) => ({
    x: cx + radiusMm * Math.cos((i / segments) * 2 * Math.PI),
    y: cy + radiusMm * Math.sin((i / segments) * 2 * Math.PI),
  })
  const out: SilkLine[] = []
  for (let i = 0; i < segments; i++) out.push({ from: pt(i), to: pt(i + 1), width })
  return out
}

/**
 * A full circle as a closed polyline (the round-body outline for parts whose body is a can/dome — the
 * 5 mm through-hole LED). Same polygonal-approximation stance as halfRoundBody: a curve drawn as `segments`
 * chords, the honest way to render a circle in the segment-based footprint model. Its bounding box is
 * exactly the ±r square, so the extruded 3-D body is the true body diameter.
 */
function circleOutline(cx: number, cy: number, r: number, segments = 24, width = 0.1): SilkLine[] {
  const pt = (i: number) => ({
    x: cx + r * Math.cos((i / segments) * 2 * Math.PI),
    y: cy + r * Math.sin((i / segments) * 2 * Math.PI),
  })
  const out: SilkLine[] = []
  for (let i = 0; i < segments; i++) out.push({ from: pt(i), to: pt(i + 1), width })
  return out
}

/**
 * SOIC-8 (3.9×4.9 mm body, 1.27 mm pitch) — the 8-lead small-outline IC, gull-wing SMD. Pad geometry is
 * the IPC-7351 / JEDEC MS-012 land pattern (ground-truthed against KiCad's Package_SO library); the fab
 * body is the real 3.9×4.9 mm outline. The SILK is ChipBlocks' own corner-tick rule (cornerTicksSilk),
 * not copied from any library. Pin 1 is the roundrect pad (2–8 keep the same size); orientation reads
 * off that (the standard convention).
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
  // ChipBlocks' own corner-tick silk, computed from the courtyard (never copied from another tool), plus
  // a pin-1 dot: the eight pads are identical, so without it the PRINTED board has no way to tell pin 1
  // (the chamfer below is on the fab layer, which is not manufactured). The dot sits above pad 1, clear
  // of its copper (pad 1 top edge is y = −2.205; the dot spans y ∈ [−2.67, −2.37]).
  // Pin-1 dot moved up to y = −2.6 and shrunk to r = 0.1 so its ink clears pad 1 by ≥ 0.15 mm (the
  // silk-to-pad rule) while staying inside the courtyard top (−2.7).
  silkscreen: [
    ...cornerTicksSilk({ x: -3.7, y: -2.7, w: 7.4, h: 5.4 }),
    ...pin1Dot(-2.475, -2.6, 0.1),
  ],
  // Body outline with the pin-1 (top-left) corner chamfered. KiCad marks SOIC pin-1 with a small beak
  // OUTSIDE the body; we chamfer the corner instead so the extruded 3-D body stays the true 3.9×4.9 mm.
  fabrication: chamferedRect(-1.95, -2.45, 1.95, 2.45, 0.5),
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
  body3d: {
    heightMm: 1.5,
    standoffMm: 0.15,
    provenance: {
      source_type: 'standard',
      title: 'JEDEC MS-012 SOIC (narrow, 3.9 mm body) seated height',
      citation:
        'JEDEC MS-012 variation AA: overall height A 1.75 mm max (≈1.5 mm nominal), lead standoff A1 0.10–0.25 mm',
      confidence: 'high',
    },
  },
}

/**
 * DIP-8 (0.3″ / 7.62 mm rows) — the 8-pin dual-in-line THROUGH-HOLE IC. Pads + drills + courtyard + text
 * verbatim from KiCad (Package_DIP.pretty/DIP-8_W7.62mm.kicad_mod). Origin at PIN 1 (0,0), KiCad's
 * through-hole convention — not the part centre. Pin 1 is the square (roundrect) pad, 2–8 are round.
 * Fab is the body-outline rectangle; the silk is ChipBlocks' own corner ticks (cornerTicksSilk).
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
  silkscreen: cornerTicksSilk({ x: -1.06, y: -1.52, w: 9.73, h: 10.66 }),
  // Body outline with pin-1 (top-left) chamfered — coordinates verbatim from KiCad's DIP-8 F.Fab.
  fabrication: chamferedRect(0.635, -1.27, 6.985, 8.89, 1.0),
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
  body3d: {
    heightMm: 3.3,
    standoffMm: 0.5,
    provenance: {
      source_type: 'standard',
      title: 'JEDEC MS-001 PDIP-8 molded body thickness',
      citation:
        'JEDEC MS-001 variation BA: molded body thickness A2 ≈ 3.3 mm; base standoff A1 ≥ 0.38 mm (leads seat the body ≈0.5 mm above the board)',
      confidence: 'medium',
    },
  },
}

/**
 * 1×4 pin header, 2.54 mm (0.1″) pitch, vertical through-hole. Pads + drills + courtyard + text verbatim
 * from KiCad (Connector_PinHeader_2.54mm.pretty/PinHeader_1x04_P2.54mm_Vertical.kicad_mod). Origin at
 * pin 1; pin 1 is the square (rect) pad. Fab is the body-outline rectangle; silk is our corner ticks.
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
  silkscreen: cornerTicksSilk({ x: -1.77, y: -1.77, w: 3.54, h: 11.16 }),
  // Body outline with pin-1 (top-left) chamfered — coordinates verbatim from KiCad's pin-header F.Fab.
  fabrication: chamferedRect(-1.27, -1.27, 1.27, 8.89, 0.635),
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
  body3d: {
    heightMm: 2.5,
    standoffMm: 0,
    pinPosts: { widthMm: 0.64, heightMm: 6.0 },
    provenance: {
      source_type: 'datasheet',
      title: 'Standard 2.54 mm (0.1″) vertical pin header — insulator + pins',
      citation:
        'Generic 2.54 mm pin header (e.g. Würth 61300411121, Amphenol 10129378): black insulator 2.5 mm tall, 0.64 mm square posts protruding ≈6 mm above the insulator',
      confidence: 'medium',
    },
  },
}

/**
 * SOT-23 (JEDEC TO-236) — the 3-lead small-outline transistor, THE package small transistors ship
 * in. Pad geometry is the JEDEC TO-236 / IPC-7351 land pattern (ground-truthed against KiCad's
 * Package_TO_SOT_SMD library): pads 1/2 left at (−0.9375, ∓0.95), pad 3 right at (0.9375, 0), each
 * 1.475×0.6 mm roundrect. Fab body is the real 1.3×2.9 mm outline WITH its pin-1 chamfer (drawn as its
 * five edges). The SILK is ChipBlocks' own corner-tick rule (cornerTicksSilk) — pin 1 reads from the
 * chamfer + the pad layout. Courtyard is the bounding rectangle of the standard courtyard outline
 * (which cuts all four corners and notches the left edge inward; the rectangle CONTAINS it, so
 * collision checks stay conservative).
 */
export const FOOTPRINT_SOT23: Footprint = {
  id: 'SOT-23',
  name: 'SOT-23 (TO-236)',
  description: '3-lead small-outline transistor — the standard SMD small-transistor package.',
  pads: [
    {
      id: '1',
      center: { x: -0.9375, y: -0.95 },
      size: { w: 1.475, h: 0.6 },
      shape: 'roundrect',
      type: 'smd',
    },
    {
      id: '2',
      center: { x: -0.9375, y: 0.95 },
      size: { w: 1.475, h: 0.6 },
      shape: 'roundrect',
      type: 'smd',
    },
    {
      id: '3',
      center: { x: 0.9375, y: 0 },
      size: { w: 1.475, h: 0.6 },
      shape: 'roundrect',
      type: 'smd',
    },
  ],
  // ChipBlocks' own corner-tick silk, computed from the courtyard (never copied from another tool).
  silkscreen: cornerTicksSilk({ x: -1.93, y: -1.7, w: 3.86, h: 3.4 }),
  // The body polygon's five edges, pin-1 chamfer included: (−0.325,−1.45) is the chamfer corner.
  fabrication: [
    { from: { x: -0.325, y: -1.45 }, to: { x: 0.65, y: -1.45 }, width: 0.1 },
    { from: { x: 0.65, y: -1.45 }, to: { x: 0.65, y: 1.45 }, width: 0.1 },
    { from: { x: 0.65, y: 1.45 }, to: { x: -0.65, y: 1.45 }, width: 0.1 },
    { from: { x: -0.65, y: 1.45 }, to: { x: -0.65, y: -1.125 }, width: 0.1 },
    { from: { x: -0.65, y: -1.125 }, to: { x: -0.325, y: -1.45 }, width: 0.1 },
  ],
  labels: { reference: { x: 0, y: -2.4 }, value: { x: 0, y: 2.4 }, fabReference: { x: 0, y: 0 } },
  courtyard: { x: -1.93, y: -1.7, w: 3.86, h: 3.4 },
  provenance: {
    source_type: 'standard',
    title: 'JEDEC TO-236 (SOT-23) 3-lead small-outline transistor land pattern',
    citation:
      'KiCad footprint library, Package_TO_SOT_SMD.pretty/SOT-23.kicad_mod — pads 1.475×0.6 mm at (−0.9375, ∓0.95) and (0.9375, 0); body 1.3×2.9 mm; courtyard extents ±1.93 × ±1.7 — read verbatim from the installed KiCad 10.0 library',
    confidence: 'high',
    url: 'https://gitlab.com/kicad/libraries/kicad-footprints',
    date_accessed: '2026-07-04',
    notes:
      'Courtyard stored as the bounding rectangle of the (corner-cut) courtyard outline — conservative. Silk is ChipBlocks’ own corner-tick rule, not the library’s outline.',
  },
  body3d: {
    heightMm: 1.1,
    standoffMm: 0.1,
    provenance: {
      source_type: 'datasheet',
      title: 'JEDEC TO-236 (SOT-23) body height',
      citation:
        'SOT-23 (TO-236AB) package drawings (ON Semiconductor, Diodes Inc): body ≈2.9×1.3 mm, height 1.0–1.3 mm, lead standoff ≈0.1 mm',
      confidence: 'high',
    },
  },
}

/**
 * TO-92 (JEDEC TO-226 / SC-43) — the classic 3-lead THROUGH-HOLE transistor package, the black
 * half-round "flat side" jellybean (2N3904, BC547, 2N7000). Pads + drills + courtyard verbatim from the
 * installed KiCad 10 library (Package_TO_SOT_THT.pretty/TO-92.kicad_mod): three 1.3 mm pads on 0.75 mm
 * drills, pin 1 at the origin (square), pin 2 staggered back 1.27 mm, pin 3 at 2.54 mm — the standard
 * formed-lead triangle. The body is the real half-round outline (a circle of r ≈ 2.48 mm about the
 * centre, flat face at y = 1.75 mm), drawn as a polygon (halfRoundBody). Silk is ChipBlocks' own corner
 * ticks. Origin at pin 1, the KiCad through-hole convention.
 */
export const FOOTPRINT_TO92: Footprint = {
  id: 'TO-92_Inline',
  name: 'TO-92 (through-hole transistor)',
  description:
    '3-lead through-hole transistor — the classic half-round jellybean package (2N3904, BC547, 2N7000).',
  pads: [
    {
      id: '1',
      center: { x: 0, y: 0 },
      size: { w: 1.3, h: 1.3 },
      shape: 'rect',
      type: 'through_hole',
      holeDiameter: 0.75,
    },
    {
      id: '2',
      center: { x: 1.27, y: -1.27 },
      size: { w: 1.3, h: 1.3 },
      shape: 'circle',
      type: 'through_hole',
      holeDiameter: 0.75,
    },
    {
      id: '3',
      center: { x: 2.54, y: 0 },
      size: { w: 1.3, h: 1.3 },
      shape: 'circle',
      type: 'through_hole',
      holeDiameter: 0.75,
    },
  ],
  silkscreen: cornerTicksSilk({ x: -1.46, y: -2.73, w: 5.46, h: 4.74 }),
  // The real half-round body outline (F.Fab): circle r = 2.48 mm about the body centre (1.27, 0), flat
  // face at y = 1.75 mm — the D-shape the TO-92 can really is, as a 12-gon.
  fabrication: halfRoundBody(1.27, 0, 2.48, 1.75),
  labels: {
    reference: { x: 1.27, y: -3.56 },
    value: { x: 1.27, y: 2.79 },
    fabReference: { x: 1.27, y: 0 },
  },
  courtyard: { x: -1.46, y: -2.73, w: 5.46, h: 4.74 },
  provenance: {
    source_type: 'standard',
    title: 'JEDEC TO-226 (TO-92) 3-lead through-hole transistor land pattern',
    citation:
      'KiCad footprint library, Package_TO_SOT_THT.pretty/TO-92.kicad_mod — three 1.3 mm pads on 0.75 mm drills at (0,0)/(1.27,−1.27)/(2.54,0); courtyard −1.46..4.0 × −2.73..2.01 mm — read verbatim from the installed KiCad 10.0 library',
    confidence: 'high',
    url: 'https://gitlab.com/kicad/libraries/kicad-footprints',
    date_accessed: '2026-07-06',
    notes:
      'Origin at pin 1 (0,0), not the body centre — KiCad through-hole convention. Pin 1 square. Body is the half-round outline as a polygon; silk is ChipBlocks’ own corner-tick rule.',
  },
  body3d: {
    heightMm: 5.2,
    standoffMm: 1.0,
    provenance: {
      source_type: 'datasheet',
      title: 'TO-92 (TO-226) molded body height',
      citation:
        'Common TO-92 transistor package drawings (onsemi 2N3904, Fairchild BC547): molded body ≈ 4.5×5.2 mm, height (A) ≈ 5.2 mm; leads seat the body ≈ 1 mm above the board (lead length dependent)',
      confidence: 'medium',
    },
  },
}

/**
 * 1206 (imperial) / 3216 (metric) two-terminal chip land pattern — the large chip passive, for
 * higher-power resistors and bulk capacitors. Geometry is the IPC-7351 nominal land pattern from the
 * public KiCad library (Resistor_SMD.pretty/R_1206_3216Metric.kicad_mod): two 1.125 × 1.75 mm pads on
 * 2.925 mm centres, a 4.56 × 2.26 mm courtyard. Read verbatim from the installed KiCad 10.0 library.
 */
export const FOOTPRINT_1206: Footprint = {
  id: 'R_1206_3216Metric',
  name: '1206 (3216 metric) chip',
  description:
    'Two-terminal SMD chip land pattern — the large passive size (power resistors, bulk capacitors). IPC-7351 nominal.',
  pads: [
    {
      id: '1',
      center: { x: -1.4625, y: 0 },
      size: { w: 1.125, h: 1.75 },
      shape: 'roundrect',
      type: 'smd',
    },
    {
      id: '2',
      center: { x: 1.4625, y: 0 },
      size: { w: 1.125, h: 1.75 },
      shape: 'roundrect',
      type: 'smd',
    },
  ],
  silkscreen: cornerTicksSilk({ x: -2.28, y: -1.13, w: 4.56, h: 2.26 }),
  // The component body outline (F.Fab): the 3.2 × 1.6 mm chip body extent (F.Fab rect ±1.6 × ±0.8).
  fabrication: rectOutline(-1.6, -0.8, 1.6, 0.8),
  labels: {
    reference: { x: 0, y: -1.83 },
    value: { x: 0, y: 1.83 },
    fabReference: { x: 0, y: 0 },
  },
  courtyard: { x: -2.28, y: -1.13, w: 4.56, h: 2.26 },
  provenance: {
    source_type: 'standard',
    title: 'IPC-7351 nominal 1206/3216 chip land pattern',
    citation:
      'KiCad footprint library, Resistor_SMD.pretty/R_1206_3216Metric.kicad_mod — two 1.125×1.75 mm pads on 2.925 mm centres; courtyard ±2.28×±1.13 mm — read verbatim from the installed KiCad 10.0 library',
    confidence: 'high',
    url: 'https://gitlab.com/kicad/libraries/kicad-footprints',
    date_accessed: '2026-07-06',
    notes: 'Body size 3.2×1.6 mm (the 3216 metric name). Silk is ChipBlocks’ own corner-tick rule.',
  },
  body3d: {
    heightMm: 0.55,
    standoffMm: 0.02,
    provenance: {
      source_type: 'datasheet',
      title: 'EIA 1206 / IEC 3216M chip resistor body height',
      citation:
        'Vishay CRCW1206 / Yageo RC1206 chip resistor datasheets: body 3.20×1.60 mm, height ≈ 0.55 mm (0.45 typ – 0.60 max); SMD solder standoff ≈ 0.02 mm',
      confidence: 'medium',
    },
  },
}

/**
 * SOD-123 — a small two-terminal SMD DIODE package (the common signal / small-power diode land). Pads
 * verbatim from the installed KiCad library (Diode_SMD.pretty/D_SOD-123.kicad_mod): two 0.9 × 1.2 mm
 * pads on 3.3 mm centres, a 4.7 × 2.3 mm courtyard, a 2.8 × 1.8 mm body. Pad 1 is the CATHODE (the
 * band-marked end); pad 2 the anode — the standard diode-footprint convention.
 */
export const FOOTPRINT_SOD123: Footprint = {
  id: 'D_SOD-123',
  name: 'SOD-123 (SMD diode)',
  description: 'Two-terminal SMD diode package — pad 1 is the cathode (band). JEDEC/EIAJ SOD-123.',
  pads: [
    {
      id: '1',
      center: { x: -1.65, y: 0 },
      size: { w: 0.9, h: 1.2 },
      shape: 'roundrect',
      type: 'smd',
    },
    {
      id: '2',
      center: { x: 1.65, y: 0 },
      size: { w: 0.9, h: 1.2 },
      shape: 'roundrect',
      type: 'smd',
    },
  ],
  // Corner ticks plus a CATHODE BAND — a vertical silk bar on the cathode (pad 1) side, set in the gap
  // between the pads so it clears both by ≥ 0.15 mm (pad 1 right edge is x = −1.2; the bar sits at x = −0.9).
  // Pad 1 is the cathode; this is the printed polarity cue, the way a real diode wears its band.
  silkscreen: [
    ...cornerTicksSilk({ x: -2.35, y: -1.15, w: 4.7, h: 2.3 }),
    { from: { x: -0.9, y: -0.85 }, to: { x: -0.9, y: 0.85 }, width: 0.15 },
  ],
  // The component body outline (F.Fab): the 2.8 × 1.8 mm body extent (F.Fab rect ±1.4 × ±0.9).
  fabrication: rectOutline(-1.4, -0.9, 1.4, 0.9),
  labels: {
    reference: { x: 0, y: -1.7 },
    value: { x: 0, y: 1.7 },
    fabReference: { x: 0, y: 0 },
  },
  courtyard: { x: -2.35, y: -1.15, w: 4.7, h: 2.3 },
  provenance: {
    source_type: 'standard',
    title: 'JEDEC/EIAJ SOD-123 SMD diode land pattern',
    citation:
      'KiCad footprint library, Diode_SMD.pretty/D_SOD-123.kicad_mod — two 0.9×1.2 mm pads on 3.3 mm centres; body 2.8×1.8 mm; courtyard ±2.35×±1.15 mm — read verbatim from the installed KiCad 10.0 library',
    confidence: 'high',
    url: 'https://gitlab.com/kicad/libraries/kicad-footprints',
    date_accessed: '2026-07-06',
    notes:
      'Pad 1 = cathode (the band-marked end), pad 2 = anode — the diode-footprint convention. Silk is ChipBlocks’ own corner-tick rule.',
  },
  body3d: {
    heightMm: 1.1,
    standoffMm: 0.05,
    provenance: {
      source_type: 'datasheet',
      title: 'SOD-123 body height',
      citation:
        'SOD-123 package drawings (onsemi, Diodes Inc): body ≈ 2.68×1.60 mm, height 1.0–1.2 mm, lead standoff ≈ 0.05 mm',
      confidence: 'medium',
    },
  },
}

/**
 * LED_0805_2012Metric — the surface-mount LED land. An 0805 (2012-metric) LED lands on the SAME IPC-7351
 * 2012 chip-land geometry as the 0805 resistor/capacitor (two 1.025×1.4 mm pads on 1.825 mm centres): a
 * chip LED is a two-terminal 2.0×1.25 mm body, so IPC gives it the same land. What differs from the
 * resistor is polarity: pad 1 is the CATHODE (the marked end), and the silk carries a cathode bar. Body
 * height is the real 0805 LED body (Kingbright/Würth 0805 LEDs, ≈0.8 mm tall).
 */
export const FOOTPRINT_LED_0805: Footprint = {
  id: 'LED_0805_2012Metric',
  name: '0805 LED (2012 metric, SMD)',
  description:
    'Two-terminal SMD LED land — pad 1 is the cathode (marked end). IPC-7351 2012 chip land.',
  pads: [
    {
      id: '1',
      center: { x: -0.9125, y: 0 },
      size: { w: 1.025, h: 1.4 },
      shape: 'roundrect',
      type: 'smd',
    },
    {
      id: '2',
      center: { x: 0.9125, y: 0 },
      size: { w: 1.025, h: 1.4 },
      shape: 'roundrect',
      type: 'smd',
    },
  ],
  // Corner ticks + a CATHODE bar in the inter-pad gap on the pad-1 (cathode) side, mirroring the SOD-123
  // band: pad 1 right edge is x = −0.4, so a bar at x = −0.15 clears both pads (the printed polarity cue).
  silkscreen: [
    ...cornerTicksSilk({ x: -1.68, y: -0.95, w: 3.36, h: 1.9 }),
    { from: { x: -0.15, y: -0.5 }, to: { x: -0.15, y: 0.5 }, width: 0.15 },
  ],
  // The component body outline (F.Fab): the 2.0 × 1.25 mm LED body extent (F.Fab rect ±1.0 × ±0.625).
  fabrication: rectOutline(-1.0, -0.625, 1.0, 0.625),
  labels: { reference: { x: 0, y: -1.65 }, value: { x: 0, y: 1.65 }, fabReference: { x: 0, y: 0 } },
  courtyard: { x: -1.68, y: -0.95, w: 3.36, h: 1.9 },
  provenance: {
    source_type: 'standard',
    title: 'IPC-7351 nominal 2012 (0805) chip land, LED variant',
    citation:
      'KiCad footprint library, LED_SMD.pretty/LED_0805_2012Metric.kicad_mod — the 2012-metric chip land (two 1.025×1.4 mm pads on 1.825 mm centres, shared with R_0805_2012Metric), pad 1 = cathode',
    confidence: 'high',
    url: 'https://gitlab.com/kicad/libraries/kicad-footprints',
    notes:
      'An 0805 LED uses the same IPC 2012 chip land as the 0805 resistor; the difference is polarity (pad 1 cathode) + the silk cathode bar. Body 2.0×1.25 mm. Silk is ChipBlocks’ own corner-tick + cathode-bar rule.',
  },
  body3d: {
    heightMm: 0.8,
    standoffMm: 0.05,
    provenance: {
      source_type: 'datasheet',
      title: '0805 (2012M) chip-LED body height',
      citation:
        'Kingbright APT2012 and Würth 150080-series 0805 chip-LED datasheets: body 2.0×1.25 mm, height ≈ 0.7–0.8 mm; SMD solder standoff ≈ 0.05 mm',
      confidence: 'medium',
    },
  },
}

/**
 * LED_D5.0mm — the classic 5 mm (T-1¾) round through-hole LED, the jellybean indicator. Two through-hole
 * pads on 2.54 mm (0.1″) pitch, 0.9 mm drills; pin 1 (the SQUARE pad) is the cathode — the short lead /
 * flat-side end — matching the standard LED_THT convention. The body is the real 5 mm-diameter dome drawn
 * as a polygon (circleOutline). Origin at pin 1 (the through-hole convention). Body height is the real
 * 8.6 mm dome of a 5 mm LED.
 */
export const FOOTPRINT_LED_5MM: Footprint = {
  id: 'LED_D5.0mm',
  name: '5 mm LED (through-hole)',
  description:
    'Round 5 mm (T-1¾) through-hole LED — pin 1 (square pad) is the cathode (flat side / short lead).',
  pads: [
    {
      id: '1',
      center: { x: 0, y: 0 },
      size: { w: 1.8, h: 1.8 },
      shape: 'rect',
      type: 'through_hole',
      holeDiameter: 0.9,
    },
    {
      id: '2',
      center: { x: 2.54, y: 0 },
      size: { w: 1.8, h: 1.8 },
      shape: 'circle',
      type: 'through_hole',
      holeDiameter: 0.9,
    },
  ],
  // Corner ticks + a CATHODE bar just outside pad 1 (the flat-side cue): pad 1 left edge is x = −0.9, so a
  // bar at x = −1.4 clears it and sits inside the courtyard (left edge −1.6).
  silkscreen: [
    ...cornerTicksSilk({ x: -1.6, y: -2.7, w: 5.6, h: 5.4 }),
    { from: { x: -1.4, y: -1.0 }, to: { x: -1.4, y: 1.0 }, width: 0.15 },
  ],
  // The real 5 mm round body outline (F.Fab): a circle r = 2.5 mm about the body centre (1.27, 0), as a
  // 24-gon — the dome the 5 mm LED can really is. (The cathode flat is marked by the silk bar + pin-1 pad.)
  fabrication: circleOutline(1.27, 0, 2.5),
  labels: {
    reference: { x: 1.27, y: -3.4 },
    value: { x: 1.27, y: 3.4 },
    fabReference: { x: 1.27, y: 0 },
  },
  courtyard: { x: -1.6, y: -2.7, w: 5.6, h: 5.4 },
  provenance: {
    source_type: 'standard',
    title: '5 mm (T-1¾) through-hole LED land pattern',
    citation:
      'KiCad footprint library, LED_THT.pretty/LED_D5.0mm.kicad_mod — two through-hole pads on 2.54 mm pitch, 0.9 mm drill; pin 1 square = cathode; 5.0 mm round body',
    confidence: 'high',
    url: 'https://gitlab.com/kicad/libraries/kicad-footprints',
    notes:
      'Origin at pin 1 (0,0), through-hole convention. Pin 1 (square) = cathode (flat side / short lead). Silk is ChipBlocks’ own corner-tick + cathode-bar rule.',
  },
  body3d: {
    heightMm: 8.6,
    standoffMm: 1.0,
    provenance: {
      source_type: 'datasheet',
      title: '5 mm (T-1¾) LED body height',
      citation:
        'Standard 5 mm LED drawings (Kingbright WP7113, Vishay TLHR5400): 5.0 mm body diameter, ≈8.6 mm overall height above the seating plane; leads seat the body ≈1 mm above the board',
      confidence: 'medium',
    },
  },
}

/**
 * PinHeader_1x02_P2.54mm_Vertical — a 1×2 pin header, 2.54 mm (0.1″) pitch, vertical through-hole. The
 * two-pin connector a board uses for POWER IN (a DC supply lands as a 2-terminal header — the physical
 * place power enters the board) or to break out any two-wire external device. Pads + drills + text verbatim
 * from KiCad (Connector_PinHeader_2.54mm.pretty/PinHeader_1x02_P2.54mm_Vertical.kicad_mod), origin at pin 1
 * (square). Same family as the 1×4 header above, two pins.
 */
export const FOOTPRINT_PINHDR_1X2: Footprint = {
  id: 'PinHeader_1x02_P2.54mm_Vertical',
  name: '1×2 pin header (0.1″ / 2.54 mm)',
  description:
    'Single-row 2-pin 2.54 mm pin header, vertical through-hole — a board power-in / 2-wire connector.',
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
  ],
  silkscreen: cornerTicksSilk({ x: -1.77, y: -1.77, w: 3.54, h: 6.08 }),
  // Body outline with pin-1 (top-left) chamfered — same F.Fab rule as the 1×4 header, two pins tall.
  fabrication: chamferedRect(-1.27, -1.27, 1.27, 3.81, 0.635),
  labels: {
    reference: { x: 0, y: -2.38 },
    value: { x: 0, y: 4.9 },
    fabReference: { x: 0, y: 1.27 },
  },
  courtyard: { x: -1.77, y: -1.77, w: 3.54, h: 6.08 },
  provenance: {
    source_type: 'standard',
    title: '2.54 mm (0.1″) pitch single-row pin header, 1×2 vertical',
    citation:
      'KiCad footprint library, Connector_PinHeader_2.54mm.pretty/PinHeader_1x02_P2.54mm_Vertical.kicad_mod — 2 through-hole pads 1.7 mm, 1.0 mm drill, 2.54 mm pitch',
    confidence: 'high',
    url: 'https://gitlab.com/kicad/libraries/kicad-footprints',
    notes: 'Origin at pin 1 (0,0); pin 1 square. The 2-pin power-in / 2-wire breakout connector.',
  },
  body3d: {
    heightMm: 2.5,
    standoffMm: 0,
    pinPosts: { widthMm: 0.64, heightMm: 6.0 },
    provenance: {
      source_type: 'datasheet',
      title: 'Standard 2.54 mm (0.1″) vertical pin header — insulator + pins',
      citation:
        'Generic 2.54 mm pin header (Würth 61300211121, Amphenol 10129378): black insulator 2.5 mm tall, 0.64 mm square posts protruding ≈6 mm above the insulator',
      confidence: 'medium',
    },
  },
}

/**
 * D_DO-41_SOD81_P10.16mm_Horizontal — the axial DO-41 (SOD-81) through-hole diode body, laid HORIZONTAL:
 * THE package the 1N4001–1N4007 rectifier family ships in. Two through-hole pads 10.16 mm (0.4″) apart,
 * 1.0 mm drills; pin 1 (the SQUARE pad) is the CATHODE, the band-marked end. The body is the real
 * ≈5.2×2.7 mm cylinder centred between the leads, with a silk cathode band near the pin-1 end. Origin at
 * pin 1 (the through-hole convention).
 */
export const FOOTPRINT_DO41: Footprint = {
  id: 'D_DO-41_SOD81_P10.16mm_Horizontal',
  name: 'DO-41 axial diode (through-hole, 10.16 mm)',
  description:
    'Axial through-hole rectifier diode (1N4001–1N4007) — pin 1 (square pad) is the cathode (band). DO-41 / SOD-81.',
  pads: [
    {
      id: '1',
      center: { x: 0, y: 0 },
      size: { w: 2.0, h: 2.0 },
      shape: 'rect',
      type: 'through_hole',
      holeDiameter: 1.0,
    },
    {
      id: '2',
      center: { x: 10.16, y: 0 },
      size: { w: 2.0, h: 2.0 },
      shape: 'circle',
      type: 'through_hole',
      holeDiameter: 1.0,
    },
  ],
  // Corner ticks + a CATHODE band near the pin-1 end (x = 3.0, inside the body), the painted band the real
  // 1N400x wears at its cathode. Clears both pads (pad 1 right edge x = 1.0).
  silkscreen: [
    ...cornerTicksSilk({ x: -1.3, y: -1.6, w: 12.76, h: 3.2 }),
    { from: { x: 3.0, y: -1.35 }, to: { x: 3.0, y: 1.35 }, width: 0.15 },
  ],
  // The body cylinder outline (≈5.2×2.7 mm, centred at x = 5.08) + the two axial lead lines out to the pads.
  fabrication: [
    ...rectOutline(2.48, -1.35, 7.68, 1.35),
    { from: { x: 0, y: 0 }, to: { x: 2.48, y: 0 }, width: 0.1 },
    { from: { x: 7.68, y: 0 }, to: { x: 10.16, y: 0 }, width: 0.1 },
  ],
  labels: {
    reference: { x: 5.08, y: -2.4 },
    value: { x: 5.08, y: 2.4 },
    fabReference: { x: 5.08, y: 0 },
  },
  courtyard: { x: -1.3, y: -1.6, w: 12.76, h: 3.2 },
  provenance: {
    source_type: 'standard',
    title: 'DO-41 (SOD-81) axial diode land pattern, 10.16 mm horizontal',
    citation:
      'KiCad footprint library, Diode_THT.pretty/D_DO-41_SOD81_P10.16mm_Horizontal.kicad_mod — two through-hole pads on 10.16 mm (0.4″) spacing, 1.0 mm drill; pin 1 square = cathode',
    confidence: 'high',
    url: 'https://gitlab.com/kicad/libraries/kicad-footprints',
    notes:
      'Origin at pin 1 (0,0), through-hole convention. Pin 1 (square) = cathode (band). Body 5.2×2.7 mm per the 1N400x DO-41 datasheet; silk is ChipBlocks’ own corner-tick + cathode-band rule.',
  },
  body3d: {
    heightMm: 2.7,
    standoffMm: 0.5,
    provenance: {
      source_type: 'datasheet',
      title: 'DO-41 (1N4001–1N4007) axial body dimensions',
      citation:
        'Vishay / onsemi 1N4001–1N4007 (DO-41) datasheets: body length ≈4.1–5.2 mm, diameter ≈2.0–2.7 mm, 0.72–0.86 mm leads on 0.4″ centres; lying horizontal the body sits ≈0.5 mm above the board',
      confidence: 'medium',
    },
  },
}

/**
 * A castellated module edge — the plated half-holes along the edge of a solder-down module (an ESP-12
 * WiFi module, an HC-05 Bluetooth module, an nRF24 board). Six castellated through-holes on 2.0 mm pitch
 * sit ON the module's bottom edge: the board profile route bisects each plated hole, leaving a solderable
 * half-barrel. The pitch is the ESP-module standard (2.0 mm); the hole (0.9 mm), ring (0.30 mm) and 1.1 mm
 * edge-to-edge all clear the JLCPCB castellated minimums (≥ 0.6 mm hole, ≥ 0.25 mm ring, ≥ 0.6 mm spacing).
 * The DRC exempts these pads from the copper-to-edge rule (they belong on the edge) and holds them to the
 * wider castellated minimums instead; deriveBoard snaps the board profile through the pad centres so the
 * half-holes actually sit on the finished edge.
 */
export const FOOTPRINT_CASTELLATED_1X6: Footprint = {
  id: 'Castellated_1x6_P2.0mm',
  name: 'castellated module edge (1×6, 2.0 mm)',
  description:
    'Six plated half-holes on 2.0 mm pitch along a module edge — a solder-down module land pattern.',
  pads: ([-5, -3, -1, 1, 3, 5] as const).map(
    (x, i): Pad => ({
      id: `${i + 1}`,
      center: { x, y: 3 },
      size: { w: 1.5, h: 1.5 },
      shape: i === 0 ? 'rect' : 'roundrect',
      type: 'through_hole',
      holeDiameter: 0.9,
      castellated: true,
    }),
  ),
  // Silk on the top + upper sides only — the bottom edge carries the castellations, so no ink there.
  silkscreen: [
    { from: { x: -6, y: -3 }, to: { x: 6, y: -3 }, width: 0.15 },
    { from: { x: -6, y: -3 }, to: { x: -6, y: 1.5 }, width: 0.15 },
    { from: { x: 6, y: -3 }, to: { x: 6, y: 1.5 }, width: 0.15 },
  ],
  fabrication: rectOutline(-6, -3, 6, 3),
  labels: {
    reference: { x: 0, y: -3.8 },
    value: { x: 0, y: 4.4 },
    fabReference: { x: 0, y: 0 },
  },
  courtyard: { x: -6, y: -3.2, w: 12, h: 7 },
  provenance: {
    source_type: 'reference',
    title: 'Castellated module edge — plated half-holes, 2.0 mm pitch (ESP-module standard)',
    citation:
      'Representative castellated solder-down module edge: 2.0 mm castellation pitch (the ESP-8266/ESP-12 module standard), with hole/ring/spacing sized to the JLCPCB castellated design requirements (≥ 0.6 mm hole, ≥ 0.25 mm ring, ≥ 0.6 mm edge-to-edge). Each half-hole is bisected by the board profile.',
    confidence: 'medium',
    url: 'https://jlcpcb.com/blog/castellated-pcbs-introduction-and-design-requirements',
    notes:
      'A generic castellated edge, not a verbatim vendor footprint; the pitch is the common 2.0 mm module standard, the pad geometry is sized to the fab castellated minimums.',
  },
}

/** Every built-in footprint, keyed by id. The board road's starter set (TOOLCHAIN-ROADMAP.md Track 1). */
export const BUILTIN_FOOTPRINTS: Record<string, Footprint> = {
  [FOOTPRINT_0402.id]: FOOTPRINT_0402,
  [FOOTPRINT_0603.id]: FOOTPRINT_0603,
  [FOOTPRINT_0805.id]: FOOTPRINT_0805,
  [FOOTPRINT_1206.id]: FOOTPRINT_1206,
  [FOOTPRINT_SOIC8.id]: FOOTPRINT_SOIC8,
  [FOOTPRINT_DIP8.id]: FOOTPRINT_DIP8,
  [FOOTPRINT_PINHDR_1X4.id]: FOOTPRINT_PINHDR_1X4,
  [FOOTPRINT_SOT23.id]: FOOTPRINT_SOT23,
  [FOOTPRINT_TO92.id]: FOOTPRINT_TO92,
  [FOOTPRINT_SOD123.id]: FOOTPRINT_SOD123,
  [FOOTPRINT_LED_0805.id]: FOOTPRINT_LED_0805,
  [FOOTPRINT_LED_5MM.id]: FOOTPRINT_LED_5MM,
  [FOOTPRINT_PINHDR_1X2.id]: FOOTPRINT_PINHDR_1X2,
  [FOOTPRINT_DO41.id]: FOOTPRINT_DO41,
  [FOOTPRINT_CASTELLATED_1X6.id]: FOOTPRINT_CASTELLATED_1X6,
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

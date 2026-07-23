/**
 * The geometry behind the footprint EDITOR — everything the editor does to a package, as plain functions
 * with no React in sight, so the arithmetic that decides where copper lands is testable on its own.
 *
 * The centrepiece is `generatePadRow`. A real IC package is rows of identical pads on a pitch, and a
 * datasheet's land pattern gives exactly that: how many pads, how far apart, how wide along the edge and
 * how far they reach outward. Placing a 48-pad QFN by dragging 48 pads one at a time would be a toy; four
 * rows from four datasheet lines is the real thing, so that is the shape of this API — the parameters are
 * the numbers the datasheet actually prints, not screen coordinates.
 *
 * Everything is in millimetres relative to the footprint origin, matching footprint.ts.
 */

import type {
  Courtyard,
  Footprint,
  FootprintProvenance,
  Pad,
  PadShape,
  PadType,
  SilkLine,
} from './footprint.ts'

/** Editor snap, in mm. 0.05 mm is finer than any land pattern needs but still kills mouse jitter. */
export const GRID_MM = 0.05
/**
 * Default assembly clearance around the copper: the IPC-7351 courtyard excess for density level B
 * (nominal), which is what the shipped footprint library is drawn to.
 */
export const DEFAULT_COURTYARD_MARGIN_MM = 0.25
/** The component body outline — KiCad's default fabrication-layer line width. Not a part dimension. */
const FAB_LINE_MM = 0.1
/**
 * Silkscreen stroke. 0.15 mm is the project's own minimum-printable-ink DRC limit (`silk-stroke` in
 * pcb-drc.ts, cited to JLCPCB's standard process and KiCad's default) — drawing thinner here would make
 * every footprint the editor produces fail ChipBlocks' own design-rule check.
 */
const SILK_LINE_MM = 0.15
/** Gap between the printed outline and the copper it must not touch. */
const SILK_OFFSET_MM = 0.15

/**
 * A millimetre value with floating-point dust removed but NOT snapped to anything — for numbers
 * computed from values the user typed, which have to stay exactly what the datasheet says. Six decimal
 * places is a nanometre, finer than the Gerber files this ends up in can even express.
 */
export function exactMm(value: number): number {
  return Number(value.toFixed(6))
}

/**
 * A millimetre value snapped to the editor grid. This is for DRAGS — it turns a mouse position into a
 * round number. It must never touch geometry computed from typed values: a 1.27 mm pitch snapped to a
 * 0.05 mm grid comes out as 1.30, 1.25, 1.25, 1.30…, which is not the part any more.
 */
export function snapMm(value: number, grid = GRID_MM): number {
  return exactMm(Math.round(value / grid) * grid)
}

/**
 * One row of pads along a package edge, described the way a datasheet describes it.
 * `widthMm` runs ALONG the edge and `lengthMm` points OUT from the body, so the same three numbers build
 * a row on any side — the editor doesn't ask the user to mentally swap width and height per side.
 */
export type PadRowSpec = {
  side: 'top' | 'bottom' | 'left' | 'right'
  count: number
  /** Centre-to-centre spacing (the datasheet's pitch, e.g. 0.5 mm for a QFN). */
  pitchMm: number
  /** Pad size along the edge. */
  widthMm: number
  /** Pad size pointing away from the body. */
  lengthMm: number
  /** Origin to the pad-centre line. */
  offsetMm: number
  /** Pad name of the first pad in the row; the rest count up. */
  startNumber: number
  shape: PadShape
  type: PadType
  holeDiameterMm?: number
  /** Count the row the other way — QFP/QFN numbering runs counter-clockwise, so two sides go backwards. */
  reverse?: boolean
}

/** The pads of one row, centred on the origin along the edge it runs down. */
export function generatePadRow(spec: PadRowSpec): Pad[] {
  const count = Math.max(0, Math.floor(spec.count))
  const horizontal = spec.side === 'top' || spec.side === 'bottom'
  const size = horizontal
    ? { w: spec.widthMm, h: spec.lengthMm }
    : { w: spec.lengthMm, h: spec.widthMm }
  const pads: Pad[] = []
  for (let i = 0; i < count; i++) {
    // exactMm, NOT snapMm: these come from the pitch the user typed off a datasheet and must stay
    // exact. The real pitches — 1.27 (SOIC), 2.54 (headers), 0.95 (SOT-23), 1.778 — are none of them
    // multiples of the editor's drag grid, and snapping would quietly make the row a different part.
    const along = exactMm((i - (count - 1) / 2) * spec.pitchMm)
    const number = spec.startNumber + (spec.reverse === true ? count - 1 - i : i)
    const center = horizontal
      ? { x: along, y: spec.side === 'top' ? -spec.offsetMm : spec.offsetMm }
      : { x: spec.side === 'left' ? -spec.offsetMm : spec.offsetMm, y: along }
    const pad: Pad = { id: String(number), center, size, shape: spec.shape, type: spec.type }
    if (spec.type === 'through_hole' && spec.holeDiameterMm !== undefined) {
      pad.holeDiameter = spec.holeDiameterMm
    }
    pads.push(pad)
  }
  return pads
}

/** The next free pad number — so "add a pad" never lands on a name that is already taken. */
export function nextPadNumber(pads: readonly Pad[]): string {
  let highest = 0
  for (const pad of pads) {
    const asNumber = Number(pad.id)
    if (Number.isInteger(asNumber) && asNumber > highest) highest = asNumber
  }
  const taken = new Set(pads.map((p) => p.id))
  let candidate = highest + 1
  while (taken.has(String(candidate))) candidate++
  return String(candidate)
}

/** A rectangle outline centred on the origin, as four line segments. */
export function rectOutline(widthMm: number, heightMm: number, lineWidthMm: number): SilkLine[] {
  const x = widthMm / 2
  const y = heightMm / 2
  const corners = [
    { x: -x, y: -y },
    { x, y: -y },
    { x, y },
    { x: -x, y },
  ]
  return corners.map((from, i) => ({
    from,
    to: corners[(i + 1) % corners.length] as { x: number; y: number },
    width: lineWidthMm,
  }))
}

/**
 * The smallest courtyard that encloses the copper (and the body, if there is one) plus a margin.
 * The validator refuses a courtyard that misses a pad, so deriving it from the pads means the keep-out is
 * true by construction as the user drags things around.
 */
export function fitCourtyard(
  pads: readonly Pad[],
  marginMm = DEFAULT_COURTYARD_MARGIN_MM,
  bodyMm?: { w: number; h: number } | null,
): Courtyard {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  const grow = (x0: number, y0: number, x1: number, y1: number) => {
    if (x0 < minX) minX = x0
    if (y0 < minY) minY = y0
    if (x1 > maxX) maxX = x1
    if (y1 > maxY) maxY = y1
  }
  for (const pad of pads) {
    grow(
      pad.center.x - pad.size.w / 2,
      pad.center.y - pad.size.h / 2,
      pad.center.x + pad.size.w / 2,
      pad.center.y + pad.size.h / 2,
    )
  }
  if (bodyMm && bodyMm.w > 0 && bodyMm.h > 0) {
    grow(-bodyMm.w / 2, -bodyMm.h / 2, bodyMm.w / 2, bodyMm.h / 2)
  }
  // Nothing drawn yet — a placeholder square, so the canvas still has something to show.
  if (!Number.isFinite(minX)) return { x: -1, y: -1, w: 2, h: 2 }
  return {
    x: minX - marginMm,
    y: minY - marginMm,
    w: maxX - minX + 2 * marginMm,
    h: maxY - minY + 2 * marginMm,
  }
}

/** Is there a real component body to draw? A half-entered one (one side still 0) is not yet. */
function hasBody(bodyMm: { w: number; h: number }): boolean {
  return bodyMm.w > 0 && bodyMm.h > 0
}

/**
 * The pads reordered to run in the order their names do.
 *
 * This is load-bearing, not tidiness. A part's Nth pin solders to the Nth pad in this array
 * (footprint-assignment.ts `padForTerminal`) — an invariant every hand-written built-in holds because
 * its pads are declared 1, 2, 3… in order. A row counted backwards (which real QFP/QFN numbering
 * needs) appends pads whose array order fights their numbering, and without this every pin on that row
 * would solder to the wrong pad: on a 48-pad QFN, pin 25 would land where pin 36 belongs.
 *
 * Packages with named pads (GND, A1) keep the order they were authored in — there is no number to sort
 * by, and index order is exactly what the pin mapping means for them.
 */
function inPadNumberOrder(pads: readonly Pad[]): Pad[] {
  const numbered = pads.every((pad) => Number.isInteger(Number(pad.id)))
  if (!numbered) return [...pads]
  return [...pads].sort((a, b) => Number(a.id) - Number(b.id))
}

/** The printed outline's size: clear of every pad AND of the body, so no ink lands on copper. */
function silkExtent(
  pads: readonly Pad[],
  bodyMm: { w: number; h: number },
): { w: number; h: number } {
  let halfWidth = bodyMm.w / 2
  let halfHeight = bodyMm.h / 2
  for (const pad of pads) {
    halfWidth = Math.max(halfWidth, Math.abs(pad.center.x) + pad.size.w / 2)
    halfHeight = Math.max(halfHeight, Math.abs(pad.center.y) + pad.size.h / 2)
  }
  return { w: 2 * (halfWidth + SILK_OFFSET_MM), h: 2 * (halfHeight + SILK_OFFSET_MM) }
}

/** What the editor holds while you draw. The courtyard and outlines are DERIVED unless overridden. */
export type FootprintDraft = {
  id: string
  name: string
  description: string
  pads: Pad[]
  /** The component body (what you'd see sitting on the board). Either side 0 = no body drawn; a
   *  half-entered body keeps the side you already typed. */
  bodyMm: { w: number; h: number }
  courtyardMarginMm: number
  /** Set only when the user drags the keep-out themselves; null = keep it fitted to the pads. */
  manualCourtyard: Courtyard | null
  provenance: FootprintProvenance
}

export function blankFootprintDraft(): FootprintDraft {
  return {
    id: '',
    name: '',
    description: '',
    pads: [],
    bodyMm: { w: 0, h: 0 },
    courtyardMarginMm: DEFAULT_COURTYARD_MARGIN_MM,
    manualCourtyard: null,
    provenance: { source_type: 'datasheet', title: '', citation: '', confidence: 'high' },
  }
}

/** An existing footprint reopened for editing — the body/courtyard become manual, since they're given. */
export function draftFromFootprint(footprint: Footprint): FootprintDraft {
  return {
    id: footprint.id,
    name: footprint.name,
    description: footprint.description,
    pads: footprint.pads.map((p) => ({ ...p, center: { ...p.center }, size: { ...p.size } })),
    bodyMm: { w: 0, h: 0 },
    courtyardMarginMm: DEFAULT_COURTYARD_MARGIN_MM,
    manualCourtyard: { ...footprint.courtyard },
    provenance: { ...footprint.provenance },
  }
}

export function draftCourtyard(draft: FootprintDraft): Courtyard {
  return draft.manualCourtyard ?? fitCourtyard(draft.pads, draft.courtyardMarginMm, draft.bodyMm)
}

/** An id from a typed name: 'QFN-48 7x7 mm' → 'QFN-48_7x7_mm'. */
export function slugFootprintId(name: string): string {
  return name
    .trim()
    .replace(/[^A-Za-z0-9.+-]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * The draft as a real Footprint. The label anchors are placed relative to the finished courtyard — the
 * designator above the part and the value below, the EDA convention — so the user never has to think
 * about them.
 */
export function draftToFootprint(draft: FootprintDraft): Footprint {
  const courtyard = draftCourtyard(draft)
  const body = hasBody(draft.bodyMm) ? draft.bodyMm : null
  // The silkscreen is INK, and ink on a pad stops solder wetting it — real fabs clip silk that crosses
  // copper. A package's pads often reach in under its body (a QFN's do), so an outline drawn at the body
  // would print across them: the printed outline goes outside the copper as well as the body.
  const silk = body === null ? null : silkExtent(draft.pads, body)
  return {
    id: draft.id.trim(),
    name: draft.name.trim(),
    description: draft.description.trim(),
    pads: inPadNumberOrder(draft.pads),
    silkscreen: silk === null ? [] : rectOutline(silk.w, silk.h, SILK_LINE_MM),
    fabrication: body === null ? [] : rectOutline(body.w, body.h, FAB_LINE_MM),
    labels: {
      reference: { x: 0, y: courtyard.y - 0.5 },
      value: { x: 0, y: courtyard.y + courtyard.h + 0.5 },
      fabReference: { x: 0, y: 0 },
    },
    courtyard,
    provenance: draft.provenance,
  }
}

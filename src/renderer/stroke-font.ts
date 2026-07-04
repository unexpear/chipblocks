import type { FootprintProvenance } from './footprint.ts'

/**
 * A single-stroke vector font for board lettering — the reference designators printed on the
 * silkscreen. Gerber has no text: every letter a fab prints is drawn strokes, so silk lettering
 * needs a font made of line segments a plotter pen could follow. These glyphs are ChipBlocks' own
 * plotter-style designs (the same rule as the schematic symbols: we draw our own artwork, never
 * copy another tool's), on a 4-wide × 7-tall grid, y down like the board frame. Designators are
 * UPPERCASED — the classic silkscreen convention, and it halves the glyph set honestly.
 *
 * The SIZE the text prints at is a manufactured value and is cited: KiCad 10's silkscreen text
 * defaults, as carried by the project templates installed on this machine.
 */

export const SILK_TEXT: {
  heightMm: number
  thicknessMm: number
  provenance: FootprintProvenance
} = {
  heightMm: 1.0,
  thicknessMm: 0.15,
  provenance: {
    source_type: 'reference',
    title: 'KiCad 10 silkscreen text defaults — 1.0 mm size, 0.15 mm stroke thickness',
    citation:
      'KiCad 10 project templates (board.design_settings.defaults: silk_text_size_h/v = 1.0, silk_text_thickness = 0.15) — exactly these values in 18 of the 20 installed templates (one mils-converted legacy template differs by <0.1%; one carries no board defaults)',
    confidence: 'high',
    url: 'https://gitlab.com/kicad/code/kicad',
    date_accessed: '2026-07-04',
  },
}

/** Glyph grid: x 0..4, y 0..7 with y DOWN (0 = cap top, 7 = baseline), matching the board frame. */
const GRID_WIDTH = 4
const GRID_HEIGHT = 7
/** Horizontal pitch between characters, in grid units (glyph width 4 + 2 of air). */
const ADVANCE = 6

type Polyline = [number, number][]

/** Each glyph is the polylines a plotter pen draws — pen down along each, pen up between. */
const GLYPHS: Record<string, Polyline[]> = {
  A: [
    [
      [0, 7],
      [2, 0],
      [4, 7],
    ],
    [
      [1, 4],
      [3, 4],
    ],
  ],
  B: [
    [
      [0, 7],
      [0, 0],
      [3, 0],
      [4, 1],
      [4, 2.5],
      [3, 3.5],
      [0, 3.5],
    ],
    [
      [3, 3.5],
      [4, 4.5],
      [4, 6],
      [3, 7],
      [0, 7],
    ],
  ],
  C: [
    [
      [4, 1],
      [3, 0],
      [1, 0],
      [0, 1],
      [0, 6],
      [1, 7],
      [3, 7],
      [4, 6],
    ],
  ],
  D: [
    [
      [0, 7],
      [0, 0],
      [3, 0],
      [4, 1],
      [4, 6],
      [3, 7],
      [0, 7],
    ],
  ],
  E: [
    [
      [4, 0],
      [0, 0],
      [0, 7],
      [4, 7],
    ],
    [
      [0, 3.5],
      [3, 3.5],
    ],
  ],
  F: [
    [
      [4, 0],
      [0, 0],
      [0, 7],
    ],
    [
      [0, 3.5],
      [3, 3.5],
    ],
  ],
  G: [
    [
      [4, 1],
      [3, 0],
      [1, 0],
      [0, 1],
      [0, 6],
      [1, 7],
      [3, 7],
      [4, 6],
      [4, 4],
      [2, 4],
    ],
  ],
  H: [
    [
      [0, 0],
      [0, 7],
    ],
    [
      [4, 0],
      [4, 7],
    ],
    [
      [0, 3.5],
      [4, 3.5],
    ],
  ],
  I: [
    [
      [1, 0],
      [3, 0],
    ],
    [
      [2, 0],
      [2, 7],
    ],
    [
      [1, 7],
      [3, 7],
    ],
  ],
  J: [
    [
      [4, 0],
      [4, 6],
      [3, 7],
      [1, 7],
      [0, 6],
    ],
  ],
  K: [
    [
      [0, 0],
      [0, 7],
    ],
    [
      [4, 0],
      [0, 3.5],
      [4, 7],
    ],
  ],
  L: [
    [
      [0, 0],
      [0, 7],
      [4, 7],
    ],
  ],
  M: [
    [
      [0, 7],
      [0, 0],
      [2, 3],
      [4, 0],
      [4, 7],
    ],
  ],
  N: [
    [
      [0, 7],
      [0, 0],
      [4, 7],
      [4, 0],
    ],
  ],
  O: [
    [
      [1, 0],
      [3, 0],
      [4, 1],
      [4, 6],
      [3, 7],
      [1, 7],
      [0, 6],
      [0, 1],
      [1, 0],
    ],
  ],
  P: [
    [
      [0, 7],
      [0, 0],
      [3, 0],
      [4, 1],
      [4, 3],
      [3, 4],
      [0, 4],
    ],
  ],
  Q: [
    [
      [1, 0],
      [3, 0],
      [4, 1],
      [4, 6],
      [3, 7],
      [1, 7],
      [0, 6],
      [0, 1],
      [1, 0],
    ],
    [
      [2.5, 5],
      [4, 7],
    ],
  ],
  R: [
    [
      [0, 7],
      [0, 0],
      [3, 0],
      [4, 1],
      [4, 3],
      [3, 4],
      [0, 4],
    ],
    [
      [2, 4],
      [4, 7],
    ],
  ],
  S: [
    [
      [4, 1],
      [3, 0],
      [1, 0],
      [0, 1],
      [0, 2.5],
      [1, 3.5],
      [3, 3.5],
      [4, 4.5],
      [4, 6],
      [3, 7],
      [1, 7],
      [0, 6],
    ],
  ],
  T: [
    [
      [0, 0],
      [4, 0],
    ],
    [
      [2, 0],
      [2, 7],
    ],
  ],
  U: [
    [
      [0, 0],
      [0, 6],
      [1, 7],
      [3, 7],
      [4, 6],
      [4, 0],
    ],
  ],
  V: [
    [
      [0, 0],
      [2, 7],
      [4, 0],
    ],
  ],
  W: [
    [
      [0, 0],
      [1, 7],
      [2, 3.5],
      [3, 7],
      [4, 0],
    ],
  ],
  X: [
    [
      [0, 0],
      [4, 7],
    ],
    [
      [4, 0],
      [0, 7],
    ],
  ],
  Y: [
    [
      [0, 0],
      [2, 3.5],
      [4, 0],
    ],
    [
      [2, 3.5],
      [2, 7],
    ],
  ],
  Z: [
    [
      [0, 0],
      [4, 0],
      [0, 7],
      [4, 7],
    ],
  ],
  '0': [
    [
      [1, 0],
      [3, 0],
      [4, 1],
      [4, 6],
      [3, 7],
      [1, 7],
      [0, 6],
      [0, 1],
      [1, 0],
    ],
    [
      [1, 6],
      [3, 1],
    ],
  ],
  '1': [
    [
      [1, 1],
      [2, 0],
      [2, 7],
    ],
    [
      [1, 7],
      [3, 7],
    ],
  ],
  '2': [
    [
      [0, 1],
      [1, 0],
      [3, 0],
      [4, 1],
      [4, 2.5],
      [0, 7],
      [4, 7],
    ],
  ],
  '3': [
    [
      [0, 1],
      [1, 0],
      [3, 0],
      [4, 1],
      [4, 2.5],
      [3, 3.5],
      [1.5, 3.5],
    ],
    [
      [3, 3.5],
      [4, 4.5],
      [4, 6],
      [3, 7],
      [1, 7],
      [0, 6],
    ],
  ],
  '4': [
    [
      [3, 7],
      [3, 0],
      [0, 4.5],
      [4, 4.5],
    ],
  ],
  '5': [
    [
      [4, 0],
      [0, 0],
      [0, 3],
      [3, 3],
      [4, 4],
      [4, 6],
      [3, 7],
      [1, 7],
      [0, 6],
    ],
  ],
  '6': [
    [
      [4, 1],
      [3, 0],
      [1, 0],
      [0, 1],
      [0, 6],
      [1, 7],
      [3, 7],
      [4, 6],
      [4, 4.5],
      [3, 3.5],
      [0, 3.5],
    ],
  ],
  '7': [
    [
      [0, 0],
      [4, 0],
      [1.5, 7],
    ],
  ],
  '8': [
    [
      [1, 0],
      [3, 0],
      [4, 1],
      [4, 2.5],
      [3, 3.5],
      [1, 3.5],
      [0, 2.5],
      [0, 1],
      [1, 0],
    ],
    [
      [1, 3.5],
      [0, 4.5],
      [0, 6],
      [1, 7],
      [3, 7],
      [4, 6],
      [4, 4.5],
      [3, 3.5],
    ],
  ],
  '9': [
    [
      [0, 6],
      [1, 7],
      [3, 7],
      [4, 6],
      [4, 1],
      [3, 0],
      [1, 0],
      [0, 1],
      [0, 2.5],
      [1, 3.5],
      [4, 3.5],
    ],
  ],
  '-': [
    [
      [0.5, 3.5],
      [3.5, 3.5],
    ],
  ],
  _: [
    [
      [0, 7],
      [4, 7],
    ],
  ],
  '+': [
    [
      [2, 1.5],
      [2, 5.5],
    ],
    [
      [0, 3.5],
      [4, 3.5],
    ],
  ],
  '.': [
    [
      [2, 6.5],
      [2, 7],
    ],
  ],
  '/': [
    [
      [0, 7],
      [4, 0],
    ],
  ],
  '(': [
    [
      [3, 0],
      [2, 1],
      [2, 6],
      [3, 7],
    ],
  ],
  ')': [
    [
      [1, 0],
      [2, 1],
      [2, 6],
      [1, 7],
    ],
  ],
}

export type StrokeSegment = { from: { x: number; y: number }; to: { x: number; y: number } }

export type StrokeTextResult = {
  segments: StrokeSegment[]
  /** Characters (post-uppercasing) with no glyph — skipped with their space kept, and reported so
   *  a caller can say so instead of printing silence silently. */
  missing: string[]
  widthMm: number
}

/**
 * Lay `text` out as pen strokes, centred on `center` (both axes — the anchor convention the
 * footprints' label positions use), at cap height `heightMm`. A space advances without drawing;
 * any character without a glyph advances too and is reported in `missing`.
 */
export function strokeText(
  text: string,
  center: { x: number; y: number },
  heightMm: number = SILK_TEXT.heightMm,
): StrokeTextResult {
  const upper = text.toUpperCase()
  const scale = heightMm / GRID_HEIGHT
  const widthMm = (upper.length * ADVANCE - (ADVANCE - GRID_WIDTH)) * scale
  const x0 = center.x - widthMm / 2
  const y0 = center.y - heightMm / 2
  const segments: StrokeSegment[] = []
  const missing: string[] = []
  for (let i = 0; i < upper.length; i++) {
    const ch = upper[i] as string
    if (ch === ' ') continue
    const glyph = GLYPHS[ch]
    if (glyph === undefined) {
      if (!missing.includes(ch)) missing.push(ch)
      continue
    }
    const cx = x0 + i * ADVANCE * scale
    for (const line of glyph) {
      for (let p = 0; p < line.length - 1; p++) {
        const [ax, ay] = line[p] as [number, number]
        const [bx, by] = line[p + 1] as [number, number]
        segments.push({
          from: { x: cx + ax * scale, y: y0 + ay * scale },
          to: { x: cx + bx * scale, y: y0 + by * scale },
        })
      }
    }
  }
  return { segments, missing, widthMm }
}

/** Every character the font can print (post-uppercasing) — the coverage the tests pin. */
export const STROKE_FONT_CHARACTERS = Object.keys(GLYPHS)

/** The printed width of `text` at `heightMm`, without laying it out — what the board's outline
 *  fit needs so lettering never hangs off the manufactured edge. */
export function strokeTextWidthMm(text: string, heightMm: number = SILK_TEXT.heightMm): number {
  return ((text.length * ADVANCE - (ADVANCE - GRID_WIDTH)) * heightMm) / GRID_HEIGHT
}

/**
 * The footprint EDITOR's geometry. The point of these is the last block: a package built the way the
 * editor builds one has to be a package the validator accepts and a part can land on — otherwise the
 * editor is a drawing toy that produces footprints the board refuses.
 */

import { describe, expect, test } from 'vitest'
import type { Pad } from '../src/renderer/footprint.ts'
import {
  blankFootprintDraft,
  draftCourtyard,
  draftToFootprint,
  exactMm,
  fitCourtyard,
  generatePadRow,
  nextPadNumber,
  type PadRowSpec,
  rectOutline,
  slugFootprintId,
  snapMm,
} from '../src/renderer/footprint-draft.ts'
import { footprintProblems } from '../src/renderer/user-footprint-validate.ts'

const row = (over: Partial<PadRowSpec> = {}): PadRowSpec => ({
  side: 'top',
  count: 4,
  pitchMm: 0.5,
  widthMm: 0.28,
  lengthMm: 0.8,
  offsetMm: 3.4,
  startNumber: 1,
  shape: 'roundrect',
  type: 'smd',
  ...over,
})

describe('pad rows — a datasheet line becomes copper', () => {
  test('a row is centred on the origin and spaced by the pitch', () => {
    const pads = generatePadRow(row({ count: 4, pitchMm: 0.5 }))
    expect(pads.map((p) => p.center.x)).toEqual([-0.75, -0.25, 0.25, 0.75])
    // every pad on the same centre line, above the origin for a top row
    expect(pads.every((p) => p.center.y === -3.4)).toBe(true)
    expect(pads.map((p) => p.id)).toEqual(['1', '2', '3', '4'])
  })

  test('an odd count puts a pad exactly on the centre line', () => {
    expect(generatePadRow(row({ count: 3 })).map((p) => p.center.x)).toEqual([-0.5, 0, 0.5])
  })

  test('width runs along the edge and length points outward — on every side', () => {
    const top = generatePadRow(row({ side: 'top' }))[0] as Pad
    const left = generatePadRow(row({ side: 'left' }))[0] as Pad
    // the same two datasheet numbers, oriented to the edge the row sits on
    expect(top.size).toEqual({ w: 0.28, h: 0.8 })
    expect(left.size).toEqual({ w: 0.8, h: 0.28 })
    expect(left.center.x).toBe(-3.4)
  })

  test('a bottom row sits below and a right row sits right of the origin', () => {
    expect((generatePadRow(row({ side: 'bottom' }))[0] as Pad).center.y).toBe(3.4)
    expect((generatePadRow(row({ side: 'right' }))[0] as Pad).center.x).toBe(3.4)
  })

  test('reverse numbers the row backwards — QFP numbering runs counter-clockwise', () => {
    const pads = generatePadRow(row({ count: 4, startNumber: 5, reverse: true }))
    expect(pads.map((p) => p.id)).toEqual(['8', '7', '6', '5'])
    // positions are unchanged; only the names run the other way
    expect(pads.map((p) => p.center.x)).toEqual([-0.75, -0.25, 0.25, 0.75])
  })

  test('a through-hole row carries its drill; an SMD row carries none', () => {
    const th = generatePadRow(row({ type: 'through_hole', holeDiameterMm: 0.9, shape: 'circle' }))
    expect(th.every((p) => p.holeDiameter === 0.9)).toBe(true)
    expect(generatePadRow(row()).every((p) => p.holeDiameter === undefined)).toBe(true)
  })

  test('REAL pitches survive exactly — the row is not snapped to the editor grid', () => {
    // None of the pitches that actually matter is a multiple of the 0.05 mm drag grid. Snapping a
    // 1.27 mm SOIC row turns it into 1.30/1.25/1.25/1.30… — a different part, silently, in the
    // Gerbers. The shipped library's own footprints sit on these values (SOIC-8 pads at ±0.635,
    // SOT-23 at ±0.9375), so a generator that can't hold them can't rebuild the library.
    const gaps = (pitchMm: number, count: number) => {
      const xs = generatePadRow(row({ side: 'top', count, pitchMm })).map((p) => p.center.x)
      return xs.slice(1).map((x, i) => exactMm(x - (xs[i] as number)))
    }
    expect(gaps(1.27, 8)).toEqual([1.27, 1.27, 1.27, 1.27, 1.27, 1.27, 1.27]) // SOIC / DIP
    expect(gaps(2.54, 6)).toEqual([2.54, 2.54, 2.54, 2.54, 2.54]) // 0.1-inch header
    expect(gaps(0.95, 2)).toEqual([0.95]) // SOT-23
    expect(gaps(1.778, 4)).toEqual([1.778, 1.778, 1.778])
    // and the row still sits centred on the origin, not shifted by rounding
    const xs = generatePadRow(row({ count: 4, pitchMm: 0.65 })).map((p) => p.center.x)
    expect(exactMm((xs[0] as number) + (xs[3] as number))).toBe(0)
  })

  test('a zero or negative count makes no pads rather than throwing', () => {
    expect(generatePadRow(row({ count: 0 }))).toEqual([])
    expect(generatePadRow(row({ count: -3 }))).toEqual([])
  })
})

describe('the derived courtyard', () => {
  const pads = generatePadRow(row({ count: 2, pitchMm: 1 }))

  test('it encloses the copper plus the margin', () => {
    const c = fitCourtyard(pads, 0.25)
    // pads span x −0.64…0.64 (±0.5 centre ±0.14) and y −3.8…−3.0
    expect(c.x).toBeCloseTo(-0.89, 6)
    expect(c.y).toBeCloseTo(-4.05, 6)
    expect(c.x + c.w).toBeCloseTo(0.89, 6)
    expect(c.y + c.h).toBeCloseTo(-2.75, 6)
  })

  test('it grows to cover the component body too', () => {
    const c = fitCourtyard(pads, 0.25, { w: 7, h: 7 })
    expect(c.x).toBeCloseTo(-3.75, 6)
    expect(c.y + c.h).toBeCloseTo(3.75, 6)
  })

  test('with nothing drawn it is a placeholder square, not an infinite rectangle', () => {
    const c = fitCourtyard([], 0.25)
    expect(Number.isFinite(c.w) && c.w > 0).toBe(true)
    expect(Number.isFinite(c.h) && c.h > 0).toBe(true)
  })

  test('a dragged courtyard overrides the fit, and clearing it restores the fit', () => {
    const draft = { ...blankFootprintDraft(), pads, courtyardMarginMm: 0.25 }
    const manual = { x: -9, y: -9, w: 18, h: 18 }
    expect(draftCourtyard({ ...draft, manualCourtyard: manual })).toEqual(manual)
    // compared against the fit computed independently — not against another draftCourtyard call
    expect(draftCourtyard({ ...draft, manualCourtyard: null })).toEqual(
      fitCourtyard(pads, 0.25, draft.bodyMm),
    )
  })
})

describe('small pieces', () => {
  test('snap lands on the grid', () => {
    expect(snapMm(0.5234)).toBeCloseTo(0.5, 6)
    expect(snapMm(-0.13)).toBeCloseTo(-0.15, 6)
  })

  test('a snapped value is a clean millimetre, not floating-point dust', () => {
    // this number is shown in a field the user reads and written into a manufacturing file
    expect(String(snapMm(-0.13))).toBe('-0.15')
    expect(String(snapMm(0.5234))).toBe('0.5')
    expect(String(snapMm(1.3 - 1.45))).toBe('-0.15')
  })

  test('the next pad number skips names already taken', () => {
    expect(nextPadNumber([])).toBe('1')
    expect(nextPadNumber(generatePadRow(row({ count: 4 })))).toBe('5')
    // non-numeric names (GND, A1) don't confuse the count
    const named = [...generatePadRow(row({ count: 2 }))]
    named.push({ ...(named[0] as Pad), id: 'GND' })
    expect(nextPadNumber(named)).toBe('3')
  })

  test('a rectangle outline closes back on itself', () => {
    const lines = rectOutline(4, 2, 0.1)
    expect(lines).toHaveLength(4)
    expect(lines[3]?.to).toEqual(lines[0]?.from)
    expect(lines[0]?.from).toEqual({ x: -2, y: -1 })
  })

  test('an id comes from the name without spaces or punctuation', () => {
    expect(slugFootprintId('QFN-48 7x7 mm')).toBe('QFN-48_7x7_mm')
    expect(slugFootprintId('  odd//name  ')).toBe('odd_name')
  })
})

describe('the payoff — the editor builds packages the rest of the app accepts', () => {
  const provenance = {
    source_type: 'datasheet' as const,
    title: 'Lattice iCE40 LP/HX Family Data Sheet',
    citation: 'QFN-48 package drawing',
    confidence: 'high' as const,
  }

  test('a 48-pad QFN built from four rows is valid, complete and correctly numbered', () => {
    // Exactly how a user would build it: four datasheet lines, numbered counter-clockwise from pin 1.
    const common = { count: 12, pitchMm: 0.5, widthMm: 0.28, lengthMm: 0.8, offsetMm: 3.4 } as const
    const pads = [
      ...generatePadRow({
        ...common,
        side: 'left',
        startNumber: 1,
        shape: 'roundrect',
        type: 'smd',
      }),
      ...generatePadRow({
        ...common,
        side: 'bottom',
        startNumber: 13,
        shape: 'roundrect',
        type: 'smd',
      }),
      ...generatePadRow({
        ...common,
        side: 'right',
        startNumber: 25,
        shape: 'roundrect',
        type: 'smd',
        reverse: true,
      }),
      ...generatePadRow({
        ...common,
        side: 'top',
        startNumber: 37,
        shape: 'roundrect',
        type: 'smd',
        reverse: true,
      }),
    ]
    const draft = {
      ...blankFootprintDraft(),
      id: 'QFN-48_7x7mm_TEST',
      name: 'QFN-48 7×7 mm',
      pads,
      bodyMm: { w: 7, h: 7 },
      provenance,
    }
    const footprint = draftToFootprint(draft)

    expect(footprint.pads).toHaveLength(48)
    expect(new Set(footprint.pads.map((p) => p.id)).size).toBe(48) // every pad nameable, none repeated
    expect(footprintProblems(footprint)).toEqual([]) // …and the validator accepts it

    // THE MIS-SOLDER GUARD. A part's Nth pin solders to the Nth pad in this array, so the array order
    // must match the numbering. Two of a QFN's four sides count backwards; without reordering, pin 25
    // would land on the pad printed 36 — on the wrong side of the chip.
    expect(footprint.pads.map((p) => p.id)).toEqual(
      Array.from({ length: 48 }, (_, i) => String(i + 1)),
    )
    // and pad 25 really is diagonally opposite pad 1, as the package numbering says
    const pad = (id: string) => footprint.pads.find((p) => p.id === id)
    expect(pad('1')?.center.x).toBeLessThan(0)
    expect(pad('25')?.center.x).toBeGreaterThan(0)
    expect(pad('25')?.center.y).toBeGreaterThan(0)

    // A QFN's pads reach in UNDER its body, so an outline drawn at the 7 mm body would print ink
    // across them — silk on a pad stops solder wetting it. The printed outline clears all copper.
    const silkHalfWidth = Math.max(...footprint.silkscreen.map((s) => Math.abs(s.from.x)))
    const padReach = Math.max(...footprint.pads.map((p) => Math.abs(p.center.x) + p.size.w / 2))
    expect(silkHalfWidth).toBeGreaterThan(padReach)
    expect(padReach).toBeGreaterThan(3.5) // the pads really do overhang the 7 mm body
  })

  test('pads named rather than numbered keep the order they were authored in', () => {
    // There is no number to sort by, and index order is exactly what the pin mapping means for them.
    const draft = {
      ...blankFootprintDraft(),
      id: 'TEST_NAMED',
      name: 'Named pads',
      pads: generatePadRow(row({ count: 3 })).map((p, i) => ({
        ...p,
        id: ['GND', 'VCC', 'OUT'][i] as string,
      })),
      provenance,
    }
    expect(draftToFootprint(draft).pads.map((p) => p.id)).toEqual(['GND', 'VCC', 'OUT'])
  })

  test('a drawn footprint gets a body outline and label anchors it never had to ask about', () => {
    const draft = {
      ...blankFootprintDraft(),
      id: 'TEST_SOT23',
      name: 'Test SOT-23',
      pads: generatePadRow(row({ count: 3, pitchMm: 0.95 })),
      bodyMm: { w: 2.9, h: 1.3 },
      provenance,
    }
    const fp = draftToFootprint(draft)
    expect(fp.fabrication).toHaveLength(4) // the body
    expect(fp.silkscreen).toHaveLength(4) // ink, printed just outside it
    expect(fp.silkscreen[0]?.from.x).toBeLessThan(fp.fabrication[0]?.from.x as number)
    // the designator sits above the keep-out, the value below it — nobody had to place them
    expect(fp.labels.reference.y).toBeLessThan(fp.courtyard.y)
    expect(fp.labels.value.y).toBeGreaterThan(fp.courtyard.y + fp.courtyard.h)
    expect(footprintProblems(fp)).toEqual([])
  })

  test('an unfinished draft reports what is missing instead of saving something broken', () => {
    const problems = footprintProblems(draftToFootprint(blankFootprintDraft()))
    expect(problems.join(' ')).toMatch(/needs an id/)
    expect(problems.join(' ')).toMatch(/at least one pad/)
    // the source block exists but is blank, so it names the missing fields rather than the whole thing
    expect(problems.join(' ')).toMatch(/needs a title/)
    expect(problems.join(' ')).toMatch(/needs a citation/)
  })
})

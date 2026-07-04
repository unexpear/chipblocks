/**
 * The board lettering font. Jobs: every character a part id can carry has a glyph (designators are
 * uppercased, the silkscreen convention); the layout centres on the anchor at the cited 1.0 mm cap
 * height; unknown characters keep their space and are REPORTED, never silently swallowed; and the
 * geometry scales linearly (the same glyph at 2× height is exactly 2× the strokes).
 */
import { describe, expect, test } from 'vitest'
import { SILK_TEXT, STROKE_FONT_CHARACTERS, strokeText } from '../src/renderer/stroke-font.ts'

describe('coverage and honesty', () => {
  test('every character a canvas part id uses has a glyph: A–Z, 0–9, and the id punctuation', () => {
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_+./()') {
      expect(STROKE_FONT_CHARACTERS, `missing glyph for '${ch}'`).toContain(ch)
    }
  })

  test('lowercase input strokes the uppercase glyph — r1 prints as R1', () => {
    const lower = strokeText('r1', { x: 0, y: 0 }, 1)
    const upper = strokeText('R1', { x: 0, y: 0 }, 1)
    expect(lower.segments).toEqual(upper.segments)
    expect(lower.missing).toEqual([])
  })

  test('an unknown character keeps its space and is named in `missing`', () => {
    const r = strokeText('r#1', { x: 0, y: 0 }, 1)
    expect(r.missing).toEqual(['#'])
    // the '1' still lands in its own slot — same position as in a 3-char string with any middle
    const withDash = strokeText('r-1', { x: 0, y: 0 }, 1)
    const oneStrokes = (s: typeof r) => s.segments.slice(-3) // the trailing '1' is 3 segments
    expect(r.widthMm).toBeCloseTo(withDash.widthMm, 12)
    expect(oneStrokes(r)).toEqual(oneStrokes(withDash))
  })

  test('the printed size is the cited KiCad default (1.0 mm at 0.15 mm stroke)', () => {
    expect(SILK_TEXT.heightMm).toBe(1.0)
    expect(SILK_TEXT.thicknessMm).toBe(0.15)
    expect(SILK_TEXT.provenance.confidence).toBe('high')
    expect(SILK_TEXT.provenance.citation).toContain('silk_text_size')
  })
})

describe('geometry', () => {
  test('hand-check: a lone I centres its stem EXACTLY on the anchor', () => {
    // 1 char at height 1: scale 1/7, width (6−2)/7; the I's stem sits at grid x=2 — dead centre.
    const r = strokeText('I', { x: 10, y: 8.57 }, 1)
    expect(r.widthMm).toBeCloseTo(4 / 7, 12)
    const stem = r.segments.find((s) => s.from.x === s.to.x)
    if (stem === undefined) throw new Error('no vertical stem found')
    expect(stem.from.x).toBeCloseTo(10, 12)
    expect(Math.min(stem.from.y, stem.to.y)).toBeCloseTo(8.07, 12) // cap top = centre − h/2
    expect(Math.max(stem.from.y, stem.to.y)).toBeCloseTo(9.07, 12) // baseline = centre + h/2
  })

  test('the layout is centred: the strokes’ bounding box sits on the anchor', () => {
    const r = strokeText('R1', { x: 5, y: 5 }, 1)
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (const s of r.segments) {
      for (const p of [s.from, s.to]) {
        minY = Math.min(minY, p.y)
        maxY = Math.max(maxY, p.y)
      }
    }
    expect((minY + maxY) / 2).toBeCloseTo(5, 12)
    expect(maxY - minY).toBeCloseTo(1, 12) // full cap height used
  })

  test('scaling is linear: 2× height doubles every stroke about the anchor', () => {
    const one = strokeText('B7', { x: 0, y: 0 }, 1)
    const two = strokeText('B7', { x: 0, y: 0 }, 2)
    expect(two.widthMm).toBeCloseTo(2 * one.widthMm, 12)
    for (let i = 0; i < one.segments.length; i++) {
      const a = one.segments[i]
      const b = two.segments[i]
      if (a === undefined || b === undefined) throw new Error('segment count mismatch')
      expect(b.from.x).toBeCloseTo(2 * a.from.x, 9)
      expect(b.from.y).toBeCloseTo(2 * a.from.y, 9)
      expect(b.to.x).toBeCloseTo(2 * a.to.x, 9)
      expect(b.to.y).toBeCloseTo(2 * a.to.y, 9)
    }
  })
})

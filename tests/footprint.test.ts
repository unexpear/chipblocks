/**
 * Footprint model tests. Two jobs: pin the 0603 land pattern to its cited IPC-7351 / KiCad geometry
 * (a drift in a pad size is a real manufacturing error), and enforce the catalog-wide invariants that
 * keep the anti-placeholder rule honest for footprints — every shipped footprint is CITED and
 * physically sane (pads inside their courtyard, no zero-area copper).
 */
import { describe, expect, test } from 'vitest'
import {
  BUILTIN_FOOTPRINTS,
  FOOTPRINT_0402,
  FOOTPRINT_0603,
  FOOTPRINT_0805,
  FOOTPRINT_DIP8,
  FOOTPRINT_PINHDR_1X4,
  FOOTPRINT_SOIC8,
  FOOTPRINT_TO92,
  type Footprint,
  footprintBounds,
} from '../src/renderer/footprint.ts'

describe('0603 land pattern — matches the cited IPC-7351 / KiCad geometry', () => {
  test('two pads on 1.65 mm centres, each 0.8 × 0.95 mm', () => {
    const [p1, p2] = FOOTPRINT_0603.pads
    expect(FOOTPRINT_0603.pads).toHaveLength(2)
    expect(p1?.id).toBe('1')
    expect(p2?.id).toBe('2')
    expect(p1?.center).toEqual({ x: -0.825, y: 0 })
    expect(p2?.center).toEqual({ x: 0.825, y: 0 })
    // Centre-to-centre pitch — the load-bearing land-pattern number.
    expect((p2?.center.x ?? 0) - (p1?.center.x ?? 0)).toBeCloseTo(1.65, 6)
    for (const p of FOOTPRINT_0603.pads) {
      expect(p.size).toEqual({ w: 0.8, h: 0.95 })
      expect(p.type).toBe('smd')
    }
  })

  test('courtyard is 2.96 × 1.46 mm, centred on the origin', () => {
    expect(FOOTPRINT_0603.courtyard).toEqual({ x: -1.48, y: -0.73, w: 2.96, h: 1.46 })
  })

  test('silkscreen is ChipBlocks’ own corner ticks (8 segments), pad-free, at the courtyard corners', () => {
    // our own cornerTicksSilk rule: 2 segments at each of the 4 courtyard corners = 8
    expect(FOOTPRINT_0603.silkscreen).toHaveLength(8)
    const ends = FOOTPRINT_0603.silkscreen.flatMap((l) => [l.from, l.to])
    // every silk vertex is within the courtyard (−1.48..1.48, −0.73..0.73) and clear of the pads
    // (pads reach x±1.225, y±0.475): each tick vertex is outside that copper envelope
    for (const p of ends) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(1.48 + 1e-6)
      expect(Math.abs(p.y)).toBeLessThanOrEqual(0.73 + 1e-6)
      const insidePadEnvelope = Math.abs(p.x) < 1.225 && Math.abs(p.y) < 0.475
      expect(insidePadEnvelope).toBe(false)
    }
  })

  test('fabrication body outline is the 1.6 × 0.825 mm chip rectangle (KiCad F.Fab)', () => {
    // Four edges of the rect (-0.8, -0.4125) → (0.8, 0.4125).
    expect(FOOTPRINT_0603.fabrication).toHaveLength(4)
    const xs = FOOTPRINT_0603.fabrication.flatMap((l) => [l.from.x, l.to.x])
    const ys = FOOTPRINT_0603.fabrication.flatMap((l) => [l.from.y, l.to.y])
    expect(Math.min(...xs)).toBeCloseTo(-0.8, 6)
    expect(Math.max(...xs)).toBeCloseTo(0.8, 6)
    expect(Math.min(...ys)).toBeCloseTo(-0.4125, 6)
    expect(Math.max(...ys)).toBeCloseTo(0.4125, 6)
  })

  test('all three text anchors match KiCad: silk reference, fab value, fab designator', () => {
    expect(FOOTPRINT_0603.labels.reference).toEqual({ x: 0, y: -1.43 }) // REF** on silkscreen
    expect(FOOTPRINT_0603.labels.value).toEqual({ x: 0, y: 1.43 }) // value on fab
    expect(FOOTPRINT_0603.labels.fabReference).toEqual({ x: 0, y: 0 }) // ${REFERENCE} on fab, centred
  })
})

describe('0402 / 0805 chip land patterns — the smaller + larger passive sizes (cited KiCad geometry)', () => {
  test('0402: two 0.54 × 0.64 mm pads on 1.02 mm centres, courtyard 1.86 × 0.94 mm', () => {
    const [p1, p2] = FOOTPRINT_0402.pads
    expect(FOOTPRINT_0402.pads).toHaveLength(2)
    expect(p1?.center).toEqual({ x: -0.51, y: 0 })
    expect(p2?.center).toEqual({ x: 0.51, y: 0 })
    expect((p2?.center.x ?? 0) - (p1?.center.x ?? 0)).toBeCloseTo(1.02, 6) // pitch
    for (const p of FOOTPRINT_0402.pads) {
      expect(p.size).toEqual({ w: 0.54, h: 0.64 })
      expect(p.type).toBe('smd')
    }
    expect(FOOTPRINT_0402.courtyard).toEqual({ x: -0.93, y: -0.47, w: 1.86, h: 0.94 })
  })

  test('0805: two 1.025 × 1.4 mm pads on 1.825 mm centres, courtyard 3.36 × 1.9 mm', () => {
    const [p1, p2] = FOOTPRINT_0805.pads
    expect(FOOTPRINT_0805.pads).toHaveLength(2)
    expect(p1?.center).toEqual({ x: -0.9125, y: 0 })
    expect(p2?.center).toEqual({ x: 0.9125, y: 0 })
    expect((p2?.center.x ?? 0) - (p1?.center.x ?? 0)).toBeCloseTo(1.825, 6) // pitch
    for (const p of FOOTPRINT_0805.pads) {
      expect(p.size).toEqual({ w: 1.025, h: 1.4 })
      expect(p.type).toBe('smd')
    }
    expect(FOOTPRINT_0805.courtyard).toEqual({ x: -1.68, y: -0.95, w: 3.36, h: 1.9 })
  })

  test('the three chip sizes are ordered 0402 < 0603 < 0805 by pad + courtyard', () => {
    const area = (f: Footprint) => f.courtyard.w * f.courtyard.h
    expect(area(FOOTPRINT_0402)).toBeLessThan(area(FOOTPRINT_0603))
    expect(area(FOOTPRINT_0603)).toBeLessThan(area(FOOTPRINT_0805))
    // the pad grows with the package too
    const padArea = (f: Footprint) => (f.pads[0]?.size.w ?? 0) * (f.pads[0]?.size.h ?? 0)
    expect(padArea(FOOTPRINT_0402)).toBeLessThan(padArea(FOOTPRINT_0603))
    expect(padArea(FOOTPRINT_0603)).toBeLessThan(padArea(FOOTPRINT_0805))
  })
})

describe('footprintBounds', () => {
  test('the 0603 bounds span the courtyard in x and the text anchors in y', () => {
    const b = footprintBounds(FOOTPRINT_0603)
    // x: the courtyard (±1.48) is widest. y: the reference/value text (±1.43) sits outside it.
    expect(b.minX).toBeCloseTo(-1.48, 6)
    expect(b.maxX).toBeCloseTo(1.48, 6)
    expect(b.minY).toBeCloseTo(-1.43, 6)
    expect(b.maxY).toBeCloseTo(1.43, 6)
  })

  test('bounds always contain every pad, even if a courtyard were undersized', () => {
    // A deliberately-too-small courtyard must not clip a pad out of the render bounds.
    const bad: Footprint = { ...FOOTPRINT_0603, courtyard: { x: -0.1, y: -0.1, w: 0.2, h: 0.2 } }
    const b = footprintBounds(bad)
    for (const p of bad.pads) {
      expect(b.minX).toBeLessThanOrEqual(p.center.x - p.size.w / 2 + 1e-9)
      expect(b.maxX).toBeGreaterThanOrEqual(p.center.x + p.size.w / 2 - 1e-9)
    }
  })
})

describe('starter set — the multi-pad + through-hole footprints (SOIC-8, DIP-8, pin header)', () => {
  test('SOIC-8: 8 SMD pads, 1.27 mm pitch, two rows at x = ±2.475 mm', () => {
    const p = FOOTPRINT_SOIC8.pads
    expect(p).toHaveLength(8)
    expect(p.every((pad) => pad.type === 'smd')).toBe(true)
    expect((p[1]?.center.y ?? 0) - (p[0]?.center.y ?? 0)).toBeCloseTo(1.27, 6) // pitch
    expect(p[0]?.center.x).toBeCloseTo(-2.475, 6)
    expect(p[4]?.center.x).toBeCloseTo(2.475, 6)
  })

  test('DIP-8: 8 through-hole pads, 0.8 mm drills, pin 1 squared, origin at pin 1', () => {
    const p = FOOTPRINT_DIP8.pads
    expect(p).toHaveLength(8)
    expect(p.every((pad) => pad.type === 'through_hole' && pad.holeDiameter === 0.8)).toBe(true)
    expect(p[0]?.shape).toBe('roundrect') // pin 1 squared for orientation
    expect(p.slice(1).every((pad) => pad.shape === 'circle')).toBe(true)
    expect(p[0]?.center).toEqual({ x: 0, y: 0 }) // origin at pin 1, not the part centre
    expect((p[1]?.center.y ?? 0) - (p[0]?.center.y ?? 0)).toBeCloseTo(2.54, 6) // 0.1" pitch
    expect((p[4]?.center.x ?? 0) - (p[0]?.center.x ?? 0)).toBeCloseTo(7.62, 6) // 0.3" rows
  })

  test('pin header 1×4: 4 through-hole pads, 1.0 mm drills, pin 1 rect', () => {
    const p = FOOTPRINT_PINHDR_1X4.pads
    expect(p).toHaveLength(4)
    expect(p.every((pad) => pad.type === 'through_hole' && pad.holeDiameter === 1)).toBe(true)
    expect(p[0]?.shape).toBe('rect') // pin 1 square
    expect(p[3]?.center.y).toBeCloseTo(7.62, 6) // 3 × 2.54 mm
  })

  test('TO-92: 3 through-hole pads, 0.75 mm drills, pin 1 square at the origin, pin 2 staggered back', () => {
    const p = FOOTPRINT_TO92.pads
    expect(p).toHaveLength(3)
    expect(p.every((pad) => pad.type === 'through_hole' && pad.holeDiameter === 0.75)).toBe(true)
    expect(p[0]?.shape).toBe('rect') // pin 1 square for orientation
    expect(p.slice(1).every((pad) => pad.shape === 'circle')).toBe(true)
    expect(p[0]?.center).toEqual({ x: 0, y: 0 }) // origin at pin 1 (KiCad THT convention)
    expect(p[1]?.center).toEqual({ x: 1.27, y: -1.27 }) // middle pin staggered back — the TO-92 triangle
    expect(p[2]?.center).toEqual({ x: 2.54, y: 0 })
  })

  test('TO-92 body is the real half-round "D" outline — a closed polygon bulging off the flat face', () => {
    const fab = FOOTPRINT_TO92.fabrication
    expect(fab.length).toBeGreaterThanOrEqual(6) // an arc polygon + the flat, not a plain rectangle
    // it is a CLOSED loop: each segment's end is the next segment's start (wrapping around)
    for (let i = 0; i < fab.length; i++) {
      const cur = fab[i]
      const next = fab[(i + 1) % fab.length]
      expect(cur?.to.x).toBeCloseTo(next?.from.x ?? Number.NaN, 6)
      expect(cur?.to.y).toBeCloseTo(next?.from.y ?? Number.NaN, 6)
    }
    const ys = fab.flatMap((l) => [l.from.y, l.to.y])
    const xs = fab.flatMap((l) => [l.from.x, l.to.x])
    expect(Math.max(...ys)).toBeCloseTo(1.75, 2) // the flat face (y = flatY)
    expect(Math.min(...ys)).toBeCloseTo(-2.48, 2) // the rounded bulge (radius about the body centre)
    // the round can bulges to the circle's left/right extremes (centre 1.27 ± r 2.48), past the chord
    expect(Math.min(...xs)).toBeCloseTo(-1.21, 2)
    expect(Math.max(...xs)).toBeCloseTo(3.75, 2)
  })
})

describe('every built-in footprint is cited + physically valid (the anti-placeholder rule)', () => {
  const entries = Object.entries(BUILTIN_FOOTPRINTS)

  test('the registry is keyed by each footprint id', () => {
    for (const [key, fp] of entries) expect(fp.id).toBe(key)
  })

  for (const [key, fp] of entries) {
    test(`${key}: cited, non-empty, pads inside the courtyard, real copper`, () => {
      // Cited (a real source, high/medium/low — never unknown for a shipped value).
      expect(fp.provenance.title.length).toBeGreaterThan(0)
      expect(fp.provenance.citation.length).toBeGreaterThan(0)
      expect(['high', 'medium', 'low']).toContain(fp.provenance.confidence)
      // At least one pad + a component body outline (F.Fab), and every pad is real copper.
      expect(fp.pads.length).toBeGreaterThan(0)
      expect(fp.fabrication.length).toBeGreaterThan(0)
      const cy = fp.courtyard
      for (const p of fp.pads) {
        expect(p.size.w).toBeGreaterThan(0)
        expect(p.size.h).toBeGreaterThan(0)
        if (p.type === 'through_hole') {
          expect(p.holeDiameter ?? 0).toBeGreaterThan(0)
          expect(p.holeDiameter ?? 0).toBeLessThan(Math.min(p.size.w, p.size.h))
        }
        // The courtyard must enclose every pad — that is what a courtyard IS.
        expect(p.center.x - p.size.w / 2).toBeGreaterThanOrEqual(cy.x - 1e-9)
        expect(p.center.x + p.size.w / 2).toBeLessThanOrEqual(cy.x + cy.w + 1e-9)
        expect(p.center.y - p.size.h / 2).toBeGreaterThanOrEqual(cy.y - 1e-9)
        expect(p.center.y + p.size.h / 2).toBeLessThanOrEqual(cy.y + cy.h + 1e-9)
      }
    })
  }
})

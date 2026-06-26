/**
 * Orthogonal wire router — the geometry-aware auto-router engine. Proves it emits only straight
 * horizontal/vertical segments (never a diagonal), routes AROUND part boxes instead of through them,
 * keeps aligned pins as a single straight run, spaces shared channels by lane, and measures the routed
 * Manhattan length the wire-resistance math will use.
 */

import { describe, expect, test } from 'vitest'
import {
  type Box,
  gridRouteAround,
  orthogonalRoute,
  type Pt,
  pathLength,
  routesOverlap,
  segmentHitsBox,
  simplifyPath,
} from '../src/renderer/orthogonal-route.ts'

const allOrthogonal = (pts: Pt[]) =>
  pts.slice(1).every((p, i) => p.x === (pts[i] as Pt).x || p.y === (pts[i] as Pt).y)

const hitsAny = (pts: Pt[], boxes: Box[]) => {
  for (let i = 0; i < pts.length - 1; i++) {
    for (const b of boxes) if (segmentHitsBox(pts[i] as Pt, pts[i + 1] as Pt, b)) return true
  }
  return false
}

describe('orthogonal router — straight H/V only, routes around parts', () => {
  test('aligned pins route as one straight horizontal run', () => {
    const wp = orthogonalRoute({ x: 0, y: 0 }, 'right', { x: 100, y: 0 }, 'left', [])
    const full = [{ x: 0, y: 0 }, ...wp, { x: 100, y: 0 }]
    expect(allOrthogonal(full)).toBe(true)
    expect(full.every((p) => p.y === 0)).toBe(true)
  })

  test('offset pins route as an orthogonal path — no diagonal segment', () => {
    const wp = orthogonalRoute({ x: 0, y: 0 }, 'right', { x: 100, y: 60 }, 'left', [])
    const full = [{ x: 0, y: 0 }, ...wp, { x: 100, y: 60 }]
    expect(allOrthogonal(full)).toBe(true)
  })

  test('routes AROUND a box straddling the direct path, never through it', () => {
    const box: Box = { x: 40, y: -20, w: 20, h: 40 }
    const wp = orthogonalRoute({ x: 0, y: 0 }, 'right', { x: 100, y: 0 }, 'left', [box])
    const full = [{ x: 0, y: 0 }, ...wp, { x: 100, y: 0 }]
    expect(allOrthogonal(full)).toBe(true)
    expect(hitsAny(full, [box])).toBe(false)
  })

  test('lane offsets shift wires sharing a detour apart', () => {
    const box: Box = { x: 40, y: -20, w: 20, h: 40 }
    const lane0 = orthogonalRoute({ x: 0, y: 0 }, 'right', { x: 100, y: 0 }, 'left', [box], {
      lane: 0,
    })
    const lane4 = orthogonalRoute({ x: 0, y: 0 }, 'right', { x: 100, y: 0 }, 'left', [box], {
      lane: 4,
    })
    expect(JSON.stringify(lane0)).not.toBe(JSON.stringify(lane4))
  })

  test('vertical-leave pins route around via a left/right detour', () => {
    const box: Box = { x: -10, y: 40, w: 20, h: 20 }
    const wp = orthogonalRoute({ x: 0, y: 0 }, 'down', { x: 0, y: 100 }, 'up', [box])
    const full = [{ x: 0, y: 0 }, ...wp, { x: 0, y: 100 }]
    expect(allOrthogonal(full)).toBe(true)
    expect(hitsAny(full, [box])).toBe(false)
  })
})

describe('orthogonal router — GUARANTEED part-free routing (A* fallback)', () => {
  test('gridRouteAround weaves around a box sitting between the endpoints', () => {
    const box: Box = { x: 40, y: -20, w: 20, h: 40 }
    const path = gridRouteAround({ x: 0, y: 0 }, { x: 100, y: 0 }, [box])
    expect(path).not.toBeNull()
    const p = path as Pt[]
    expect(p[0]).toEqual({ x: 0, y: 0 })
    expect(p[p.length - 1]).toEqual({ x: 100, y: 0 })
    expect(allOrthogonal(p)).toBe(true)
    expect(hitsAny(p, [box])).toBe(false)
  })

  test('gridRouteAround threads past two boxes in a row, never through either', () => {
    const boxes: Box[] = [
      { x: 40, y: -20, w: 20, h: 40 },
      { x: 120, y: -20, w: 20, h: 40 },
    ]
    const path = gridRouteAround({ x: 0, y: 0 }, { x: 200, y: 0 }, boxes)
    expect(path).not.toBeNull()
    const p = path as Pt[]
    expect(p[0]).toEqual({ x: 0, y: 0 })
    expect(p[p.length - 1]).toEqual({ x: 200, y: 0 })
    expect(allOrthogonal(p)).toBe(true)
    expect(hitsAny(p, boxes)).toBe(false)
  })

  test('orthogonalRoute stays part-free even when the cheap shapes are all blocked', () => {
    // A staggered wall of parts blocking the straight run + its easy detours: only a winding route gets
    // through, and the router must still NEVER cut through a part.
    const boxes: Box[] = [
      { x: 40, y: -60, w: 20, h: 50 },
      { x: 40, y: 12, w: 20, h: 50 },
      { x: 80, y: -10, w: 20, h: 80 },
    ]
    const wp = orthogonalRoute({ x: 0, y: 0 }, 'right', { x: 160, y: 0 }, 'left', boxes)
    const full = [{ x: 0, y: 0 }, ...wp, { x: 160, y: 0 }]
    expect(allOrthogonal(full)).toBe(true)
    expect(hitsAny(full, boxes)).toBe(false)
  })
})

describe('orthogonal router — never cuts through its own endpoint parts', () => {
  // The wrap-around / feedback case (an SRAM cell's cross-couple leg): the wire leaves the RIGHT part
  // going right and has to reach the LEFT part's left side, so the cheap straight "L" would run back
  // through BOTH parts. Passing them as `selfBoxes` makes the body detour around them.
  const src: Box = { x: 100, y: 0, w: 40, h: 40 }
  const tgt: Box = { x: 0, y: 0, w: 40, h: 40 }
  const from: Pt = { x: 140, y: 20 } // right edge of src
  const to: Pt = { x: 0, y: 20 } // left edge of tgt

  test('with selfBoxes the body routes AROUND both endpoint parts', () => {
    const wp = orthogonalRoute(from, 'right', to, 'left', [], { selfBoxes: [src, tgt] })
    const full = [from, ...wp, to]
    expect(allOrthogonal(full)).toBe(true)
    expect(hitsAny(full, [src, tgt])).toBe(false)
  })

  test('without selfBoxes the body is free to cut back through them (why selfBoxes is needed)', () => {
    const wp = orthogonalRoute(from, 'right', to, 'left', [])
    const full = [from, ...wp, to]
    expect(hitsAny(full, [src, tgt])).toBe(true)
  })
})

describe('orthogonal router — wires take real space (no overlap)', () => {
  test('two wires sharing the same horizontal track overlap', () => {
    const a: Pt[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]
    const b: Pt[] = [
      { x: 20, y: 0 },
      { x: 120, y: 0 },
    ]
    expect(routesOverlap(a, b)).toBe(true)
  })

  test('parallel wires on separate tracks do NOT overlap', () => {
    const a: Pt[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]
    const b: Pt[] = [
      { x: 0, y: 20 },
      { x: 100, y: 20 },
    ]
    expect(routesOverlap(a, b)).toBe(false)
  })

  test('wires that merely CROSS (perpendicular) are not an overlap — that is a junction', () => {
    const a: Pt[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]
    const b: Pt[] = [
      { x: 50, y: -50 },
      { x: 50, y: 50 },
    ]
    expect(routesOverlap(a, b)).toBe(false)
  })
})

describe('orthogonal router — primitives', () => {
  test('segmentHitsBox: interior crossing true, flush-along-edge false', () => {
    const box: Box = { x: 0, y: 0, w: 10, h: 10 }
    expect(segmentHitsBox({ x: -5, y: 5 }, { x: 15, y: 5 }, box)).toBe(true)
    expect(segmentHitsBox({ x: -5, y: 0 }, { x: 15, y: 0 }, box)).toBe(false)
  })

  test('pathLength is the Manhattan length; simplifyPath collapses collinear points', () => {
    expect(
      pathLength([
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 40 },
      ]),
    ).toBe(70)
    expect(
      simplifyPath([
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ])
  })
})

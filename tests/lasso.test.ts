/**
 * Lasso tests (S19-v3-69) — the freeform-selection geometry: ray-cast
 * point-in-polygon (including concave shapes, the whole point of a lasso)
 * and center-in-polygon node picking.
 */

import { describe, expect, test } from 'vitest'
import {
  edgeIdsTouchingRegion,
  type LassoPoint,
  lassoPathD,
  nodeIdsInLasso,
  pointInPolygon,
} from '../src/renderer/lasso.ts'
import { samplePathPoints } from '../src/renderer/wire-path.ts'

const square = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
]

// A "C" shape: concave — the bay on the right is OUTSIDE the polygon.
const cShape = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 20 },
  { x: 30, y: 20 },
  { x: 30, y: 80 },
  { x: 100, y: 80 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
]

describe('pointInPolygon', () => {
  test('inside / outside a square', () => {
    expect(pointInPolygon({ x: 50, y: 50 }, square)).toBe(true)
    expect(pointInPolygon({ x: 150, y: 50 }, square)).toBe(false)
    expect(pointInPolygon({ x: -1, y: 50 }, square)).toBe(false)
  })

  test('a concave bay is OUTSIDE — concave shapes work (the point of a lasso)', () => {
    expect(pointInPolygon({ x: 65, y: 50 }, cShape)).toBe(false) // in the bay
    expect(pointInPolygon({ x: 15, y: 50 }, cShape)).toBe(true) // in the spine
    expect(pointInPolygon({ x: 65, y: 10 }, cShape)).toBe(true) // in the top arm
  })

  test('fewer than 3 points can never contain anything', () => {
    expect(pointInPolygon({ x: 0, y: 0 }, [])).toBe(false)
    expect(
      pointInPolygon({ x: 5, y: 5 }, [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ]),
    ).toBe(false)
  })
})

describe('nodeIdsInLasso', () => {
  const node = (id: string, x: number, y: number, measured?: { width: number; height: number }) =>
    measured === undefined ? { id, position: { x, y } } : { id, position: { x, y }, measured }

  test('selects by node CENTER, with measured sizes when present', () => {
    const picked = nodeIdsInLasso(
      [
        node('in', 10, 10, { width: 40, height: 40 }), // center (30, 30) — inside
        node('out', 90, 90, { width: 40, height: 40 }), // center (110, 110) — outside
        node('edgeClipped', 80, 80, { width: 60, height: 60 }), // center (110, 110) — outside
      ],
      square,
    )
    expect(picked).toEqual(['in'])
  })

  test('an unmeasured node uses the fallback footprint for its center', () => {
    // position (60, 70) + fallback 90×40 → center (105, 90): outside.
    // position (40, 60) → center (85, 80): inside.
    const picked = nodeIdsInLasso([node('a', 60, 70), node('b', 40, 60)], square)
    expect(picked).toEqual(['b'])
  })

  test('a degenerate lasso (under 3 points) selects nothing', () => {
    expect(nodeIdsInLasso([node('a', 10, 10)], [{ x: 0, y: 0 }])).toEqual([])
  })
})

describe('lassoPathD', () => {
  test('builds a closed SVG path from the drawn points', () => {
    expect(
      lassoPathD([
        { x: 1, y: 2 },
        { x: 3, y: 4 },
        { x: 5, y: 6 },
      ]),
    ).toBe('M 1 2 L 3 4 L 5 6 Z')
    expect(lassoPathD([])).toBe('')
  })
})

describe('edgeIdsTouchingRegion — wires select by TOUCH (S19-v3-70)', () => {
  // Two parts far outside the square, wired straight through it: the wire's
  // middle crosses the region even though neither endpoint is near it.
  const centers = new Map<string, LassoPoint>([
    ['a', { x: -200, y: 50 }],
    ['b', { x: 300, y: 50 }],
    ['c', { x: -200, y: 500 }],
    ['d', { x: 300, y: 500 }],
  ])
  const centerOf = (id: string) => centers.get(id)
  const inSquare = (p: LassoPoint) => pointInPolygon(p, square)
  const wire = (id: string, source: string, target: string, data?: Record<string, unknown>) => ({
    id,
    source,
    target,
    ...(data ? { data } : {}),
  })

  test('a wire crossing the region is picked WITHOUT its parts; one far away is not', () => {
    const picked = edgeIdsTouchingRegion(
      [wire('through', 'a', 'b'), wire('far', 'c', 'd')],
      centerOf,
      inSquare,
      samplePathPoints,
    )
    expect(picked).toEqual(['through'])
    // …and the endpoint parts themselves are NOT in the region.
    expect(
      nodeIdsInLasso(
        [...centers.entries()].map(([id, p]) => ({ id, position: { x: p.x - 45, y: p.y - 20 } })),
        square,
      ),
    ).toEqual([])
  })

  test('hand-routed corners are honored — the route detours INTO the region', () => {
    // c→d runs along y=500, far below the square, but a corner lifts the
    // route through it.
    const picked = edgeIdsTouchingRegion(
      [wire('detour', 'c', 'd', { waypoints: [{ id: 'w1', x: 50, y: 50 }] })],
      centerOf,
      inSquare,
      samplePathPoints,
    )
    expect(picked).toEqual(['detour'])
  })

  test('a curved wire is tested where it ACTUALLY runs — the cut corner, not the sharp tip', () => {
    // Route c → corner at (50,50) → d with a Wide sweep: the fillet cuts the
    // corner, so the drawn wire never reaches the tip. A tiny region hugging
    // the sharp tip must NOT pick the curved wire — but picks the sharp one.
    const tipRegion = (p: LassoPoint) => p.x >= 40 && p.x <= 60 && p.y >= 40 && p.y <= 60
    const sharp = edgeIdsTouchingRegion(
      [wire('sharp', 'c', 'd', { waypoints: [{ id: 'w1', x: 50, y: 50 }] })],
      centerOf,
      (p) => tipRegion(p),
      samplePathPoints,
    )
    const curved = edgeIdsTouchingRegion(
      [
        wire('curvy', 'c', 'd', {
          waypoints: [{ id: 'w1', x: 50, y: 50 }],
          curved: true,
          curveRadius: 56,
        }),
      ],
      centerOf,
      (p) => tipRegion(p),
      samplePathPoints,
    )
    expect(sharp).toEqual(['sharp'])
    expect(curved).toEqual([])
  })
})

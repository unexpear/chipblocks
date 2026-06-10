/**
 * Lasso tests (S19-v3-69) — the freeform-selection geometry: ray-cast
 * point-in-polygon (including concave shapes, the whole point of a lasso)
 * and center-in-polygon node picking.
 */

import { describe, expect, test } from 'vitest'
import { lassoPathD, nodeIdsInLasso, pointInPolygon } from '../src/renderer/lasso.ts'

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

/**
 * Routed length → wire resistance (Part 3 of the geometry-aware wiring) — the geometry-honesty
 * guarantee: the length the orthogonal AUTO-ROUTER measures is EXACTLY the length the canvas physics
 * turns into resistance (R = ρ·L/A, the same drawnWire → polylineLength → lengthFromDrawn → wireResistance
 * path the main canvas already uses). So a wire routed the long way AROUND a part is a genuinely longer
 * wire and carries more resistance — the picture and the number can never disagree.
 */

import { describe, expect, test } from 'vitest'
import { type Box, orthogonalRoute, pathLength } from '../src/renderer/orthogonal-route.ts'
import { lengthFromDrawn, wireResistance } from '../src/renderer/wire-length.ts'
import { polylineLength } from '../src/renderer/wire-path.ts'

const from = { x: 0, y: 0 }
const to = { x: 200, y: 0 }
const obstacle: Box = { x: 80, y: -25, w: 40, h: 50 } // straddles the straight line

describe('routed length feeds the wire resistance', () => {
  test("the auto-router's length is exactly the length the canvas measures (Manhattan = polyline)", () => {
    const path = [from, ...orthogonalRoute(from, 'right', to, 'left', [obstacle]), to]
    // the engine measures Manhattan, the canvas measures the polyline — identical for an orthogonal
    // path, so whatever the router draws is precisely what the physics turns into resistance.
    expect(pathLength(path)).toBeCloseTo(polylineLength(path), 6)
  })

  test('a wire routed AROUND a part is longer, so it carries more resistance than the straight wire', () => {
    const path = [from, ...orthogonalRoute(from, 'right', to, 'left', [obstacle]), to]
    const straightPx = Math.hypot(to.x - from.x, to.y - from.y)
    const routedPx = polylineLength(path)
    expect(routedPx).toBeGreaterThan(straightPx) // the detour adds real length
    // R = ρ·L/A on the SAME real-length scale + gauge the canvas uses: the longer routed wire wins.
    const straightOhms = wireResistance(lengthFromDrawn(straightPx))
    const routedOhms = wireResistance(lengthFromDrawn(routedPx))
    expect(routedOhms).toBeGreaterThan(straightOhms)
  })
})

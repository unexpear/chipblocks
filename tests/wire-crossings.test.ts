/**
 * Wire crossings on AUTO-ROUTED geometry — the junction feature working WITH the auto-wiring.
 * The crossing detector reads each wire's drawn path; with the auto-router on (always in the descend
 * view, opt-in on the canvas) that path is the orthogonal route. These feed the router's REAL H/V
 * output into findWireCrossings and pin down: (1) two routed wires that pass over each other get one
 * open-dot "crossing, NOT connected" marker, at the intersection; (2) two wires meeting at a shared
 * node read as a real connection and are skipped (the filled-dot case), even when their paths touch;
 * (3) parallel routed wires never cross. The classic open-dot / filled-dot schematic rule, on the
 * geometry the auto-router actually draws.
 */

import { describe, expect, test } from 'vitest'
import { type Dir, orthogonalRoute, type Pt } from '../src/renderer/orthogonal-route.ts'
import { findWireCrossings, type WireMeta } from '../src/renderer/wire-crossings.tsx'

/** The full drawn path a NetEdge reports: source + the router's interior waypoints + target. */
const routed = (from: Pt, fromDir: Dir, to: Pt, toDir: Dir): Pt[] => [
  from,
  ...orthogonalRoute(from, fromDir, to, toDir, []),
  to,
]

describe('wire crossings on auto-routed paths — the junction thing + the auto-wiring', () => {
  test('a horizontal and a vertical routed wire that cross get one open-dot crossing, at the intersection', () => {
    const geoms = new Map<string, Pt[]>([
      ['h', routed({ x: 0, y: 0 }, 'right', { x: 100, y: 0 }, 'left')],
      ['v', routed({ x: 37, y: -40 }, 'down', { x: 37, y: 60 }, 'up')],
    ])
    const edges: WireMeta[] = [
      { id: 'h', source: 'p1', target: 'p2' },
      { id: 'v', source: 'p3', target: 'p4' },
    ]
    const crossings = findWireCrossings(geoms, edges)
    expect(crossings).toHaveLength(1)
    expect(crossings[0]?.x).toBeCloseTo(37)
    expect(crossings[0]?.y).toBeCloseTo(0)
  })

  test('two wires that share a node are a connection, not a crossing — skipped even when the paths meet', () => {
    // Identical geometry to the case above (they still meet at 37,0), but both leave the same node.
    const geoms = new Map<string, Pt[]>([
      ['h', routed({ x: 0, y: 0 }, 'right', { x: 100, y: 0 }, 'left')],
      ['v', routed({ x: 37, y: -40 }, 'down', { x: 37, y: 60 }, 'up')],
    ])
    const edges: WireMeta[] = [
      { id: 'h', source: 'bus', target: 'p2' },
      { id: 'v', source: 'bus', target: 'p4' },
    ]
    expect(findWireCrossings(geoms, edges)).toHaveLength(0)
  })

  test('parallel routed wires on different rows never cross', () => {
    const geoms = new Map<string, Pt[]>([
      ['a', routed({ x: 0, y: 0 }, 'right', { x: 100, y: 0 }, 'left')],
      ['b', routed({ x: 0, y: 40 }, 'right', { x: 100, y: 40 }, 'left')],
    ])
    const edges: WireMeta[] = [
      { id: 'a', source: 'p1', target: 'p2' },
      { id: 'b', source: 'p3', target: 'p4' },
    ]
    expect(findWireCrossings(geoms, edges)).toHaveLength(0)
  })
})

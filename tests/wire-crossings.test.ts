/**
 * Wire crossings on AUTO-ROUTED geometry — the junction feature working WITH the auto-wiring.
 * The crossing detector reads each wire's drawn path; with the auto-router on (always in the descend
 * view, opt-in on the canvas) that path is the orthogonal route. These feed the router's REAL H/V
 * output into findWireCrossings and pin down: (1) two routed wires that pass over each other get one
 * open-dot "crossing, NOT connected" marker, at the intersection; (2) two wires on the SAME NET (sharing
 * a pin, transitively) read as a connection and are skipped — but two wires on DIFFERENT pins of the same
 * part are different nets and DO cross; (3) parallel routed wires never cross; (4) a T-junction (one wire
 * ending on another's run) counts. The classic open-dot / filled-dot schematic rule, net-aware.
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

  test('the HORIZONTAL wire is the one that hops over (over = the horizontal edge)', () => {
    const geoms = new Map<string, Pt[]>([
      ['h', routed({ x: 0, y: 0 }, 'right', { x: 100, y: 0 }, 'left')],
      ['v', routed({ x: 37, y: -40 }, 'down', { x: 37, y: 60 }, 'up')],
    ])
    const edges: WireMeta[] = [
      { id: 'h', source: 'p1', target: 'p2' },
      { id: 'v', source: 'p3', target: 'p4' },
    ]
    expect(findWireCrossings(geoms, edges)[0]?.over).toBe('h')
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

  test('two wires on DIFFERENT pins of the same part DO cross (different nets — the old skip-the-node bug)', () => {
    // Both touch part "u1", but on different terminals (out vs in) — that is TWO nets, so where their
    // routes cross is a real crossing. The old "share a node → skip" rule wrongly dropped these.
    const geoms = new Map<string, Pt[]>([
      ['h', routed({ x: 0, y: 0 }, 'right', { x: 100, y: 0 }, 'left')],
      ['v', routed({ x: 37, y: -40 }, 'down', { x: 37, y: 60 }, 'up')],
    ])
    const edges: WireMeta[] = [
      { id: 'h', source: 'u1', sourceHandle: 'out', target: 'p2', targetHandle: 'a' },
      { id: 'v', source: 'u1', sourceHandle: 'in', target: 'p4', targetHandle: 'a' },
    ]
    expect(findWireCrossings(geoms, edges)).toHaveLength(1)
  })

  test('a T-junction — one wire ENDING on another wire’s run — now counts as a crossing', () => {
    const geoms = new Map<string, Pt[]>([
      [
        'h',
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
      ],
      [
        'v',
        [
          { x: 50, y: -40 },
          { x: 50, y: 0 }, // ENDS exactly on h's run
        ],
      ],
    ])
    const edges: WireMeta[] = [
      { id: 'h', source: 'p1', target: 'p2' },
      { id: 'v', source: 'p3', target: 'p4' },
    ]
    const crossings = findWireCrossings(geoms, edges)
    expect(crossings).toHaveLength(1)
    expect(crossings[0]?.x).toBeCloseTo(50)
    expect(crossings[0]?.y).toBeCloseTo(0)
  })

  test('same-net wires never cross-dot, even without a directly shared pin (transitive union-find)', () => {
    // a: x.o→m.i, b: m.i→p2, c: x.o→p4. a shares m.i with b and x.o with c, so a,b,c are ONE net.
    // b and c cross geometrically but share no pin directly — being the same net, they get no dot.
    const geoms = new Map<string, Pt[]>([
      [
        'a',
        [
          { x: 0, y: -100 },
          { x: 0, y: -90 },
        ],
      ],
      [
        'b',
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
      ],
      [
        'c',
        [
          { x: 37, y: -40 },
          { x: 37, y: 60 },
        ],
      ],
    ])
    const edges: WireMeta[] = [
      { id: 'a', source: 'x', sourceHandle: 'o', target: 'm', targetHandle: 'i' },
      { id: 'b', source: 'm', sourceHandle: 'i', target: 'p2', targetHandle: 'a' },
      { id: 'c', source: 'x', sourceHandle: 'o', target: 'p4', targetHandle: 'a' },
    ]
    expect(findWireCrossings(geoms, edges)).toHaveLength(0)
  })

  test('a wire that crosses another TWICE gets a dot at BOTH crossings (not just the first)', () => {
    // "d" detours up, across, and back down — crossing the horizontal rail "r" on the way up AND down.
    const geoms = new Map<string, Pt[]>([
      [
        'r',
        [
          { x: 0, y: 0 },
          { x: 200, y: 0 },
        ],
      ],
      [
        'd',
        [
          { x: 50, y: 20 },
          { x: 50, y: -20 },
          { x: 150, y: -20 },
          { x: 150, y: 20 },
        ],
      ],
    ])
    const edges: WireMeta[] = [
      { id: 'r', source: 'p1', target: 'p2' },
      { id: 'd', source: 'p3', target: 'p4' },
    ]
    const crossings = findWireCrossings(geoms, edges)
    expect(crossings).toHaveLength(2)
    expect(crossings.map((c) => Math.round(c.x)).sort((a, b) => a - b)).toEqual([50, 150])
  })
})

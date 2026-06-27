/**
 * Wire crossings on AUTO-ROUTED geometry — the junction feature working WITH the auto-wiring.
 * The crossing detector reads each wire's drawn path; with the auto-router on (always in the descend
 * view, opt-in on the canvas) that path is the orthogonal route. These feed the router's REAL H/V
 * output into findWireCrossings and pin down the classic schematic dot rule, net-aware:
 *   - two wires on DIFFERENT nets that meet → an OPEN (hollow) dot: "they cross, NOT connected";
 *   - a wire of the SAME net ENDING on another's run (a real T-tap) → a FILLED dot: "connected, one net";
 *   - same-net wires that merely pass over each other (neither ends there) → NO dot (already one net);
 *   - two wires sharing a pin → NO dot (the pin/handle shows that connection);
 *   - parallel routed wires never meet at all.
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
  test('a horizontal + a vertical routed wire on different nets get one OPEN crossing dot, at the intersection', () => {
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
    expect(crossings[0]?.connected).toBe(false) // different nets → open dot
  })

  test('two wires that share a pin get NO dot — the pin/handle already shows that connection', () => {
    const geoms = new Map<string, Pt[]>([
      ['h', routed({ x: 0, y: 0 }, 'right', { x: 100, y: 0 }, 'left')],
      ['v', routed({ x: 37, y: -40 }, 'down', { x: 37, y: 60 }, 'up')],
    ])
    const edges: WireMeta[] = [
      { id: 'h', source: 'bus', target: 'p2' },
      { id: 'v', source: 'bus', target: 'p4' },
    ]
    // Same net (shared 'bus'), and the meeting at 37,0 is mid-run for BOTH (neither ends there) — they
    // are already one net, so no NEW junction dot.
    expect(findWireCrossings(geoms, edges)).toHaveLength(0)
  })

  test('a SAME-net T-tap — one wire ENDS on another wire of the same net — gets a FILLED connected dot', () => {
    const geoms = new Map<string, Pt[]>([
      [
        'trunk',
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
      ],
      [
        'tap',
        [
          { x: 50, y: -40 },
          { x: 50, y: 0 }, // ENDS exactly on trunk's run
        ],
      ],
    ])
    // Same net: both touch node 's' (trunk's source, tap's source) → one net, and tap ENDS on trunk.
    const edges: WireMeta[] = [
      { id: 'trunk', source: 's', sourceHandle: 'o', target: 'p2', targetHandle: 'a' },
      { id: 'tap', source: 's', sourceHandle: 'o', target: 'p4', targetHandle: 'a' },
    ]
    const crossings = findWireCrossings(geoms, edges)
    expect(crossings).toHaveLength(1)
    expect(crossings[0]?.x).toBeCloseTo(50)
    expect(crossings[0]?.y).toBeCloseTo(0)
    expect(crossings[0]?.connected).toBe(true) // a real tap on the same net → filled dot
  })

  test('parallel routed wires on different rows never meet', () => {
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

  test('two wires on DIFFERENT pins of the same part DO cross (different nets → open dot)', () => {
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
    const crossings = findWireCrossings(geoms, edges)
    expect(crossings).toHaveLength(1)
    expect(crossings[0]?.connected).toBe(false)
  })

  test('a DIFFERENT-net T-junction — one wire ending on a foreign wire’s run — is an OPEN crossing dot', () => {
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
          { x: 50, y: 0 }, // ENDS exactly on h's run, but a different net
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
    expect(crossings[0]?.connected).toBe(false) // foreign net → open dot, even at a T
  })

  test('same-net wires that merely cross (neither ends there) get NO dot, even via transitive union-find', () => {
    // a: x.o→m.i, b: m.i→p2, c: x.o→p4. a shares m.i with b and x.o with c, so a,b,c are ONE net.
    // b and c cross geometrically but neither ENDS at the crossing — already one net, so no dot.
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

  test('a wire that crosses a foreign wire TWICE gets an open dot at BOTH crossings (not just the first)', () => {
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
    expect(crossings.every((c) => !c.connected)).toBe(true)
  })
})

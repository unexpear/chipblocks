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
import {
  findWireCrossings,
  markableWireCrossings,
  type WireMeta,
} from '../src/renderer/wire-crossings.tsx'

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

  /**
   * The bound. A canvas cannot draw an unbounded number of crossing marks — a design read back off a real
   * chip file produced 290,091 of them — so the caller may say how many it can take, and the scan stops
   * there. What matters is that it stops at exactly that many (so the caller can tell "more than I can
   * draw" from "this is all of them"), and that the default is still unbounded, since every other test
   * here relies on getting every crossing.
   */
  describe('the mark limit', () => {
    // Ten horizontal rails crossed by ten vertical ones: 100 crossings, none of them connected.
    const grid = () => {
      const geoms = new Map<string, Pt[]>()
      const edges: WireMeta[] = []
      for (let i = 0; i < 10; i++) {
        geoms.set(`h${i}`, [
          { x: -10, y: i * 20 },
          { x: 200, y: i * 20 },
        ])
        edges.push({ id: `h${i}`, source: `hs${i}`, target: `ht${i}` })
        geoms.set(`v${i}`, [
          { x: i * 20, y: -10 },
          { x: i * 20, y: 200 },
        ])
        edges.push({ id: `v${i}`, source: `vs${i}`, target: `vt${i}` })
      }
      return { geoms, edges }
    }

    test('with no limit every crossing of the grid is found', () => {
      const { geoms, edges } = grid()
      expect(findWireCrossings(geoms, edges)).toHaveLength(100)
    })

    test('a limit stops the scan at exactly that many marks', () => {
      const { geoms, edges } = grid()
      expect(findWireCrossings(geoms, edges, 7)).toHaveLength(7)
      expect(findWireCrossings(geoms, edges, 1)).toHaveLength(1)
    })

    test('a limit above the real count changes nothing', () => {
      const { geoms, edges } = grid()
      const all = findWireCrossings(geoms, edges)
      expect(findWireCrossings(geoms, edges, 101)).toEqual(all)
      expect(findWireCrossings(geoms, edges, 100)).toEqual(all)
    })
  })
})

/**
 * Telling "here are all the crossings" apart from "here are the first two thousand of them".
 *
 * THE DEFECT THIS GUARDS. `findWireCrossings` stops at its limit, so a canvas holding exactly `limit`
 * crossings and a canvas holding hundreds of thousands both come back holding `limit` — the caller cannot
 * tell them apart from the result alone. The scan is therefore asked for one MORE than may be drawn, and
 * coming back with that extra one is the only evidence the scan stopped early.
 *
 * It matters because the number is not bounded by anything the user did: the design recovered from
 * `fixtures/gowin-gw1n1-splitout.fs` (1,582 parts, 2,761 wires) has 290,091 crossings, per the note on
 * `findWireCrossings`. Marking 2,000 of those and saying nothing reads as "these are the crossings" and is
 * wrong — which the overlay's own `unmarked` prop exists to prevent.
 *
 * Every test here fails for a one-token change to `markableWireCrossings`, and each was checked to do so.
 */
describe('more crossings than may be marked', () => {
  /** A ladder of `count` horizontal over `count` vertical wires, every pair on its own net: count² marks. */
  function crossingGrid(count: number) {
    const geoms = new Map<string, Pt[]>()
    const edges: WireMeta[] = []
    for (let i = 0; i < count; i++) {
      geoms.set(`h${i}`, [
        { x: -50, y: i * 10 },
        { x: count * 10 + 50, y: i * 10 },
      ])
      edges.push({ id: `h${i}`, source: `hs${i}`, target: `ht${i}` })
      geoms.set(`v${i}`, [
        { x: i * 10, y: -50 },
        { x: i * 10, y: count * 10 + 50 },
      ])
      edges.push({ id: `v${i}`, source: `vs${i}`, target: `vt${i}` })
    }
    return { geoms, edges }
  }

  test('a grid of five by five really does make twenty-five crossings', () => {
    const { geoms, edges } = crossingGrid(5)
    expect(findWireCrossings(geoms, edges).length).toBe(25)
  })

  test('past the limit, the overflow is REPORTED — not silently truncated', () => {
    // The mutation this exists for is dropping the `+ 1` from the scan cap. The scan then returns exactly
    // `limit`, `length > limit` is false for ever, and a canvas of any size claims to be showing all of
    // its crossings while showing an arbitrary ten of them.
    const { geoms, edges } = crossingGrid(5)
    const result = markableWireCrossings(geoms, edges, 10)
    expect(result.unmarked).toBe(true)
  })

  test('past the limit, NO crossings are handed over to be drawn', () => {
    // Reporting the overflow and then drawing the truncated set anyway would put ten dots on the canvas
    // with a note beside them, which is the same wrong picture the note is meant to replace.
    const { geoms, edges } = crossingGrid(5)
    expect(markableWireCrossings(geoms, edges, 10).crossings).toEqual([])
  })

  test('exactly at the limit is NOT an overflow, and every crossing is drawn', () => {
    // The other half of the boundary, and the mutation is one character: `>` to `>=`. A canvas with
    // exactly the maximum number of crossings would then refuse to mark any of them and show the note.
    const { geoms, edges } = crossingGrid(5)
    const result = markableWireCrossings(geoms, edges, 25)
    expect(result.unmarked).toBe(false)
    expect(result.crossings.length).toBe(25)
  })

  test('under the limit, everything is marked and nothing is claimed to be missing', () => {
    const { geoms, edges } = crossingGrid(5)
    const result = markableWireCrossings(geoms, edges, 1000)
    expect(result.unmarked).toBe(false)
    expect(result.crossings.length).toBe(25)
  })
})

/**
 * Board DRC. Jobs: a legal board passes clean; parts dragged into collision are caught by the
 * courtyard rule; different nets' pad copper too close is a clearance violation with a real
 * position; copper hugging the board edge is caught with the cited 0.3 mm fab limit; and every rule
 * carries provenance (the anti-placeholder rule applies to manufacturing limits too).
 */
import { afterEach, describe, expect, test } from 'vitest'
import { canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { BUILTIN_FOOTPRINTS, type Footprint, type Pad } from '../src/renderer/footprint.ts'
import {
  type Board,
  type BoardPart,
  type BoardSide,
  computeRatsnest,
  deriveBoard,
  footprintByPlacement,
  placementBounds,
} from '../src/renderer/pcb-board.ts'
import {
  CASTELLATED_MIN_DRILL_MM,
  COMPONENT_EDGE_KEEPOUT_MM,
  creepageMm,
  DRC_RULES,
  ipc2221ClearanceMm,
  MAX_BOARD_MM,
  MAX_DRILL_MM,
  MIN_BOARD_MM,
  MIN_SILK_CHAR_HEIGHT_MM,
  minCopperFeatureMm,
  minDrillMm,
  PTH_PAD_ANNULAR_MM,
  runDrc,
  V_CUT_EDGE_CLEARANCE_MM,
} from '../src/renderer/pcb-drc.ts'
import { DEFAULT_ROUTE_CLASS, routeBoard } from '../src/renderer/pcb-route.ts'
import { SILK_TEXT } from '../src/renderer/stroke-font.ts'
import { registerUserPart, setUserParts } from '../src/renderer/user-parts.ts'

const parts = (defs: [string, string][]): BoardPart[] =>
  defs.map(([id, definition]) => ({ id, definition }))

const world = (defs: [string, string][], wires: [string, string, string, string][]) =>
  canvasToWorld(
    defs.map(([id, definition]) => ({ id, definition })),
    wires.map(([source, sourceHandle, target, targetHandle], i) => ({
      id: `w${i}`,
      source,
      sourceHandle,
      target,
      targetHandle,
    })),
  )

test('every DRC rule carries a cited limit', () => {
  for (const rule of Object.values(DRC_RULES)) {
    expect(rule.limitMm).toBeGreaterThanOrEqual(0)
    expect(rule.provenance.citation.length).toBeGreaterThan(10)
    expect(rule.provenance.confidence).toBe('high')
  }
})

describe('runDrc', () => {
  test('a legal routed board passes clean', () => {
    const defs: [string, string][] = [
      ['R1', 'resistor'],
      ['R2', 'resistor'],
    ]
    const board = deriveBoard(parts(defs))
    const rn = computeRatsnest(world(defs, [['R1', 'terminal_b', 'R2', 'terminal_a']]), board)
    const routing = routeBoard(rn)
    expect(runDrc(board, rn, routing)).toEqual([])
  })

  test('a via dropped INSIDE a component pad is flagged via-in-pad (solder wicking), even same-net', () => {
    const defs: [string, string][] = [['R1', 'resistor']]
    const board = deriveBoard(parts(defs))
    const rn = computeRatsnest(world(defs, []), board)
    const pad = rn.padBoxes[0]
    if (pad === undefined) throw new Error('no pad')
    // a hand-placed via sitting on the pad's centre — SAME net as the pad, still a defect
    const routing = {
      traces: [],
      vias: [
        {
          net: pad.net,
          at: { x: pad.x + pad.w / 2, y: pad.y + pad.h / 2 },
          diameterMm: 0.6,
          drillMm: 0.4,
        },
      ],
      unrouted: [],
    }
    const flagged = runDrc(board, rn, routing).filter((d) => d.code === 'via-in-pad')
    expect(flagged).toHaveLength(1)
    expect(flagged[0]?.message).toContain('via-in-pad')
  })

  test('a via clear of every pad is NOT flagged via-in-pad', () => {
    const defs: [string, string][] = [['R1', 'resistor']]
    const board = deriveBoard(parts(defs))
    const rn = computeRatsnest(world(defs, []), board)
    const [p0, p1] = rn.padBoxes
    if (p0 === undefined || p1 === undefined) throw new Error('missing pads')
    // the gap between the two pads (the part body) — clear of both pad coppers
    const mid = {
      x: (p0.x + p0.w / 2 + (p1.x + p1.w / 2)) / 2,
      y: (p0.y + p0.h / 2 + (p1.y + p1.h / 2)) / 2,
    }
    const routing = {
      traces: [],
      vias: [{ net: 'n', at: mid, diameterMm: 0.6, drillMm: 0.4 }],
      unrouted: [],
    }
    expect(runDrc(board, rn, routing).filter((d) => d.code === 'via-in-pad')).toEqual([])
  })

  test('parts dragged into collision: the courtyards overlap and the spot is marked', () => {
    const defs: [string, string][] = [
      ['R1', 'resistor'],
      ['R2', 'resistor'],
    ]
    // 1 mm apart — courtyards are 2.96 mm wide, so they overlap around the midpoint
    const overrides = new Map([
      ['R1', { x: 0, y: 0, rotation: 0 as const }],
      ['R2', { x: 1, y: 0, rotation: 0 as const }],
    ])
    const board = deriveBoard(parts(defs), overrides)
    const rn = computeRatsnest(world(defs, []), board)
    const violations = runDrc(board, rn, routeBoard(rn))
    const courtyard = violations.filter((v) => v.code === 'courtyard-overlap')
    expect(courtyard).toHaveLength(1)
    const v = courtyard[0]
    if (v === undefined) throw new Error('missing violation')
    expect(v.message).toContain('R1')
    expect(v.message).toContain('R2')
    expect(v.at.x).toBeGreaterThan(-1.5)
    expect(v.at.x).toBeLessThan(2.5)
  })

  test('two nets’ pad copper too close is a clearance violation', () => {
    // R2 rotated and pushed so its pad copper lands within the 0.2 mm clearance of R1's.
    const defs: [string, string][] = [
      ['R1', 'resistor'],
      ['R2', 'resistor'],
      ['R3', 'resistor'],
      ['R4', 'resistor'],
    ]
    const overrides = new Map([
      ['R1', { x: 0, y: 0, rotation: 0 as const }],
      ['R3', { x: 20, y: 0, rotation: 0 as const }],
      ['R2', { x: 0.9, y: 1, rotation: 0 as const }], // pad 1 copper ~0.1 mm from R1's pad 2
      ['R4', { x: 20, y: 6, rotation: 0 as const }],
    ])
    const board = deriveBoard(parts(defs), overrides)
    const rn = computeRatsnest(
      world(defs, [
        ['R1', 'terminal_b', 'R3', 'terminal_a'],
        ['R2', 'terminal_a', 'R4', 'terminal_a'],
      ]),
      board,
    )
    const violations = runDrc(board, rn, routeBoard(rn))
    expect(violations.some((v) => v.code === 'copper-clearance')).toBe(true)
  })

  test('copper within 0.3 mm of the board edge is caught (the mill would tear it)', () => {
    // A hand-built tight outline — the app's auto outline keeps a 2.5 mm margin, but outlines
    // become user-editable later and the rule must already be honest.
    const defs: [string, string][] = [['R1', 'resistor']]
    const auto = deriveBoard(parts(defs))
    const rn = computeRatsnest(world(defs, []), auto)
    const tight = {
      outline: { x: -0.5, y: -0.6, w: 4, h: 1.2 },
      placements: auto.placements,
    }
    const violations = runDrc(tight, rn, routeBoard(rn))
    expect(violations.some((v) => v.code === 'edge-clearance')).toBe(true)
  })

  test('a trace below the minimum manufacturable width is flagged', () => {
    const defs: [string, string][] = [['R1', 'resistor']]
    const board = deriveBoard(parts(defs))
    const rn = computeRatsnest(world(defs, []), board)
    const routing = {
      traces: [
        {
          net: 'net_1',
          widthMm: 0.1,
          points: [
            { x: 1, y: 0 },
            { x: 2, y: 0 },
          ],
          layer: 'top' as const,
        },
      ],
      vias: [],
      unrouted: [],
    }
    const violations = runDrc(board, rn, routing)
    expect(violations.some((v) => v.code === 'track-width')).toBe(true)
  })

  describe('Tier 0: the track-width floor scales with copper weight (not a flat 0.2 mm)', () => {
    // A one-trace board of a chosen trace width — the minimal fixture for the width floor.
    const boardWith = (widthMm: number) => ({
      board: { outline: { x: 0, y: 0, w: 20, h: 20 }, placements: [] } as Board,
      rn: { airwires: [], padBoxes: [] },
      routing: {
        traces: [
          {
            net: 'n',
            widthMm,
            layer: 'top' as const,
            points: [
              { x: 5, y: 10 },
              { x: 12, y: 10 },
            ],
          },
        ],
        vias: [],
        unrouted: [],
      },
    })
    const flagged = (widthMm: number, copperWeight?: 'half_oz' | 'one_oz' | 'two_oz') => {
      const { board, rn, routing } = boardWith(widthMm)
      const opts = copperWeight === undefined ? {} : { copperWeight }
      return runDrc(board, rn, routing, DEFAULT_ROUTE_CLASS, opts).some(
        (v) => v.code === 'track-width',
      )
    }

    test('minCopperFeatureMm is the JLCPCB weight table, 1 oz default', () => {
      expect(minCopperFeatureMm('half_oz')).toBeCloseTo(0.1, 6)
      expect(minCopperFeatureMm('one_oz')).toBeCloseTo(0.127, 6)
      expect(minCopperFeatureMm('two_oz')).toBeCloseTo(0.15, 6)
      expect(minCopperFeatureMm(undefined)).toBeCloseTo(0.127, 6) // default 1 oz
    })

    test('a 0.15 mm trace at 1 oz PASSES — the old flat 0.2 mm falsely rejected makeable traces', () => {
      expect(flagged(0.15, 'one_oz')).toBe(false)
    })

    test('a 0.14 mm trace is fine at 1 oz but too thin at 2 oz (heavier copper, wider floor)', () => {
      expect(flagged(0.14, 'one_oz')).toBe(false)
      expect(flagged(0.14, 'two_oz')).toBe(true)
    })

    test('a 0.11 mm trace is too thin at 1 oz but OK at 0.5 oz (thinner copper resolves finer)', () => {
      expect(flagged(0.11, 'one_oz')).toBe(true)
      expect(flagged(0.11, 'half_oz')).toBe(false)
    })

    test('omitting the copper weight fails SAFE — a 0.14 mm trace is flagged (assumes the heaviest floor)', () => {
      // 0.14 mm passes at 1 oz (0.127) but not at 2 oz (0.15); with no weight the check assumes 2 oz so an
      // unknown-weight caller over-rejects rather than passing a gap it can't verify.
      expect(flagged(0.14)).toBe(true)
      expect(flagged(0.14, 'one_oz')).toBe(false)
    })
  })

  test('silk lettering over a neighbour’s exposed pad is flagged — the fab would clip the ink', () => {
    // R2 is dragged to sit exactly where R1's designator prints (R1 at (10,10) letters at
    // (10, 8.57)): the lettering crosses R2's pad copper — ink the fab clips off the mask opening.
    const defs: [string, string][] = [
      ['resistor_1', 'resistor'],
      ['resistor_2', 'resistor'],
    ]
    const board = deriveBoard(
      parts(defs),
      new Map([
        ['resistor_1', { x: 10, y: 10, rotation: 0 as const }],
        ['resistor_2', { x: 10, y: 8.57, rotation: 0 as const }],
      ]),
    )
    const rn = computeRatsnest(world(defs, []), board)
    const violations = runDrc(board, rn, { traces: [], vias: [], unrouted: [] })
    expect(violations.some((v) => v.code === 'silk-over-pad')).toBe(true)

    // …and a normal spread board prints NO silk on any pad (own outlines and lettering clear)
    const clean = deriveBoard(parts(defs))
    const cleanRn = computeRatsnest(world(defs, []), clean)
    const cleanViolations = runDrc(clean, cleanRn, { traces: [], vias: [], unrouted: [] })
    expect(cleanViolations.filter((v) => v.code === 'silk-over-pad')).toEqual([])
  })

  test('every shipped footprint’s OWN silk stays off its own pads (outlines and lettering)', () => {
    // One of each footprinted part, auto-placed — the whole catalog's silk must be self-clean.
    const defs: [string, string][] = [
      ['resistor_1', 'resistor'],
      ['capacitor_1', 'capacitor'],
      ['inductor_1', 'inductor'],
      ['thermistor_1', 'thermistor'],
      ['transistor_bjt_npn_1', 'transistor_bjt_npn'],
    ]
    const board = deriveBoard(parts(defs))
    const rn = computeRatsnest(world(defs, []), board)
    const violations = runDrc(board, rn, { traces: [], vias: [], unrouted: [] })
    expect(violations.filter((v) => v.code === 'silk-over-pad')).toEqual([])
  })

  test('EVERY footprint in the library is silk-clean on its own pads — not just the reachable ones', () => {
    // SOIC-8 / DIP-8 / the header have no catalog part yet but ARE shipped and hand-placeable, so
    // the silk-over-pad DRC would flag any board using them if their silk crossed their pads
    // (review-caught: the SOIC-8's simplified full-rectangle silk ran straight down the pad rows).
    const emptyWorld = { instances: new Map(), nets: new Map() }
    for (const id of Object.keys(BUILTIN_FOOTPRINTS)) {
      const board = {
        outline: { x: -20, y: -20, w: 40, h: 40 },
        placements: [{ partId: 'X1', footprintId: id, x: 0, y: 0, rotation: 0 as const }],
      }
      const rn = computeRatsnest(emptyWorld, board)
      const violations = runDrc(board, rn, { traces: [], vias: [], unrouted: [] })
      expect(
        violations.filter((v) => v.code === 'silk-over-pad'),
        `${id} prints silk on its own pads`,
      ).toEqual([])
    }
  })

  test('a designator sweeping across BOTH of a neighbour’s pads reports each one — no early-out', () => {
    // A part with a long literal id (kept verbatim, not shortened) is dragged over a resistor so
    // its wide lettering crosses BOTH the resistor's pads. The fix (the early return stopped at
    // the first pad it found) must surface each pad separately.
    const defs: [string, string][] = [
      ['wwwwwwww', 'resistor'], // literal id → ~7 mm of lettering sweeping horizontally
      ['victim', 'resistor'],
    ]
    const board = deriveBoard(
      parts(defs),
      new Map([
        ['wwwwwwww', { x: 10, y: 11.4, rotation: 0 as const }],
        ['victim', { x: 10, y: 10, rotation: 0 as const }],
      ]),
    )
    const rn = computeRatsnest(world(defs, []), board)
    const hits = runDrc(board, rn, { traces: [], vias: [], unrouted: [] }).filter(
      (v) => v.code === 'silk-over-pad',
    )
    const victimPads = new Set(
      hits.filter((h) => h.message.startsWith('wwwwwwww')).map((h) => h.message),
    )
    // both of the victim resistor's pads flagged from ONE part's lettering — proof the checker
    // doesn't stop at the first pad a stroke touches
    expect(victimPads.size).toBeGreaterThanOrEqual(2)
  })

  test('silk within 0.15 mm of a pad but NOT overlapping it still flags (pins the positive gap)', () => {
    // Pin the cited constant so a regression that weakens it below the positive gap is caught…
    expect(DRC_RULES['silk-over-pad'].limitMm).toBe(0.15)
    // …and exercise the FIRING on a near-miss: a 0.15 mm silk line whose ink does NOT touch a 1×1 mm pad
    // but whose nearest edge is only 0.10 mm from it (inside the 0.15 mm clearance) must fire; move it to a
    // 0.175 mm gap and it clears. The earlier tests only drove OVERLAPPING silk, so they never pinned 0.15.
    const silkFp = (y: number): Footprint => ({
      id: 'TEST_SILK',
      name: 't',
      description: 't',
      pads: [{ id: '1', center: { x: 0, y: 0 }, size: { w: 1, h: 1 }, shape: 'rect', type: 'smd' }],
      silkscreen: [{ from: { x: -0.4, y }, to: { x: 0.4, y }, width: 0.15 }],
      fabrication: [{ from: { x: -0.6, y: -0.6 }, to: { x: 0.6, y: -0.6 }, width: 0.1 }],
      labels: { reference: { x: 0, y: 3 }, value: { x: 0, y: 3.5 }, fabReference: { x: 0, y: 0 } },
      courtyard: { x: -1, y: -1, w: 2, h: 5 }, // tall → the designator anchors well ABOVE the pad
      provenance: { source_type: 'reference', title: 't', citation: 't', confidence: 'low' },
    })
    const run = (y: number) => {
      BUILTIN_FOOTPRINTS.TEST_SILK = silkFp(y)
      try {
        const board = {
          outline: { x: -10, y: -10, w: 20, h: 20 },
          placements: [
            { partId: 'S1', footprintId: 'TEST_SILK', x: 0, y: 0, rotation: 0 as const },
          ],
        }
        const rn = computeRatsnest({ instances: new Map(), nets: new Map() }, board)
        return runDrc(board, rn, { traces: [], vias: [], unrouted: [] }).filter(
          (v) => v.code === 'silk-over-pad',
        )
      } finally {
        delete BUILTIN_FOOTPRINTS.TEST_SILK
      }
    }
    expect(run(-0.675).length).toBeGreaterThan(0) // ink 0.10 mm from the pad → inside 0.15 → fires
    expect(run(-0.75)).toEqual([]) // ink 0.175 mm from the pad → clears the 0.15 mm gap
  })

  test('an undersized via and two crowding holes are flagged with their cited limits', () => {
    const defs: [string, string][] = [['R1', 'resistor']]
    const board = deriveBoard(parts(defs))
    const rn = computeRatsnest(world(defs, []), board)
    const routing = {
      traces: [],
      // drill 0.2 < the 0.3 mm floor; ring (0.3−0.2)/2 = 0.05 is exactly legal (no annular flag);
      // the second via's hole sits 0.5 mm away → edge gap 0.5 − 0.3 = 0.2 < 0.25 → hole-to-hole.
      vias: [
        { net: 'a', at: { x: 20, y: 20 }, diameterMm: 0.3, drillMm: 0.2 },
        { net: 'a', at: { x: 20.5, y: 20 }, diameterMm: 0.6, drillMm: 0.4 },
      ],
      unrouted: [],
    }
    const violations = runDrc(board, rn, routing)
    expect(violations.some((v) => v.code === 'via-size' && v.message.includes('0.2'))).toBe(true)
    expect(violations.some((v) => v.code === 'hole-to-hole')).toBe(true)
  })

  describe('over-current — a trace vs its IPC-2221 ampacity', () => {
    const routed = () => {
      const defs: [string, string][] = [
        ['R1', 'resistor'],
        ['R2', 'resistor'],
      ]
      const board = deriveBoard(parts(defs))
      const rn = computeRatsnest(world(defs, [['R1', 'terminal_b', 'R2', 'terminal_a']]), board)
      const routing = routeBoard(rn)
      return { board, rn, routing, net: routing.traces[0]?.net ?? '' }
    }

    test('a thin trace carrying more than its rating is flagged (cited to IPC-2221)', () => {
      const { board, rn, routing, net } = routed()
      expect(net).not.toBe('')
      // a 0.25 mm 1 oz trace is rated ~0.88 A at a 10 °C rise — 5 A blows past it
      const v = runDrc(board, rn, routing, undefined, {
        netCurrents: new Map([[net, 5]]),
        copperWeight: 'one_oz',
      }).filter((x) => x.code === 'over-current')
      expect(v).toHaveLength(1)
      expect(v[0]?.message).toContain('5 A')
      expect(v[0]?.message).toContain('IPC-2221')
    })

    test('a current within the ampacity does NOT flag', () => {
      const { board, rn, routing, net } = routed()
      const v = runDrc(board, rn, routing, undefined, {
        netCurrents: new Map([[net, 0.1]]), // 0.1 A << the ~0.88 A rating
        copperWeight: 'one_oz',
      })
      expect(v.filter((x) => x.code === 'over-current')).toHaveLength(0)
    })

    test('heavier copper raises the rating — the same current that flagged 1 oz clears at 2 oz', () => {
      const { board, rn, routing, net } = routed()
      // ~1.4 A: over a 0.25 mm 1 oz trace (~0.88 A) but under 2 oz (~1.45 A)
      const at1oz = runDrc(board, rn, routing, undefined, {
        netCurrents: new Map([[net, 1.4]]),
        copperWeight: 'one_oz',
      }).filter((x) => x.code === 'over-current')
      const at2oz = runDrc(board, rn, routing, undefined, {
        netCurrents: new Map([[net, 1.4]]),
        copperWeight: 'two_oz',
      }).filter((x) => x.code === 'over-current')
      expect(at1oz).toHaveLength(1)
      expect(at2oz).toHaveLength(0)
    })

    test('no over-current check without solved net currents (an unsolved board)', () => {
      const { board, rn, routing } = routed()
      expect(runDrc(board, rn, routing).filter((x) => x.code === 'over-current')).toHaveLength(0)
    })

    test('a buried inner-layer trace is flagged at HALF the current — the internal IPC-2221 k', () => {
      const { board, rn, net } = routed()
      const pts = [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
      ]
      const inner = {
        traces: [{ net, widthMm: 0.25, layer: 'inner1' as const, points: pts }],
        vias: [],
        unrouted: [],
      }
      const outer = {
        ...inner,
        traces: [{ net, widthMm: 0.25, layer: 'top' as const, points: pts }],
      }
      const oc = (r: Parameters<typeof runDrc>[2]) =>
        runDrc(board, rn, r, undefined, {
          netCurrents: new Map([[net, 0.6]]),
          copperWeight: 'one_oz',
        }).filter((v) => v.code === 'over-current')
      // 0.6 A: over a buried inner trace's ~0.44 A rating, but UNDER an external trace's ~0.88 A.
      const innerHits = oc(inner)
      expect(innerHits).toHaveLength(1)
      expect(innerHits[0]?.message).toContain('inner-layer')
      expect(innerHits[0]?.message).toContain('internal')
      expect(oc(outer)).toHaveLength(0) // the same trace on the outer copper is within its rating
    })

    test('a via carrying more than its plated barrel can hold is flagged (the bottleneck)', () => {
      const { board, rn, net } = routed()
      const routing = {
        traces: [],
        vias: [{ net, at: { x: 0, y: 0 }, diameterMm: 0.6, drillMm: 0.4 }],
        unrouted: [],
      }
      const oc = (amps: number) =>
        runDrc(board, rn, routing, undefined, {
          netCurrents: new Map([[net, amps]]),
          copperWeight: 'one_oz',
        }).filter((v) => v.code === 'over-current')
      // a 0.4 mm via's barrel is rated ~0.97 A: 3 A blows past it, 0.5 A clears it.
      const hot = oc(3)
      expect(hot).toHaveLength(1)
      expect(hot[0]?.message).toContain('via on net')
      expect(hot[0]?.message).toContain('barrel')
      expect(oc(0.5)).toHaveLength(0)
    })

    test('multi-drop: a thin branch off a high-current trunk is checked against ITS load, not the trunk', () => {
      // A 5 A source at (0,0) feeds a big 4.9 A load at (10,2) and a tiny 0.1 A load at (10,-2), the
      // net routed as a trunk + two branches. The tiny branch (0.1 A) must NOT be over-current, though
      // the whole net carries 5 A.
      const board = { outline: { x: -5, y: -5, w: 30, h: 20 }, placements: [] }
      const box = (pad: string, x: number, y: number) => ({
        pad,
        net: 'n',
        throughHole: false,
        x: x - 0.5,
        y: y - 0.5,
        w: 1,
        h: 1,
      })
      const rn = {
        airwires: [],
        padBoxes: [box('S/1', 0, 0), box('L1/1', 10, 2), box('L2/1', 10, -2)],
      }
      const seg = (pts: { x: number; y: number }[]) => ({
        net: 'n',
        widthMm: 0.25,
        layer: 'top' as const,
        points: pts,
      })
      const routing = {
        traces: [
          seg([
            { x: 0, y: 0 },
            { x: 10, y: 0 },
          ]), // trunk (5 A)
          seg([
            { x: 10, y: 0 },
            { x: 10, y: 2 },
          ]), // branch to the big load (4.9 A)
          seg([
            { x: 10, y: 0 },
            { x: 10, y: -2 },
          ]), // branch to the tiny load (0.1 A)
        ],
        vias: [],
        unrouted: [],
      }
      const opts = {
        netCurrents: new Map([['n', 5]]),
        copperWeight: 'one_oz' as const,
        padCurrents: new Map([
          ['S/1', 5],
          ['L1/1', 4.9],
          ['L2/1', 0.1],
        ]),
      }
      const oc = runDrc(board, rn, routing, undefined, opts).filter(
        (v) => v.code === 'over-current',
      )
      // trunk (5 A) and the big branch (4.9 A) are over the ~0.88 A rating; the tiny branch is NOT.
      expect(oc).toHaveLength(2)
      // WITHOUT the per-pad currents, the tiny branch would be flagged against the whole-net 5 A too.
      const withoutPads = runDrc(board, rn, routing, undefined, {
        netCurrents: opts.netCurrents,
        copperWeight: opts.copperWeight,
      }).filter((v) => v.code === 'over-current')
      expect(withoutPads).toHaveLength(3) // all three traces, including the false-flagged tiny branch
    })
  })

  describe('IR-drop — a power rail vs its 5%-of-voltage budget', () => {
    // A single rail trace under full control: 0.25 mm × 200 mm at 1 oz is ~0.38 Ω, so 3 A drops ~1.15 V —
    // way over the 0.25 V budget on a 5 V rail. The over-current thermal check is a SEPARATE limit; this is
    // the resistive-sag one.
    const board = { outline: { x: -5, y: -5, w: 260, h: 20 }, placements: [] }
    const rail = (widthMm: number, lengthMm: number) => ({
      traces: [
        {
          net: 'VCC',
          widthMm,
          layer: 'top' as const,
          points: [
            { x: 0, y: 0 },
            { x: lengthMm, y: 0 },
          ],
        },
      ],
      vias: [],
      unrouted: [],
    })
    const rn = { airwires: [], padBoxes: [] }
    const irDrop = (
      routing: Parameters<typeof runDrc>[2],
      amps: number,
      volts: number,
      copperWeight: 'half_oz' | 'one_oz' | 'two_oz' = 'one_oz',
    ) =>
      runDrc(board, rn, routing, undefined, {
        netCurrents: new Map([['VCC', amps]]),
        netVolts: new Map([['VCC', volts]]),
        copperWeight,
      }).filter((v) => v.code === 'ir-drop')

    test('a long thin 5 V rail at high current is flagged over its 5% budget', () => {
      const v = irDrop(rail(0.25, 200), 3, 5)
      expect(v).toHaveLength(1)
      expect(v[0]?.message).toContain('VCC')
      expect(v[0]?.message).toContain('budget')
    })

    test('the same rail at a tiny current is clean (a normal board drops mV, not volts)', () => {
      expect(irDrop(rail(0.25, 200), 0.02, 5)).toHaveLength(0)
    })

    test('widening the copper clears the drop — same current, a 16× wider rail', () => {
      // 0.25 mm flagged at 3 A; 4 mm (16× the copper) drops ~1/16 as much → under budget
      expect(irDrop(rail(4, 200), 3, 5)).toHaveLength(0)
    })

    test('a ground / signal net (|V| < 1) is never an IR-drop rail', () => {
      // same punishing geometry + current, but at 0 V — ground is not a rail, so it is never checked
      expect(irDrop(rail(0.25, 200), 3, 0)).toHaveLength(0)
    })

    test('no IR-drop check without solved net voltages (currents alone are not enough)', () => {
      const v = runDrc(board, rn, rail(0.25, 200), undefined, {
        netCurrents: new Map([['VCC', 3]]),
        copperWeight: 'one_oz',
      }).filter((x) => x.code === 'ir-drop')
      expect(v).toHaveLength(0)
    })
  })

  describe('castellated half-holes — the plated edge notches of a solder-down module', () => {
    const ROUTING = { traces: [], vias: [], unrouted: [] }
    const EMPTY_RN = { airwires: [], padBoxes: [] }
    const cast = (v: ReturnType<typeof runDrc>) => v.filter((d) => d.code === 'castellated-hole')

    // Six well-formed castellated pads on the module's bottom edge (y = 3): 0.9 mm drill, 0.3 mm ring,
    // 2.0 mm pitch (1.1 mm edge-to-edge) — all clear the castellated minimums.
    const goodPads = (): Pad[] =>
      [-5, -3, -1, 1, 3, 5].map((x, i) => ({
        id: `${i + 1}`,
        center: { x, y: 3 },
        size: { w: 1.5, h: 1.5 },
        shape: 'roundrect',
        type: 'through_hole',
        holeDiameter: 0.9,
        castellated: true,
      }))
    // A closed rectangular body outline (F.Fab) as 4 segments — a real body for the component-edge +
    // castellated-side tests (which need fabricationBounds to be a rectangle, not a single line).
    const rectOutlineSegs = (x0: number, y0: number, x1: number, y1: number) => [
      { from: { x: x0, y: y0 }, to: { x: x1, y: y0 }, width: 0.1 },
      { from: { x: x1, y: y0 }, to: { x: x1, y: y1 }, width: 0.1 },
      { from: { x: x1, y: y1 }, to: { x: x0, y: y1 }, width: 0.1 },
      { from: { x: x0, y: y1 }, to: { x: x0, y: y0 }, width: 0.1 },
    ]
    const testFp = (pads: Pad[]): Footprint => ({
      id: 'TEST_CAST',
      name: 'test castellated',
      description: 'test',
      pads,
      silkscreen: [],
      fabrication: [{ from: { x: -6, y: -3 }, to: { x: 6, y: -3 }, width: 0.1 }],
      labels: { reference: { x: 0, y: 0 }, value: { x: 0, y: 0 }, fabReference: { x: 0, y: 0 } },
      courtyard: { x: -6, y: -3.2, w: 12, h: 7 },
      provenance: { source_type: 'reference', title: 't', citation: 't', confidence: 'low' },
    })
    // Inject the throwaway footprint, place it at the origin, size the outline to a chosen bottom edge, run DRC.
    const run = (pads: Pad[], outline: Board['outline']) => {
      BUILTIN_FOOTPRINTS.TEST_CAST = testFp(pads)
      try {
        return runDrc(
          {
            outline,
            placements: [{ partId: 'M1', footprintId: 'TEST_CAST', x: 0, y: 0, rotation: 0 }],
          },
          EMPTY_RN,
          ROUTING,
        )
      } finally {
        delete BUILTIN_FOOTPRINTS.TEST_CAST
      }
    }
    const onEdge = { x: -6, y: -3, w: 12, h: 6 } // bottom edge at y = 3, where the pads sit

    test('a well-formed castellated module sitting ON the edge is castellated-clean', () => {
      expect(cast(run(goodPads(), onEdge))).toHaveLength(0)
    })

    test('the same module 3 mm inside the edge is flagged — a half-hole must sit ON the edge', () => {
      const v = cast(run(goodPads(), { x: -6, y: -3, w: 12, h: 12 })) // bottom now at y = 9
      expect(v).toHaveLength(6) // all six pads off the edge
      expect(v[0]?.message).toContain('board edge')
    })

    test('an under-0.6 mm castellated drill is flagged', () => {
      const v = cast(
        run(
          goodPads().map((p) => ({ ...p, holeDiameter: 0.4 })),
          onEdge,
        ),
      )
      expect(v.some((x) => x.message.includes(`${CASTELLATED_MIN_DRILL_MM} mm minimum`))).toBe(true)
    })

    test('an under-0.25 mm castellated ring is flagged', () => {
      // a 1.1 mm pad on a 0.9 mm hole → 0.1 mm ring, under the 0.25 mm castellated ring
      const v = cast(
        run(
          goodPads().map((p) => ({ ...p, size: { w: 1.1, h: 1.1 } })),
          onEdge,
        ),
      )
      expect(v.some((x) => x.message.includes('ring'))).toBe(true)
    })

    test('castellated half-holes closer than 0.6 mm edge-to-edge are flagged', () => {
      const first = goodPads()[0] as Pad
      const tight: Pad[] = [
        { ...first, id: '1', center: { x: 0, y: 3 } },
        { ...first, id: '2', center: { x: 0.9, y: 3 } }, // 0.9 mm apart on 0.9 mm drills → 0 gap
      ]
      const v = cast(run(tight, onEdge))
      expect(v.some((x) => x.message.includes('apart'))).toBe(true)
    })

    test('a castellated pad on the edge is EXEMPT from copper-to-edge (a normal pad there is flagged)', () => {
      const board = { outline: { x: 0, y: 0, w: 20, h: 20 }, placements: [] }
      const oneBox = (net: string, castellated: boolean) => ({
        airwires: [],
        padBoxes: [
          {
            net,
            pad: `${net}/1`,
            throughHole: true,
            x: 0.1, // 0.1 mm from the left edge
            y: 9,
            w: 1.5,
            h: 1.5,
            ...(castellated ? { castellated: true } : {}),
          },
        ],
      })
      const edgeHits = (rn: Parameters<typeof runDrc>[1]) =>
        runDrc(board, rn, ROUTING).filter((d) => d.code === 'edge-clearance')
      expect(edgeHits(oneBox('C', true))).toHaveLength(0) // castellated: belongs on the edge, exempt
      expect(edgeHits(oneBox('N', false)).length).toBeGreaterThan(0) // a normal pad at the edge IS flagged
    })

    test('deriveBoard snaps the profile through castellated pads at EVERY rotation → auto-derived module clean', () => {
      // Uses the SHIPPED, registered FOOTPRINT_CASTELLATED_1X6 (Castellated_1x6_P2.0mm) via a user part.
      registerUserPart({
        id: 'castmod',
        name: 'Cast Module',
        designatorPrefix: 'U',
        pins: Array.from({ length: 6 }, (_, i) => ({
          id: `p${i + 1}`,
          name: `${i + 1}`,
          side: 'bottom' as const,
          electrical: 'passive' as const,
        })),
        footprintId: 'Castellated_1x6_P2.0mm',
      })
      try {
        for (const rotation of [0, 90, 180, 270] as const) {
          const overrides = new Map([['castmod', { x: 20, y: 20, rotation }]])
          const board = deriveBoard([{ id: 'castmod', definition: 'castmod' }], overrides)
          // GUARD against a vacuous pass: the part MUST actually land (the footprint must be registered),
          // else deriveBoard drops it and runDrc trivially finds 0 castellated-hole hits on an empty board.
          expect(board.placements.length, `rotation ${rotation}`).toBe(1)
          const rn = computeRatsnest(world([['castmod', 'castmod']], []), board)
          // With the profile snapped through the pad centres (footprint-edge-aware), the six half-holes sit
          // ON the edge at every rotation — no 'off the edge', drill, ring, or pitch flags.
          const hits = runDrc(board, rn, ROUTING).filter((d) => d.code === 'castellated-hole')
          expect(
            hits,
            `rotation ${rotation}: ${hits.map((h) => h.message).join(' | ')}`,
          ).toHaveLength(0)
        }
      } finally {
        setUserParts([])
      }
    })

    test('a castellated module BESIDE another part does not clip it — the outline still encloses both', () => {
      // The profile snap only fires on a lone module; with a second part the outline must re-fit around
      // BOTH (moving an edge inward through the half-holes would otherwise push the other part outside).
      registerUserPart({
        id: 'castmod2',
        name: 'Cast Module',
        designatorPrefix: 'U',
        pins: Array.from({ length: 6 }, (_, i) => ({
          id: `p${i + 1}`,
          name: `${i + 1}`,
          side: 'bottom' as const,
          electrical: 'passive' as const,
        })),
        footprintId: 'Castellated_1x6_P2.0mm',
      })
      try {
        const board = deriveBoard([
          { id: 'castmod2', definition: 'castmod2' },
          { id: 'R1', definition: 'resistor' },
        ])
        expect(board.placements).toHaveLength(2)
        const o = board.outline
        for (const pl of board.placements) {
          const fp = footprintByPlacement(pl)
          if (fp === undefined) throw new Error('no footprint')
          const b = placementBounds(pl, fp)
          expect(b.minX).toBeGreaterThanOrEqual(o.x - 1e-6)
          expect(b.maxX).toBeLessThanOrEqual(o.x + o.w + 1e-6)
          expect(b.minY).toBeGreaterThanOrEqual(o.y - 1e-6)
          expect(b.maxY).toBeLessThanOrEqual(o.y + o.h + 1e-6)
        }
      } finally {
        setUserParts([])
      }
    })

    test('the conveyor-rail keepout exempts ONLY the castellated edge — a body crowding a routed edge flags', () => {
      // A real rectangular body with castellations on the BOTTOM, placed so the body TOP (a routed edge)
      // is 0.5 mm from the board's top edge — well inside the 3 mm keepout. Old code skipped the whole part.
      BUILTIN_FOOTPRINTS.TEST_CAST = {
        ...testFp(goodPads()),
        fabrication: rectOutlineSegs(-6, -3, 6, 3),
      }
      try {
        const board = {
          outline: { x: -10, y: -3.5, w: 20, h: 20 }, // only the top edge crowds the body
          placements: [
            { partId: 'M1', footprintId: 'TEST_CAST', x: 0, y: 0, rotation: 0 as const },
          ],
        }
        const v = runDrc(board, EMPTY_RN, ROUTING).filter((d) => d.code === 'component-edge')
        expect(v).toHaveLength(1)
        expect(v[0]?.message).toContain('(top)') // the routed edge it crowds — NOT the exempt bottom
      } finally {
        delete BUILTIN_FOOTPRINTS.TEST_CAST
      }
    })

    test('castellated pitch pairs only SAME-edge holes (opposite edges share no plating web)', () => {
      // Two 0.6 mm castellated holes on OPPOSITE edges of a 1 mm-tall board, each correctly on its own edge:
      // 0.4 mm apart centre-to-edge, but separated by solid FR4. Must NOT flag the shared-cut pitch rule.
      const body = rectOutlineSegs(-6, -0.3, 6, 0.3) // thin body BETWEEN the two rows
      const opp: Pad[] = [
        {
          id: '1',
          center: { x: 0, y: 0.5 },
          size: { w: 1.2, h: 1.2 },
          shape: 'roundrect',
          type: 'through_hole',
          holeDiameter: 0.6,
          castellated: true,
        },
        {
          id: '2',
          center: { x: 0, y: -0.5 },
          size: { w: 1.2, h: 1.2 },
          shape: 'roundrect',
          type: 'through_hole',
          holeDiameter: 0.6,
          castellated: true,
        },
      ]
      BUILTIN_FOOTPRINTS.TEST_CAST = { ...testFp(opp), fabrication: body }
      try {
        const board = {
          outline: { x: -6, y: -0.5, w: 12, h: 1.0 }, // top edge y=-0.5, bottom edge y=0.5 — a pad on each
          placements: [
            { partId: 'M1', footprintId: 'TEST_CAST', x: 0, y: 0, rotation: 0 as const },
          ],
        }
        // Both sit ON their own edge (no off-edge flag) and are on DIFFERENT edges (no pitch flag).
        expect(cast(runDrc(board, EMPTY_RN, ROUTING))).toHaveLength(0)
      } finally {
        delete BUILTIN_FOOTPRINTS.TEST_CAST
      }
    })
  })

  describe('V-scored board edges — the tighter 0.4 mm copper-to-edge on a snap groove', () => {
    const ROUTING = { traces: [], vias: [], unrouted: [] }
    // A pad 0.35 mm from the TOP edge — over the 0.3 mm routed limit but under the 0.4 mm V-cut limit.
    const padNearTop = {
      airwires: [],
      padBoxes: [{ net: 'n', pad: 'n/1', throughHole: false, x: 5, y: 0.35, w: 1, h: 1 }],
    }
    const board = (vScoredSides?: BoardSide[]): Board => ({
      outline: { x: 0, y: 0, w: 20, h: 20 },
      placements: [],
      ...(vScoredSides ? { vScoredSides } : {}),
    })
    const edgeHits = (b: Board) =>
      runDrc(b, padNearTop, ROUTING).filter((d) => d.code === 'edge-clearance')

    test('the V-cut limit is wider than the routed one (0.4 > 0.3 mm)', () => {
      expect(V_CUT_EDGE_CLEARANCE_MM).toBeGreaterThan(DRC_RULES['edge-clearance'].limitMm)
    })

    test('0.35 mm from a ROUTED edge is clean (over the 0.3 mm routed limit)', () => {
      expect(edgeHits(board())).toHaveLength(0)
    })

    test('0.35 mm from a V-SCORED edge is flagged (under the 0.4 mm V-cut limit)', () => {
      const v = edgeHits(board(['top']))
      expect(v).toHaveLength(1)
      expect(v[0]?.message).toContain('V-scored')
      expect(v[0]?.message).toContain('top')
    })

    test('marking a DIFFERENT side V-scored leaves copper near the still-routed side clean', () => {
      expect(edgeHits(board(['bottom']))).toHaveLength(0) // top is still routed → 0.35 mm is fine
    })

    test('near a corner the message names the NEAREST violated side, with its own limit + label', () => {
      // box near the top-left corner: left is V-scored (0.4 mm), top is routed (0.3 mm). The box is 0.35 mm
      // from the V-scored left but only 0.05 mm from the routed top — the worst/nearest violation is TOP.
      const rn = {
        airwires: [],
        padBoxes: [{ net: 'n', pad: 'n/1', throughHole: false, x: 0.35, y: 0.05, w: 1, h: 1 }],
      }
      const v = runDrc(board(['left']), rn, ROUTING).filter((d) => d.code === 'edge-clearance')
      expect(v).toHaveLength(1)
      expect(v[0]?.message).toContain('(top)') // the nearest edge, not the first-in-priority left
      expect(v[0]?.message).toContain('0.3 mm') // the routed limit, not left's 0.4 mm
      expect(v[0]?.message).not.toContain('V-scored')
    })
  })

  describe('open-net — a net not joined by its own copper', () => {
    const defs: [string, string][] = [
      ['R1', 'resistor'],
      ['R2', 'resistor'],
    ]
    const built = () => {
      const board = deriveBoard(parts(defs))
      const rn = computeRatsnest(world(defs, [['R1', 'terminal_b', 'R2', 'terminal_a']]), board)
      return { board, rn }
    }
    const openNet = (v: ReturnType<typeof runDrc>) => v.filter((x) => x.code === 'open-net')

    test('a fully-routed net is whole — no open-net violation', () => {
      const { board, rn } = built()
      expect(openNet(runDrc(board, rn, routeBoard(rn)))).toEqual([])
    })

    test('a net the router self-certifies but laid NO copper for is flagged open', () => {
      // unrouted EMPTY (the router considers it done) but there is no copper — the blind spot the
      // clearance/width checks miss (they check spacing, not continuity).
      const { board, rn } = built()
      const opens = openNet(runDrc(board, rn, { traces: [], vias: [], unrouted: [] }))
      expect(opens).toHaveLength(1)
      expect(opens[0]?.message).toContain('not fully connected')
    })

    test('a net still owed an airwire is NOT double-reported (already unrouted)', () => {
      const { board, rn } = built()
      // The airwire is owed → surfaced as the header's routed count; open-net must not re-flag it.
      expect(openNet(runDrc(board, rn, { traces: [], vias: [], unrouted: rn.airwires }))).toEqual(
        [],
      )
    })

    test('a layer change with no via leaves the net open; adding the via makes it whole', () => {
      const { board, rn } = built()
      const net = rn.airwires[0]?.net
      if (net === undefined) throw new Error('no airwire')
      const pads = rn.padBoxes
        .filter((p) => p.net === net)
        .map((p) => ({ x: p.x + p.w / 2, y: p.y + p.h / 2 }))
      const [p1, p2] = pads
      if (p1 === undefined || p2 === undefined) throw new Error('need two pads')
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
      // Top trace covers half, bottom trace the other half — but NO via joins the layers.
      const routing = {
        traces: [
          { net, widthMm: 0.25, layer: 'top' as const, points: [p1, mid] },
          { net, widthMm: 0.25, layer: 'bottom' as const, points: [mid, p2] },
        ],
        vias: [],
        unrouted: [],
      }
      expect(openNet(runDrc(board, rn, routing))).toHaveLength(1)
      // The via bridges the layers at the seam → the copper physically connects → no open.
      const withVia = { ...routing, vias: [{ net, at: mid, diameterMm: 0.6, drillMm: 0.4 }] }
      expect(openNet(runDrc(board, rn, withVia))).toEqual([])
    })
  })
})

describe('runDrc — plated through-hole PAD geometry (annular ring + drill floor, IPC-2221)', () => {
  // A plated component hole needs the same annular ring + drill floor a via does. Shipped footprints are
  // all sane, so to exercise the check we inject a deliberately-bad footprint (the case a user-authored
  // or edited footprint hits) and confirm DRC flags it — the identical geometry on a via was already
  // caught, but a component pad slipped through before this rule.
  const badId = '__TEST_BAD_THT__'
  const fpWith = (holeDiameter: number, padMm: number): Footprint => ({
    id: badId,
    name: 'test THT',
    description: 'a deliberately-bad through-hole pad for the DRC test',
    pads: [
      {
        id: '1',
        center: { x: 0, y: 0 },
        size: { w: padMm, h: padMm },
        shape: 'circle',
        type: 'through_hole',
        holeDiameter,
      },
    ],
    silkscreen: [],
    fabrication: [{ from: { x: -1, y: -1 }, to: { x: 1, y: -1 }, width: 0.1 }],
    labels: { reference: { x: 0, y: 0 }, value: { x: 0, y: 0 }, fabReference: { x: 0, y: 0 } },
    courtyard: { x: -1, y: -1, w: 2, h: 2 },
    provenance: { source_type: 'reference', title: 'test', citation: 'test', confidence: 'high' },
  })
  const codesFor = (holeDiameter: number, padMm: number): string[] => {
    BUILTIN_FOOTPRINTS[badId] = fpWith(holeDiameter, padMm)
    const board: Board = {
      outline: { x: 0, y: 0, w: 50, h: 50 },
      placements: [
        { partId: 'D1', footprintId: badId, x: 20, y: 20, rotation: 0, designator: 'D1' },
      ],
    }
    const rn = { airwires: [], padBoxes: [] }
    const routing = { traces: [], vias: [], unrouted: [] }
    return runDrc(board, rn, routing).map((d) => d.code)
  }
  afterEach(() => {
    delete BUILTIN_FOOTPRINTS[badId]
  })

  test('a pad barely larger than its hole is flagged annular-ring (0.025 mm < 0.15 mm)', () => {
    // pad 0.85 mm, hole 0.8 mm → ring (0.85 − 0.8)/2 = 0.025 mm; the 0.8 mm drill is fine
    const codes = codesFor(0.8, 0.85)
    expect(codes).toContain('annular-ring')
    expect(codes).not.toContain('drill-size')
  })

  test('Tier 0: the PTH pad annular rule is 0.15 mm, not the 0.05 mm via floor', () => {
    expect(PTH_PAD_ANNULAR_MM).toBeCloseTo(0.15, 6)
    // pad 1.0 mm, hole 0.8 mm → ring 0.10 mm: PASSED the old 0.05 mm via floor, now FAILS the 0.15 mm
    // plated-through-hole design rule (registration drift could break a 0.10 mm ring open).
    const codes = codesFor(0.8, 1.0)
    expect(codes).toContain('annular-ring')
    expect(codes).not.toContain('drill-size')
  })

  test('Tier 0: a round hole over the 6.3 mm max drill must be a routed slot', () => {
    expect(MAX_DRILL_MM).toBeCloseTo(6.3, 6)
    // pad 8 mm, hole 7 mm → drill 7 > 6.3 (drill-size); ring (8 − 7)/2 = 0.5 mm is fine
    const codes = codesFor(7.0, 8.0)
    expect(codes).toContain('drill-size')
    expect(codes).not.toContain('annular-ring')
  })

  test('a hole under the 0.3 mm drill floor is flagged drill-size', () => {
    // pad 1.0 mm, hole 0.2 mm → drill 0.2 < 0.3; the (1.0 − 0.2)/2 = 0.4 mm ring is fine
    const codes = codesFor(0.2, 1.0)
    expect(codes).toContain('drill-size')
    expect(codes).not.toContain('annular-ring')
  })

  test('a sane through-hole pad (1.6 mm pad, 0.8 mm hole — DIP-8 geometry) is clean', () => {
    const codes = codesFor(0.8, 1.6) // ring 0.4 mm, drill 0.8 mm — both well within the floors
    expect(codes).not.toContain('annular-ring')
    expect(codes).not.toContain('drill-size')
  })

  test('EVERY shipped through-hole footprint pad clears the 0.15 mm annular + drill floors (no false flag)', () => {
    // The tightening from 0.05 → 0.15 must not falsely reject any real footprint — the same over-rejection
    // trap the trace-width fix avoided. Check the shipped footprints directly.
    for (const [id, fp] of Object.entries(BUILTIN_FOOTPRINTS)) {
      if (id === badId) continue
      for (const pad of fp.pads) {
        if (pad.holeDiameter === undefined) continue
        const ring = (Math.min(pad.size.w, pad.size.h) - pad.holeDiameter) / 2
        expect(ring, `${id} pad ${pad.id} annular`).toBeGreaterThanOrEqual(
          PTH_PAD_ANNULAR_MM - 1e-9,
        )
        expect(pad.holeDiameter, `${id} pad ${pad.id} drill`).toBeGreaterThanOrEqual(0.3 - 1e-9)
        expect(pad.holeDiameter, `${id} pad ${pad.id} drill`).toBeLessThanOrEqual(MAX_DRILL_MM)
      }
    }
  })
})

describe('Tier 0: silkscreen stroke width + character height', () => {
  const thinId = '__TEST_THIN_SILK__'
  afterEach(() => {
    delete BUILTIN_FOOTPRINTS[thinId]
  })
  const codesForSilk = (strokeMm: number): string[] => {
    BUILTIN_FOOTPRINTS[thinId] = {
      id: thinId,
      name: 'thin silk',
      description: 'a footprint with a chosen silk stroke width for the DRC test',
      pads: [{ id: '1', center: { x: 0, y: 0 }, size: { w: 1, h: 1 }, shape: 'rect', type: 'smd' }],
      // a silk stroke well clear of the pad (so only the stroke-WIDTH rule can fire, not silk-over-pad)
      silkscreen: [{ from: { x: -2, y: -2 }, to: { x: 2, y: -2 }, width: strokeMm }],
      fabrication: [{ from: { x: -1, y: -1 }, to: { x: 1, y: -1 }, width: 0.1 }],
      labels: { reference: { x: 0, y: 0 }, value: { x: 0, y: 0 }, fabReference: { x: 0, y: 0 } },
      courtyard: { x: -2.5, y: -2.5, w: 5, h: 5 },
      provenance: { source_type: 'reference', title: 't', citation: 't', confidence: 'high' },
    }
    const board: Board = {
      outline: { x: 0, y: 0, w: 20, h: 20 },
      placements: [
        { partId: 'U1', footprintId: thinId, x: 10, y: 10, rotation: 0, designator: 'U1' },
      ],
    }
    return runDrc(
      board,
      { airwires: [], padBoxes: [] },
      { traces: [], vias: [], unrouted: [] },
    ).map((v) => v.code)
  }

  test('a 0.10 mm silk stroke is flagged silk-stroke; a 0.15 mm stroke is not', () => {
    expect(codesForSilk(0.1)).toContain('silk-stroke')
    expect(codesForSilk(0.15)).not.toContain('silk-stroke')
  })

  test('the designator font renders at ≥ the 1.0 mm minimum character height', () => {
    expect(MIN_SILK_CHAR_HEIGHT_MM).toBe(1.0)
    expect(SILK_TEXT.heightMm).toBeGreaterThanOrEqual(MIN_SILK_CHAR_HEIGHT_MM)
  })
})

describe('Tier 0: voltage clearance (IPC-2221B B2) — high-ΔV nets need extra spacing', () => {
  test('ipc2221ClearanceMm matches the B2 table', () => {
    expect(ipc2221ClearanceMm(5)).toBeCloseTo(0.1, 6)
    expect(ipc2221ClearanceMm(100)).toBeCloseTo(0.6, 6)
    expect(ipc2221ClearanceMm(250)).toBeCloseTo(1.25, 6)
    expect(ipc2221ClearanceMm(400)).toBeCloseTo(2.5, 6)
    expect(ipc2221ClearanceMm(600)).toBeCloseTo(3.0, 6) // 2.5 + (600−500)·0.005
  })

  // Two parallel 0.25 mm traces of different nets; centre gap 0.75 → edge gap 0.5 mm — clears the fab
  // spacing floor but not the 1.25 mm a 300 V pair needs.
  const codes = (netVolts: Map<string, number>): string[] => {
    const board: Board = { outline: { x: -5, y: -5, w: 40, h: 40 }, placements: [] }
    const routing = {
      traces: [
        {
          net: 'a',
          widthMm: 0.25,
          layer: 'top' as const,
          points: [
            { x: 0, y: 0 },
            { x: 5, y: 0 },
          ],
        },
        {
          net: 'b',
          widthMm: 0.25,
          layer: 'top' as const,
          points: [
            { x: 0, y: 0.75 },
            { x: 5, y: 0.75 },
          ],
        },
      ],
      vias: [],
      unrouted: [],
    }
    return runDrc(board, { airwires: [], padBoxes: [] }, routing, DEFAULT_ROUTE_CLASS, {
      netVolts,
    }).map((v) => v.code)
  }

  test('two nets 300 V apart at a 0.5 mm gap are flagged voltage-clearance, not copper-clearance', () => {
    const c = codes(
      new Map([
        ['a', 300],
        ['b', 0],
      ]),
    )
    expect(c).toContain('voltage-clearance')
    expect(c).not.toContain('copper-clearance')
  })

  test('the same 0.5 mm gap at 5 V is clean (5 V needs only 0.1 mm — the fab floor already covers it)', () => {
    expect(
      codes(
        new Map([
          ['a', 5],
          ['b', 0],
        ]),
      ),
    ).not.toContain('voltage-clearance')
  })

  test('signed voltages: +150 V vs −150 V is a 300 V difference, not 0 — still flagged', () => {
    expect(
      codes(
        new Map([
          ['a', 150],
          ['b', -150],
        ]),
      ),
    ).toContain('voltage-clearance')
  })

  // The messages the voltage-clearance pass emits, for the same 0.5 mm-gap fixture.
  const vMessages = (netVolts: Map<string, number>): string[] => {
    const board: Board = { outline: { x: -5, y: -5, w: 40, h: 40 }, placements: [] }
    const routing = {
      traces: [
        {
          net: 'a',
          widthMm: 0.25,
          layer: 'top' as const,
          points: [
            { x: 0, y: 0 },
            { x: 5, y: 0 },
          ],
        },
        {
          net: 'b',
          widthMm: 0.25,
          layer: 'top' as const,
          points: [
            { x: 0, y: 0.75 },
            { x: 5, y: 0.75 },
          ],
        },
      ],
      vias: [],
      unrouted: [],
    }
    return runDrc(board, { airwires: [], padBoxes: [] }, routing, DEFAULT_ROUTE_CLASS, { netVolts })
      .filter((v) => v.code === 'voltage-clearance')
      .map((v) => v.message)
  }

  test('creepageMm matches IEC 60664-1 Table 4 (PD2, material group IIIa) and gates at the 60 V SELV limit', () => {
    expect(creepageMm(50)).toBe(0) // below SELV — no creepage safety requirement
    expect(creepageMm(60)).toBe(0) // at the SELV boundary
    expect(creepageMm(100)).toBeCloseTo(1.4, 6)
    expect(creepageMm(250)).toBeCloseTo(2.5, 6)
    expect(creepageMm(500)).toBeCloseTo(5.0, 6)
    expect(creepageMm(1000)).toBeCloseTo(10.0, 6)
  })

  test('above SELV, surface creepage (IEC 60664-1) governs and the message says so', () => {
    // 250 V: air clearance 1.25 mm, creepage 2.5 mm → creepage governs; the 0.5 mm gap is under it.
    const m = vMessages(
      new Map([
        ['a', 250],
        ['b', 0],
      ]),
    )
    expect(m).toHaveLength(1)
    expect(m[0]).toContain('creepage')
    expect(m[0]).toContain('2.5 mm')
  })

  test('below the 60 V SELV gate only air clearance applies — creepage does not govern', () => {
    // 50 V: air clearance 0.6 mm (over the 0.5 mm gap → flagged), creepage 0 (SELV) → clearance governs.
    const m = vMessages(
      new Map([
        ['a', 50],
        ['b', 0],
      ]),
    )
    expect(m).toHaveLength(1)
    expect(m[0]).toContain('air clearance')
    expect(m[0]).not.toContain('creepage')
  })
})

describe('Tier 0: thermal-via exemption (a filled same-net via array under a power pad is legit)', () => {
  const THERMAL = '__TEST_THERMAL_PAD__'
  const PLAIN = '__TEST_PLAIN_PAD__'
  afterEach(() => {
    delete BUILTIN_FOOTPRINTS[THERMAL]
    delete BUILTIN_FOOTPRINTS[PLAIN]
  })
  const bigPad = (id: string, thermal: boolean): Footprint => ({
    id,
    name: 'thermal pad',
    description: 'a large power pad, optionally thermal',
    pads: [
      {
        id: 'TH',
        center: { x: 0, y: 0 },
        size: { w: 4, h: 4 },
        shape: 'rect',
        type: 'smd',
        ...(thermal ? { thermal: true } : {}),
      },
    ],
    silkscreen: [],
    fabrication: [
      { from: { x: -1, y: -1 }, to: { x: 1, y: -1 }, width: 0.15 },
      { from: { x: 1, y: -1 }, to: { x: 1, y: 1 }, width: 0.15 },
      { from: { x: 1, y: 1 }, to: { x: -1, y: 1 }, width: 0.15 },
      { from: { x: -1, y: 1 }, to: { x: -1, y: -1 }, width: 0.15 },
    ],
    labels: { reference: { x: 0, y: 0 }, value: { x: 0, y: 0 }, fabReference: { x: 0, y: 0 } },
    courtyard: { x: -2.5, y: -2.5, w: 5, h: 5 },
    provenance: { source_type: 'reference', title: 't', citation: 't', confidence: 'high' },
  })
  const board: Board = {
    outline: { x: -5, y: -5, w: 30, h: 30 },
    placements: [
      { partId: 'U1', footprintId: THERMAL, x: 10, y: 10, rotation: 0, designator: 'U1' },
    ],
  }
  const withId = (id: string): Board => ({
    ...board,
    placements: [{ ...board.placements[0], footprintId: id } as (typeof board.placements)[number]],
  })
  const rn = (padNet: string) => ({
    airwires: [],
    padBoxes: [{ net: padNet, pad: 'U1/TH', throughHole: false, x: 8, y: 8, w: 4, h: 4 }],
  })
  const viaAt = (net: string) => ({
    traces: [],
    vias: [{ net, at: { x: 10, y: 10 }, diameterMm: 0.4, drillMm: 0.2 }],
    unrouted: [],
  })
  const inPad = (id: string, padNet: string, viaNet: string) => {
    BUILTIN_FOOTPRINTS[id] = bigPad(id, id === THERMAL)
    return runDrc(withId(id), rn(padNet), viaAt(viaNet)).filter((v) => v.code === 'via-in-pad')
  }

  test('a SAME-net via inside a THERMAL pad is exempt (deliberate filled thermal array)', () => {
    expect(inPad(THERMAL, 'GND', 'GND')).toHaveLength(0)
  })
  test('a DIFFERENT-net via inside a thermal pad is still flagged (a foreign via is a defect)', () => {
    expect(inPad(THERMAL, 'GND', 'VCC')).toHaveLength(1)
  })
  test('a same-net via inside a NON-thermal pad is still flagged (unintentional via-in-pad)', () => {
    expect(inPad(PLAIN, 'GND', 'GND')).toHaveLength(1)
  })
})

describe('Tier 0: min plated drill = max(0.15 mm, board thickness ÷ 8)', () => {
  const viaSize = (drillMm: number, thicknessMm?: number): string[] => {
    const board: Board = { outline: { x: 0, y: 0, w: 20, h: 20 }, placements: [] }
    const routing = {
      traces: [],
      // diameter = drill + 0.3 → a healthy 0.15 mm annular, so only the DRILL floor can flag it
      vias: [{ net: 'n', at: { x: 10, y: 10 }, diameterMm: drillMm + 0.3, drillMm }],
      unrouted: [],
    }
    const opts = thicknessMm === undefined ? {} : { boardThicknessMm: thicknessMm }
    return runDrc(board, { airwires: [], padBoxes: [] }, routing, DEFAULT_ROUTE_CLASS, opts)
      .filter((v) => v.code === 'via-size')
      .map((v) => v.code)
  }

  test('minDrillMm: 1.0 mm→0.15 (hard floor), 1.6 mm→0.20, 2.4 mm→0.30, omitted→0.30 (fail-safe)', () => {
    expect(minDrillMm(1.0)).toBeCloseTo(0.15, 6)
    expect(minDrillMm(1.6)).toBeCloseTo(0.2, 6)
    expect(minDrillMm(2.4)).toBeCloseTo(0.3, 6)
    expect(minDrillMm(undefined)).toBeCloseTo(0.3, 6)
  })

  test('a 0.2 mm via drill: fine on a thin 1.0 mm board, flagged on a thick 2.4 mm board', () => {
    expect(viaSize(0.2, 1.0)).not.toContain('via-size') // 0.2 ≥ 0.15 floor — the old flat 0.3 over-rejected it
    expect(viaSize(0.2, 2.4)).toContain('via-size') // 0.2 < 0.30 (aspect ratio on a thick board)
    expect(viaSize(0.18, 1.6)).toContain('via-size') // 0.18 < 0.20 on a standard board
  })
})

describe('Tier 0: component-to-edge assembly keepout (3 mm SMT rail)', () => {
  test('an auto-derived board passes — its 3 mm margin clears the keepout (no false-positive)', () => {
    expect(COMPONENT_EDGE_KEEPOUT_MM).toBe(3)
    const defs: [string, string][] = [
      ['R1', 'resistor'],
      ['R2', 'resistor'],
    ]
    const board = deriveBoard(parts(defs))
    const rn = computeRatsnest(world(defs, [['R1', 'terminal_b', 'R2', 'terminal_a']]), board)
    expect(runDrc(board, rn, routeBoard(rn)).some((v) => v.code === 'component-edge')).toBe(false)
  })

  test("a part body within 3 mm of the edge is flagged; a centred part isn't", () => {
    const at = (x: number): Board => ({
      outline: { x: 0, y: 0, w: 20, h: 20 },
      placements: [
        { partId: 'R1', footprintId: 'R_0603_1608Metric', x, y: 10, rotation: 0, designator: 'R1' },
      ],
    })
    const edgeCodes = (b: Board) =>
      runDrc(b, { airwires: [], padBoxes: [] }, { traces: [], vias: [], unrouted: [] }).filter(
        (v) => v.code === 'component-edge',
      )
    expect(edgeCodes(at(1))).toHaveLength(1) // body ~0.2 mm from the left edge
    expect(edgeCodes(at(10))).toHaveLength(0) // centred — ≥ 3 mm all round
  })
})

describe('Tier 0: single-board size window (too small must panelize, too large exceeds the panel)', () => {
  const sized = (w: number, h: number) => {
    const board: Board = { outline: { x: 0, y: 0, w, h }, placements: [] }
    const rn = { airwires: [], padBoxes: [] }
    const routing = { traces: [], vias: [], unrouted: [] }
    return runDrc(board, rn, routing).filter((v) => v.code === 'board-size')
  }

  test('the size window is 3 mm – 500 mm per side', () => {
    expect(MIN_BOARD_MM).toBe(3)
    expect(MAX_BOARD_MM).toBe(500)
  })

  test('a normal board (17 × 8 mm) passes; a 2 mm board is flagged too-small; a 600 mm board too-large', () => {
    expect(sized(17, 8)).toHaveLength(0)
    expect(sized(2, 2)[0]?.message).toContain('panelized')
    expect(sized(600, 600)[0]?.message).toContain('quote')
  })

  test('a pathological 2 × 600 mm outline reports BOTH reasons (too narrow AND too long)', () => {
    const v = sized(2, 600)
    expect(v).toHaveLength(2)
    expect(v.some((d) => d.message.includes('panelized'))).toBe(true)
    expect(v.some((d) => d.message.includes('quote'))).toBe(true)
  })
})

describe('runDrc — absolute copper-clearance floor (a net class cannot be tightened below the fab min)', () => {
  // Two parallel top-layer traces (width 0.25) of DIFFERENT nets; clearanceViolations flags them when the
  // copper EDGES are closer than the enforced clearance (centreline gap ≤ width + clearance).
  const twoTraces = (centreGapMm: number) => ({
    traces: [
      {
        net: 'a',
        widthMm: 0.25,
        layer: 'top' as const,
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
        ],
      },
      {
        net: 'b',
        widthMm: 0.25,
        layer: 'top' as const,
        points: [
          { x: 0, y: centreGapMm },
          { x: 5, y: centreGapMm },
        ],
      },
    ],
    vias: [],
    unrouted: [],
  })
  const board: Board = { outline: { x: -5, y: -5, w: 30, h: 30 }, placements: [] }
  const rn = { airwires: [], padBoxes: [] }
  const tight = { ...DEFAULT_ROUTE_CLASS, clearanceMm: 0.05 } // user tightened BELOW the 0.127 mm floor
  const clearance = (result: ReturnType<typeof runDrc>) =>
    result.filter((d) => d.code === 'copper-clearance')

  test('a 0.1 mm copper gap that CLEARS the tightened 0.05 mm class is still flagged (below the 0.127 mm floor)', () => {
    // centre gap 0.35 → edge gap 0.1 mm: > the 0.05 class (would be clean) but < the 0.127 fab floor
    const flagged = clearance(runDrc(board, rn, twoTraces(0.35), tight))
    expect(flagged.length).toBeGreaterThan(0)
    expect(flagged[0]?.message).toContain('fab minimum')
  })

  test('a comfortable 0.2 mm copper gap on the same tight class is clean (above the floor)', () => {
    // centre gap 0.45 → edge gap 0.2 mm ≥ the 0.127 fab floor
    expect(clearance(runDrc(board, rn, twoTraces(0.45), tight))).toHaveLength(0)
  })
})

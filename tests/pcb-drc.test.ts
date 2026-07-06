/**
 * Board DRC. Jobs: a legal board passes clean; parts dragged into collision are caught by the
 * courtyard rule; different nets' pad copper too close is a clearance violation with a real
 * position; copper hugging the board edge is caught with the cited 0.3 mm fab limit; and every rule
 * carries provenance (the anti-placeholder rule applies to manufacturing limits too).
 */
import { describe, expect, test } from 'vitest'
import { canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { BUILTIN_FOOTPRINTS } from '../src/renderer/footprint.ts'
import { type BoardPart, computeRatsnest, deriveBoard } from '../src/renderer/pcb-board.ts'
import { DRC_RULES, runDrc } from '../src/renderer/pcb-drc.ts'
import { routeBoard } from '../src/renderer/pcb-route.ts'

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
  })
})

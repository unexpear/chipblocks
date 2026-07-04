/**
 * The copper router. Jobs: a same-row pair routes as one straight trace at the CITED width between
 * the exact pad centres; two nets forced to cross route legally (the second detours — proven by the
 * clearance audit, not eyeballed); same-net copper may touch; what can't route is counted in
 * `unrouted`, never drawn as copper it isn't. These are the invariants the DRC and Gerber bricks
 * build on.
 */
import { describe, expect, test } from 'vitest'
import { canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import {
  type BoardPart,
  computeRatsnest,
  deriveBoard,
  type Ratsnest,
} from '../src/renderer/pcb-board.ts'
import {
  clearanceViolations,
  DEFAULT_ROUTE_CLASS,
  routeBoard,
  VIA_RULES,
} from '../src/renderer/pcb-route.ts'

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

test('the route class is cited (anti-placeholder rule applies to copper too)', () => {
  expect(DEFAULT_ROUTE_CLASS.traceWidthMm).toBeGreaterThan(0)
  expect(DEFAULT_ROUTE_CLASS.clearanceMm).toBeGreaterThan(0)
  expect(DEFAULT_ROUTE_CLASS.provenance.citation.length).toBeGreaterThan(10)
  expect(DEFAULT_ROUTE_CLASS.provenance.confidence).toBe('high')
})

describe('routeBoard', () => {
  test('a same-row pair routes as ONE straight trace between the exact pad centres', () => {
    const defs: [string, string][] = [
      ['R1', 'resistor'],
      ['R2', 'resistor'],
    ]
    const board = deriveBoard(parts(defs))
    const rn = computeRatsnest(world(defs, [['R1', 'terminal_b', 'R2', 'terminal_a']]), board)
    const routing = routeBoard(rn)
    expect(routing.unrouted).toHaveLength(0)
    expect(routing.traces).toHaveLength(1)
    const t = routing.traces[0]
    if (t === undefined) throw new Error('missing trace')
    expect(t.widthMm).toBe(DEFAULT_ROUTE_CLASS.traceWidthMm)
    expect(t.points).toHaveLength(2) // straight — no corners invented
    const aw = rn.airwires[0]
    if (aw === undefined) throw new Error('missing airwire')
    expect([t.points[0], t.points[t.points.length - 1]]).toContainEqual(aw.from)
    expect([t.points[0], t.points[t.points.length - 1]]).toContainEqual(aw.to)
  })

  test('two nets forced to cross both route, and the result passes the clearance audit', () => {
    // Net A runs horizontally between R1 and R2; net B connects R3 (above) to R4 (below) straight
    // through net A's path — the router must detour one of them, never overlap different-net copper.
    const defs: [string, string][] = [
      ['R1', 'resistor'],
      ['R2', 'resistor'],
      ['R3', 'resistor'],
      ['R4', 'resistor'],
    ]
    const overrides = new Map([
      ['R1', { x: 0, y: 0, rotation: 0 as const }],
      ['R2', { x: 20, y: 0, rotation: 0 as const }],
      ['R3', { x: 10, y: -8, rotation: 90 as const }],
      ['R4', { x: 10, y: 8, rotation: 90 as const }],
    ])
    const board = deriveBoard(parts(defs), overrides)
    const rn = computeRatsnest(
      world(defs, [
        ['R1', 'terminal_b', 'R2', 'terminal_a'],
        ['R3', 'terminal_b', 'R4', 'terminal_a'],
      ]),
      board,
    )
    expect(rn.airwires).toHaveLength(2)
    const routing = routeBoard(rn)
    expect(routing.unrouted).toHaveLength(0)
    expect(routing.traces).toHaveLength(2)
    // one of the two must have detoured (more than a straight run + L corner)
    expect(clearanceViolations(routing, rn.padBoxes)).toEqual([])
  })

  test('same-net traces may share a pad (a junction net routes fully)', () => {
    const defs: [string, string][] = [
      ['R1', 'resistor'],
      ['R2', 'resistor'],
      ['R3', 'resistor'],
      ['J1', 'junction'],
    ]
    const board = deriveBoard(parts(defs))
    const rn = computeRatsnest(
      world(defs, [
        ['R1', 'terminal_b', 'J1', 'junction'],
        ['R2', 'terminal_a', 'J1', 'junction'],
        ['R3', 'terminal_a', 'J1', 'junction'],
      ]),
      board,
    )
    const routing = routeBoard(rn)
    expect(routing.traces).toHaveLength(2)
    expect(routing.unrouted).toHaveLength(0)
    expect(clearanceViolations(routing, rn.padBoxes)).toEqual([])
  })

  test('UNWIRED pads are still real copper — a trace detours around them, never through', () => {
    // R3 sits unwired directly between the wired pair. Its pads are copper on the fabbed board (a
    // trace crossing one is a soldered joint), so the route must clear them like any other net's.
    const defs: [string, string][] = [
      ['R1', 'resistor'],
      ['R2', 'resistor'],
      ['R3', 'resistor'],
    ]
    const overrides = new Map([
      ['R1', { x: 0, y: 0, rotation: 0 as const }],
      ['R2', { x: 20, y: 0, rotation: 0 as const }],
      ['R3', { x: 10, y: 0, rotation: 0 as const }],
    ])
    const board = deriveBoard(parts(defs), overrides)
    const rn = computeRatsnest(world(defs, [['R1', 'terminal_b', 'R2', 'terminal_a']]), board)
    // every placed pad is in the copper inventory: 3 parts × 2 pads
    expect(rn.padBoxes).toHaveLength(6)
    const routing = routeBoard(rn)
    expect(routing.unrouted).toHaveLength(0)
    const t = routing.traces[0]
    if (t === undefined) throw new Error('missing trace')
    expect(t.points.length).toBeGreaterThan(2) // detoured — not straight through R3's pads
    expect(clearanceViolations(routing, rn.padBoxes)).toEqual([])
  })

  test('stacked same-net pads owe NOTHING (copper already touches) — no zero-length airwire', () => {
    // R1 and R3 are stacked exactly; their wired-together pads coincide. That is copper on copper —
    // already connected — so the ratsnest owes no zero-length "connection" and the router never
    // fabricates an invisible one-point trace for it.
    const defs: [string, string][] = [
      ['R1', 'resistor'],
      ['R3', 'resistor'],
    ]
    const overrides = new Map([
      ['R1', { x: 0, y: 0, rotation: 0 as const }],
      ['R3', { x: 0, y: 0, rotation: 0 as const }],
    ])
    const board = deriveBoard(parts(defs), overrides)
    const rn = computeRatsnest(world(defs, [['R1', 'terminal_b', 'R3', 'terminal_b']]), board)
    expect(rn.airwires).toHaveLength(0)
    const routing = routeBoard(rn)
    expect(routing.traces).toHaveLength(0)
    expect(routing.unrouted).toHaveLength(0)
  })

  test('a crowded board still routes: the A* grid survives many bystander parts', () => {
    // 16 unwired parts scattered at distinct coordinates push the Hanan grid far past the old
    // 4096-node default that silently killed the A* rung — the crossing nets must still detour.
    const defs: [string, string][] = [
      ['R1', 'resistor'],
      ['R2', 'resistor'],
      ['R3', 'resistor'],
      ['R4', 'resistor'],
    ]
    const overrides = new Map([
      ['R1', { x: 0, y: 0, rotation: 0 as const }],
      ['R2', { x: 20, y: 0, rotation: 0 as const }],
      ['R3', { x: 10, y: -8, rotation: 90 as const }],
      ['R4', { x: 10, y: 8, rotation: 90 as const }],
    ])
    for (let i = 0; i < 16; i++) {
      const id = `B${i}`
      defs.push([id, 'resistor'])
      overrides.set(id, { x: 40 + 5.3 * i, y: 20 + 3.7 * i, rotation: 0 as const })
    }
    const board = deriveBoard(parts(defs), overrides)
    const rn = computeRatsnest(
      world(defs, [
        ['R1', 'terminal_b', 'R2', 'terminal_a'],
        ['R3', 'terminal_b', 'R4', 'terminal_a'],
      ]),
      board,
    )
    const routing = routeBoard(rn)
    expect(routing.unrouted).toHaveLength(0)
    expect(routing.traces).toHaveLength(2)
    expect(clearanceViolations(routing, rn.padBoxes)).toEqual([])
  })

  test('what cannot route is counted, never faked: a pad buried under another net stays an airwire', () => {
    // R3 is stacked DIRECTLY on top of R1 (the user can drag parts anywhere), so net B's endpoint
    // sits inside net A's pad copper — no legal single-layer route exists.
    const defs: [string, string][] = [
      ['R1', 'resistor'],
      ['R2', 'resistor'],
      ['R3', 'resistor'],
      ['R4', 'resistor'],
    ]
    const overrides = new Map([
      ['R1', { x: 0, y: 0, rotation: 0 as const }],
      ['R2', { x: 20, y: 0, rotation: 0 as const }],
      ['R3', { x: 0, y: 0, rotation: 0 as const }],
      ['R4', { x: 20, y: 6, rotation: 0 as const }],
    ])
    const board = deriveBoard(parts(defs), overrides)
    const rn = computeRatsnest(
      world(defs, [
        ['R1', 'terminal_b', 'R2', 'terminal_a'],
        ['R3', 'terminal_b', 'R4', 'terminal_a'],
      ]),
      board,
    )
    const routing = routeBoard(rn)
    expect(routing.traces.length + routing.unrouted.length).toBe(rn.airwires.length)
    expect(routing.unrouted.length).toBeGreaterThan(0)
    // whatever DID route is still legal copper. (The stacked PADS themselves are a pad-pad
    // clearance violation — that's the DRC's finding about the placement, not the router's output.)
    const traceViolations = clearanceViolations(routing, rn.padBoxes).filter(
      (v) => v.kind !== 'pad-pad',
    )
    expect(traceViolations).toEqual([])
    expect(clearanceViolations(routing, rn.padBoxes).some((v) => v.kind === 'pad-pad')).toBe(true)
  })
})

describe('the bottom layer through vias', () => {
  /** A signal pad walled in by a CLOSED ring of foreign copper — no top-layer escape exists (the
   *  A* grid cannot leave a closed box), so only a via to the bottom can carry it out. Hand-built
   *  ratsnest: geometry this airtight can't be arranged from real placements deterministically. */
  const walledIn = (wallsThroughHole: boolean, signalThroughHole: boolean): Ratsnest => ({
    airwires: [{ net: 'sig', from: { x: 0, y: 0 }, to: { x: 10, y: 0 } }],
    padBoxes: [
      {
        net: 'sig',
        pad: 'a/1',
        throughHole: signalThroughHole,
        x: -0.4,
        y: -0.475,
        w: 0.8,
        h: 0.95,
      },
      {
        net: 'sig',
        pad: 'b/1',
        throughHole: signalThroughHole,
        x: 9.6,
        y: -0.475,
        w: 0.8,
        h: 0.95,
      },
      // the closed 6×6 ring (inner cavity 4×4) around pad a — four wall strips, each its own net
      { net: 'wall:n', pad: 'w/1', throughHole: wallsThroughHole, x: -3, y: -3, w: 6, h: 1 },
      { net: 'wall:s', pad: 'w/2', throughHole: wallsThroughHole, x: -3, y: 2, w: 6, h: 1 },
      { net: 'wall:w', pad: 'w/3', throughHole: wallsThroughHole, x: -3, y: -2, w: 1, h: 4 },
      { net: 'wall:e', pad: 'w/4', throughHole: wallsThroughHole, x: 2, y: -2, w: 1, h: 4 },
    ],
  })

  test('an SMD pad walled in on top escapes through a via beside it — stub, via, bottom trace', () => {
    const rn = walledIn(false, false)
    const routing = routeBoard(rn)
    expect(routing.unrouted).toHaveLength(0)
    expect(routing.vias).toHaveLength(2) // one beside each SMD endpoint
    for (const v of routing.vias) {
      expect(v.diameterMm).toBe(DEFAULT_ROUTE_CLASS.viaDiameterMm)
      expect(v.drillMm).toBe(DEFAULT_ROUTE_CLASS.viaDrillMm)
    }
    const bottom = routing.traces.filter((t) => t.layer === 'bottom')
    const stubs = routing.traces.filter((t) => t.layer === 'top')
    expect(bottom).toHaveLength(1)
    expect(stubs).toHaveLength(2) // pad centre → via, on top, one per end
    // the whole arrangement is legal copper on both layers (pad-pad findings are the fixture's
    // own touching wall strips — the placement's problem, not the router's output)
    expect(clearanceViolations(routing, rn.padBoxes).filter((v) => v.kind !== 'pad-pad')).toEqual(
      [],
    )
  })

  test('a through-hole endpoint is already on the bottom — no via needed there', () => {
    const routing = routeBoard(walledIn(false, true))
    expect(routing.unrouted).toHaveLength(0)
    expect(routing.vias).toHaveLength(0)
    expect(routing.traces.filter((t) => t.layer === 'bottom')).toHaveLength(1)
    expect(routing.traces.filter((t) => t.layer === 'top')).toHaveLength(0)
  })

  test('walls of THROUGH-HOLE copper block both layers — the connection stays an honest airwire', () => {
    const routing = routeBoard(walledIn(true, false))
    expect(routing.unrouted).toHaveLength(1)
    expect(routing.vias).toHaveLength(0)
    expect(routing.traces).toHaveLength(0)
  })

  test('a same-net HUB reuses one via — never two drills stacked on one coordinate', () => {
    // Review-caught (executed by the reviewer): two airwires sharing a walled-in SMD endpoint
    // both dropped to the bottom and placed IDENTICAL vias — the fab would drill the same hole
    // twice, and the DRC flagged what the router had certified. The second connection must RIDE
    // the first via instead.
    const rn: Ratsnest = {
      airwires: [
        { net: 'sig', from: { x: 0, y: 0 }, to: { x: 10, y: 0 } },
        { net: 'sig', from: { x: 0, y: 0 }, to: { x: -10, y: 0 } },
      ],
      padBoxes: [
        { net: 'sig', pad: 'a/1', throughHole: false, x: -0.4, y: -0.475, w: 0.8, h: 0.95 },
        {
          net: 'sig',
          pad: 'b/1',
          throughHole: true,
          holeMm: 0.8,
          x: 9.6,
          y: -0.475,
          w: 0.8,
          h: 0.95,
        },
        {
          net: 'sig',
          pad: 'c/1',
          throughHole: true,
          holeMm: 0.8,
          x: -10.4,
          y: -0.475,
          w: 0.8,
          h: 0.95,
        },
        { net: 'wall:n', pad: 'w/1', throughHole: false, x: -3, y: -3, w: 6, h: 1 },
        { net: 'wall:s', pad: 'w/2', throughHole: false, x: -3, y: 2, w: 6, h: 1 },
        { net: 'wall:w', pad: 'w/3', throughHole: false, x: -3, y: -2, w: 1, h: 4 },
        { net: 'wall:e', pad: 'w/4', throughHole: false, x: 2, y: -2, w: 1, h: 4 },
      ],
    }
    const routing = routeBoard(rn)
    expect(routing.unrouted).toHaveLength(0)
    expect(routing.vias).toHaveLength(1) // ONE hole serves both connections
    // and every plated-hole pair keeps the cited gap (nothing for the DRC to reject)
    const holes = [
      ...routing.vias.map((v) => ({ at: v.at, d: v.drillMm })),
      ...rn.padBoxes
        .filter((p) => p.holeMm !== undefined)
        .map((p) => ({ at: { x: p.x + p.w / 2, y: p.y + p.h / 2 }, d: p.holeMm as number })),
    ]
    for (let i = 0; i < holes.length; i++) {
      for (let j = i + 1; j < holes.length; j++) {
        const a = holes[i] as (typeof holes)[number]
        const b = holes[j] as (typeof holes)[number]
        const gap = Math.hypot(a.at.x - b.at.x, a.at.y - b.at.y) - (a.d + b.d) / 2
        expect(gap).toBeGreaterThanOrEqual(VIA_RULES.hole_to_hole.limitMm)
      }
    }
  })

  test('a via never crowds a SAME-net component hole — the drill breaks out regardless of net', () => {
    // A same-net through-hole pad sits 1.8 mm east of the walled-in SMD pad: the east via spot
    // (1.2, 0) would leave only a 0.6 mm centre gap to its 0.8 mm hole (edge gap 0 < 0.25) — the
    // router must pick another side, not park a drill against its own net's hole.
    const rn: Ratsnest = {
      airwires: [{ net: 'sig', from: { x: 0, y: 0 }, to: { x: 10, y: 0 } }],
      padBoxes: [
        { net: 'sig', pad: 'a/1', throughHole: false, x: -0.4, y: -0.475, w: 0.8, h: 0.95 },
        { net: 'sig', pad: 't/1', throughHole: true, holeMm: 0.8, x: 1.4, y: -0.4, w: 0.8, h: 0.8 },
        {
          net: 'sig',
          pad: 'b/1',
          throughHole: true,
          holeMm: 0.8,
          x: 9.6,
          y: -0.475,
          w: 0.8,
          h: 0.95,
        },
        { net: 'wall:n', pad: 'w/1', throughHole: false, x: -3, y: -3, w: 6, h: 1 },
        { net: 'wall:s', pad: 'w/2', throughHole: false, x: -3, y: 2, w: 6, h: 1 },
        { net: 'wall:w', pad: 'w/3', throughHole: false, x: -3, y: -2, w: 1, h: 4 },
        { net: 'wall:e', pad: 'w/4', throughHole: false, x: 2, y: -2, w: 1, h: 4 },
      ],
    }
    const routing = routeBoard(rn)
    expect(routing.unrouted).toHaveLength(0)
    const via = routing.vias[0]
    if (via === undefined) throw new Error('no via placed')
    // the crowded east spot is refused; the drill gap to the same-net hole stays legal
    const gap = Math.hypot(via.at.x - 1.8, via.at.y - 0) - (via.drillMm + 0.8) / 2
    expect(gap).toBeGreaterThanOrEqual(VIA_RULES.hole_to_hole.limitMm)
  })

  test('the via rules the router builds to are cited (drill floor, annular ring, hole spacing)', () => {
    for (const rule of Object.values(VIA_RULES)) {
      expect(rule.limitMm).toBeGreaterThan(0)
      expect(rule.provenance.citation.length).toBeGreaterThan(10)
      expect(rule.provenance.confidence).toBe('high')
    }
    // the class via satisfies its own rules: drill ≥ floor, ring ≥ minimum
    expect(DEFAULT_ROUTE_CLASS.viaDrillMm).toBeGreaterThanOrEqual(VIA_RULES.min_drill.limitMm)
    expect(
      (DEFAULT_ROUTE_CLASS.viaDiameterMm - DEFAULT_ROUTE_CLASS.viaDrillMm) / 2,
    ).toBeGreaterThanOrEqual(VIA_RULES.min_annular.limitMm)
  })
})

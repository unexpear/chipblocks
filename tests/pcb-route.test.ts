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
  copperConnects,
  DEFAULT_ROUTE_CLASS,
  gridRouteMultiLayer,
  gridRouteTwoLayer,
  routableCopperLayers,
  routeBoard,
  twoLayerConnects,
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

  test('the auto-router never drops a via INSIDE a pad (via-in-pad — solder wicking)', () => {
    // the SMD-walled case forces beside-pad vias; every one must clear every pad's copper
    const rn = walledIn(false, false)
    const routing = routeBoard(rn)
    expect(routing.vias.length).toBeGreaterThan(0)
    for (const v of routing.vias) {
      const bx = v.at.x - v.diameterMm / 2
      const by = v.at.y - v.diameterMm / 2
      for (const pad of rn.padBoxes) {
        const overlaps =
          bx < pad.x + pad.w &&
          pad.x < bx + v.diameterMm &&
          by < pad.y + pad.h &&
          pad.y < by + v.diameterMm
        expect(overlaps).toBe(false) // no via barrel intersects any pad — including its own net's
      }
    }
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

  test('MID-ROUTE layer switching: dive under a top wall, surface past the bottom walls', () => {
    // The layer sandwich neither single layer can cross: the TOP is walled at x=10; the BOTTOM is
    // walled at x=2 and x=18 (as committed bottom traces of other nets would be). The only way
    // from (0,0) to (20,0) is top → via → bottom under the top wall → via → top: two vias
    // MID-ROUTE — the endpoint-only strategy has no answer here.
    const topWall = { x: 9.5, y: -40, w: 1, h: 80 }
    const bottomWalls = [
      { x: 1.5, y: -40, w: 1, h: 80 },
      { x: 17.5, y: -40, w: 1, h: 80 },
    ]
    const route = gridRouteTwoLayer(
      { x: 0, y: 0 },
      ['top'],
      { x: 20, y: 0 },
      ['top'],
      { top: [topWall], bottom: bottomWalls },
      () => true, // via legality probed by the caller in routeBoard; here the field is open
    )
    if (route === null) throw new Error('two-layer route not found')
    expect(route.viaAt).toHaveLength(2)
    expect(route.runs.map((r) => r.layer)).toEqual(['top', 'bottom', 'top'])
    // the bottom run really is the one crossing the top wall's x, and the vias flank it
    const bottom = route.runs[1]
    if (bottom === undefined) throw new Error('missing bottom run')
    const xs = bottom.points.map((p) => p.x)
    expect(Math.min(...xs)).toBeLessThan(9.5)
    expect(Math.max(...xs)).toBeGreaterThan(10.5)
    // every run stays clear of ITS layer's walls
    for (const run of route.runs) {
      const walls = run.layer === 'top' ? [topWall] : bottomWalls
      for (let i = 0; i < run.points.length - 1; i++) {
        const a = run.points[i] as { x: number; y: number }
        const b = run.points[i + 1] as { x: number; y: number }
        for (const wall of walls) {
          const hitsX = Math.min(a.x, b.x) < wall.x + wall.w && Math.max(a.x, b.x) > wall.x
          const hitsY = Math.min(a.y, b.y) < wall.y + wall.h && Math.max(a.y, b.y) > wall.y
          expect(hitsX && hitsY).toBe(false)
        }
      }
    }
  })

  test('a flip AT an SMD endpoint keeps its via — the route connects, never a silent open', () => {
    // Review-caught (HIGH): when the two-layer A* flipped to the other layer exactly AT an
    // endpoint, the earlier "derive vias from surviving runs" logic dropped that endpoint's via.
    // For a top-only SMD pad that via is the SOLE bridge from the bottom run up to the pad — its
    // loss left the net electrically OPEN while the router reported success and the DRC (which
    // checks spacing, not continuity) stayed clean. This forces a flip at the goal: the bottom is
    // clear, the top is walled everywhere EXCEPT a tiny window right at the goal, so the cheapest
    // route runs on the bottom and only surfaces to the top at the very last point.
    const bigTopWall = { x: 0.5, y: -40, w: 18, h: 80 } // blocks the top across the whole span
    const route = gridRouteTwoLayer(
      { x: 0, y: 0 },
      ['top'],
      { x: 20, y: 0 },
      ['top'],
      { top: [bigTopWall], bottom: [] },
      () => true,
    )
    if (route === null) throw new Error('two-layer route not found')
    // whatever the shape, the emitted copper must actually connect the two top-only endpoints
    expect(twoLayerConnects(route, { x: 0, y: 0 }, ['top'], { x: 20, y: 0 }, ['top'])).toBe(true)
    // and there is a via wherever the path leaves/returns to the top pad layer
    expect(route.viaAt.length).toBeGreaterThanOrEqual(1)
  })

  test('routeBoard refuses (unrouted) any two-layer route its own copper does not connect', () => {
    // The end-to-end guard: two top-only SMD pads on one net, pad a boxed by other-net top copper
    // so the beside-pad via fails and the two-layer search runs; the connectivity self-check makes
    // the router commit ONLY a genuinely joined route, never a hidden open reported as success.
    const rn: Ratsnest = {
      airwires: [{ net: 'sig', from: { x: 0, y: 0 }, to: { x: 30, y: 0 } }],
      padBoxes: [
        { net: 'sig', pad: 'a/1', throughHole: false, x: -0.4, y: -0.475, w: 0.8, h: 0.95 },
        { net: 'sig', pad: 'b/1', throughHole: false, x: 29.6, y: -0.475, w: 0.8, h: 0.95 },
        // a closed top ring around pad a so no beside-pad via spot is legal
        { net: 'ring:n', pad: 'r/1', throughHole: false, x: -3, y: -3, w: 6, h: 1 },
        { net: 'ring:s', pad: 'r/2', throughHole: false, x: -3, y: 2, w: 6, h: 1 },
        { net: 'ring:w', pad: 'r/3', throughHole: false, x: -3, y: -2, w: 1, h: 4 },
        { net: 'ring:e', pad: 'r/4', throughHole: false, x: 2, y: -2, w: 1, h: 4 },
      ],
    }
    const routing = routeBoard(rn)
    // Whatever routeBoard decides — routed or unrouted — the committed copper must be self-
    // consistent: every airwire is either connected copper or an honest airwire, NEVER a
    // committed-but-open net. Rebuild the emitted route and prove its endpoints connect.
    if (routing.unrouted.length === 0) {
      const runs = routing.traces
        .filter((t) => t.net === 'sig')
        .map((t) => ({ layer: t.layer, points: t.points }))
      const viaAt = routing.vias.filter((v) => v.net === 'sig').map((v) => v.at)
      expect(
        twoLayerConnects({ runs, viaAt }, { x: 0, y: 0 }, ['top'], { x: 30, y: 0 }, ['top']),
      ).toBe(true)
    } else {
      // refused honestly — no phantom copper committed for it
      expect(routing.traces.filter((t) => t.net === 'sig')).toEqual([])
      expect(routing.vias.filter((v) => v.net === 'sig')).toEqual([])
    }
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

describe('the routable-layer model — inner copper layers', () => {
  test('routableCopperLayers lists the copper layers in stack order for 2 / 4 / 6', () => {
    expect(routableCopperLayers(2)).toEqual(['top', 'bottom'])
    expect(routableCopperLayers(4)).toEqual(['top', 'inner1', 'inner2', 'bottom'])
    expect(routableCopperLayers(6)).toEqual([
      'top',
      'inner1',
      'inner2',
      'inner3',
      'inner4',
      'bottom',
    ])
  })

  test('a plated through-via joins an inner-layer trace to a top-layer trace', () => {
    // A top run reaches the via point; an inner1 run leaves it. Without the via they are separate
    // layers; the through-via bridges them so the two ends connect.
    const via = [{ net: 'n', at: { x: 5, y: 0 }, diameterMm: 0.6, drillMm: 0.4 }]
    const traces = [
      {
        net: 'n',
        widthMm: 0.25,
        layer: 'top' as const,
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
        ],
      },
      {
        net: 'n',
        widthMm: 0.25,
        layer: 'inner1' as const,
        points: [
          { x: 5, y: 0 },
          { x: 10, y: 0 },
        ],
      },
    ]
    expect(copperConnects({ x: 0, y: 0 }, { x: 10, y: 0 }, traces, via)).toBe(true)
    // …and with NO via the top and inner1 copper don't touch → not connected.
    expect(copperConnects({ x: 0, y: 0 }, { x: 10, y: 0 }, traces, [])).toBe(false)
  })

  test('the 2-layer via join is unchanged — top↔bottom still connects through a via', () => {
    const via = [{ net: 'n', at: { x: 5, y: 0 }, diameterMm: 0.6, drillMm: 0.4 }]
    const traces = [
      {
        net: 'n',
        widthMm: 0.25,
        layer: 'top' as const,
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
        ],
      },
      {
        net: 'n',
        widthMm: 0.25,
        layer: 'bottom' as const,
        points: [
          { x: 5, y: 0 },
          { x: 10, y: 0 },
        ],
      },
    ]
    expect(copperConnects({ x: 0, y: 0 }, { x: 10, y: 0 }, traces, via)).toBe(true)
  })
})

describe('the 4-layer auto-router — gridRouteMultiLayer across inner copper', () => {
  // A CLOSED ring of copper around the origin — the same airtight geometry the two-layer via tests
  // rely on: the A* grid cannot leave a closed box, so a pad boxed in by this ring on a layer has
  // NO route out on that layer. Reused on top AND bottom below to force a dive to an inner layer.
  const ring = () => [
    { x: -3, y: -3, w: 6, h: 1 },
    { x: -3, y: 2, w: 6, h: 1 },
    { x: -3, y: -2, w: 1, h: 4 },
    { x: 2, y: -2, w: 1, h: 4 },
  ]

  test('the 2-layer wrapper is EXACTLY the general N-layer router (no regression)', () => {
    const wall = { x: 9.5, y: -40, w: 1, h: 80 }
    const args = [{ x: 0, y: 0 }, ['top'] as const, { x: 20, y: 0 }, ['top'] as const] as const
    const viaOk = () => true
    const viaWrapper = gridRouteTwoLayer(
      args[0],
      args[1],
      args[2],
      args[3],
      { top: [wall], bottom: [] },
      viaOk,
    )
    const viaGeneral = gridRouteMultiLayer(
      args[0],
      args[1],
      args[2],
      args[3],
      [[wall], []],
      ['top', 'bottom'],
      viaOk,
    )
    expect(viaWrapper).toEqual(viaGeneral)
  })

  test('a pad boxed in on BOTH outer layers escapes through an INNER layer', () => {
    // The origin pad (a through-hole pad, present on every layer) is walled in by a CLOSED ring on
    // the TOP and an identical CLOSED ring on the BOTTOM — neither outer layer can carry it out. Only
    // the open inner layers can. This is the capability 2 layers physically cannot provide.
    const layers = routableCopperLayers(4) // ['top','inner1','inner2','bottom']
    const route = gridRouteMultiLayer(
      { x: 0, y: 0 },
      layers, // through-hole start: on every layer
      { x: 20, y: 0 },
      ['top'], // surface to a top-only pad at the far end
      [ring(), [], [], ring()], // top & bottom ringed; inner1 / inner2 open
      layers,
      () => true,
    )
    if (route === null) throw new Error('no inner-layer route found')
    // it genuinely connects the two endpoints through its committed copper…
    expect(twoLayerConnects(route, { x: 0, y: 0 }, layers, { x: 20, y: 0 }, ['top'])).toBe(true)
    // …and it actually used an inner layer to do it (the whole point)
    const innerRun = route.runs.find((r) => r.layer === 'inner1' || r.layer === 'inner2')
    expect(innerRun).toBeDefined()
    // and there is a via wherever it surfaces from the inner layer to the top pad
    expect(route.viaAt.length).toBeGreaterThanOrEqual(1)
  })

  test('the SAME box is unroutable on 2 layers — the inner layers are what unlock it', () => {
    // Identical geometry, but only top + bottom exist: the pad is enclosed on both, so there is no
    // way out at all. Proves the inner layers (not some detour) are doing the work above.
    const route = gridRouteTwoLayer(
      { x: 0, y: 0 },
      ['top', 'bottom'],
      { x: 20, y: 0 },
      ['top'],
      { top: ring(), bottom: ring() },
      () => true,
    )
    expect(route).toBeNull()
  })

  test('routeBoard threads the copper-layer count through — a 4-layer board still routes + connects', () => {
    // The end-to-end plumbing: the same walled-in SMD board the 2-layer router handles must still
    // route on a 4-layer board, and its committed copper must genuinely connect (no regression from
    // widening the layer set). The bottom is open here, so it uses it — but the layer count flows all
    // the way to gridRouteMultiLayer and back.
    const rn: Ratsnest = {
      airwires: [{ net: 'sig', from: { x: 0, y: 0 }, to: { x: 10, y: 0 } }],
      padBoxes: [
        { net: 'sig', pad: 'a/1', throughHole: false, x: -0.4, y: -0.475, w: 0.8, h: 0.95 },
        { net: 'sig', pad: 'b/1', throughHole: false, x: 9.6, y: -0.475, w: 0.8, h: 0.95 },
        { net: 'wall:n', pad: 'w/1', throughHole: false, x: -3, y: -3, w: 6, h: 1 },
        { net: 'wall:s', pad: 'w/2', throughHole: false, x: -3, y: 2, w: 6, h: 1 },
        { net: 'wall:w', pad: 'w/3', throughHole: false, x: -3, y: -2, w: 1, h: 4 },
        { net: 'wall:e', pad: 'w/4', throughHole: false, x: 2, y: -2, w: 1, h: 4 },
      ],
    }
    const routing = routeBoard(rn, DEFAULT_ROUTE_CLASS, 4)
    expect(routing.unrouted).toHaveLength(0)
    const sig = routing.traces.filter((t) => t.net === 'sig')
    const vias = routing.vias.filter((v) => v.net === 'sig')
    expect(copperConnects({ x: 0, y: 0 }, { x: 10, y: 0 }, sig, vias)).toBe(true)
    // every emitted trace sits on a layer that a 4-layer board actually has
    for (const t of routing.traces) expect(routableCopperLayers(4)).toContain(t.layer)
  })
})

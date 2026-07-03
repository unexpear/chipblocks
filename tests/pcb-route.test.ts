/**
 * The copper router. Jobs: a same-row pair routes as one straight trace at the CITED width between
 * the exact pad centres; two nets forced to cross route legally (the second detours — proven by the
 * clearance audit, not eyeballed); same-net copper may touch; what can't route is counted in
 * `unrouted`, never drawn as copper it isn't. These are the invariants the DRC and Gerber bricks
 * build on.
 */
import { describe, expect, test } from 'vitest'
import { canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { type BoardPart, computeRatsnest, deriveBoard } from '../src/renderer/pcb-board.ts'
import { clearanceViolations, DEFAULT_ROUTE_CLASS, routeBoard } from '../src/renderer/pcb-route.ts'

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

/**
 * FPGA fabric — Stage 1, Engine #2: the PathFinder router (fpga-router.ts).
 * Proves the router turns logical nets into a legal, congestion-free ON-pip set on the real generated RRG,
 * and — crucially — that its output is ELECTRICALLY valid: feeding its pips to fpga-sim's bridgeToSim and
 * running stepLogic, each sink reads its own source (and only its own — no accidental short between nets).
 * Also proves negotiation actually happens (a contended pair that only routes once history detours one net),
 * that an impossible design fails HONESTLY (routed:false + the overused nodes), and that the mapper's LUTs
 * drive each other across a routed interconnect end to end.
 */
import { describe, expect, test } from 'vitest'
import { type RouteNet, type RouteResult, routeDesign } from '../src/renderer/fpga-router.ts'
import { DEFAULT_FABRIC_ARCH, generateFabric } from '../src/renderer/fpga-rrg.ts'
import { bridgeToSim, type PlacedLut } from '../src/renderer/fpga-sim.ts'
import { stepLogic } from '../src/renderer/logic-sim.ts'

/** A 1-input buffer LUT (out = in) placed to drive `output`, for probing a route electrically. */
const buffer = (input: string, output: string): PlacedLut => ({
  config: [false, true],
  inputs: [input],
  output,
})

/**
 * Independently of the router's own occupancy bookkeeping, re-derive how many distinct nets' trees use each
 * node and assert none exceeds capacity 1. This catches an occupancy under-count on ANY node class (chany,
 * opin, ipin — not just the chanx the negotiation test happens to contend), which would otherwise ship
 * routed:true + a real electrical short.
 */
const assertNoSharedNode = (res: RouteResult): void => {
  const usedByNets = new Map<string, number>()
  for (const r of res.routes.values())
    for (const id of r.nodes) usedByNets.set(id, (usedByNets.get(id) ?? 0) + 1)
  for (const [id, count] of usedByNets)
    expect(
      count,
      `node ${id} is shared by ${count} nets (would short in the sim)`,
    ).toBeLessThanOrEqual(1)
}

const AND2 = [false, false, false, true]
const OR2 = [false, true, true, true]

describe('routeDesign — a single net routes and is electrically valid through bridgeToSim', () => {
  test('src(0,0) → sink(2,2) routes, and the sink reads the source across the routed pips', () => {
    const fabric = generateFabric(DEFAULT_FABRIC_ARCH, 3, 3)
    const res = routeDesign(fabric.rrg, [{ id: 'n', source: 'src_0_0', sinks: ['sink_2_2'] }])
    expect(res.routed).toBe(true)
    expect(res.overused).toEqual([])
    expect(res.onPips.size).toBeGreaterThan(0)
    // every ON pip is a real fabric pip
    const pipIds = new Set(fabric.rrg.pips.map((p) => p.id))
    for (const id of res.onPips) expect(pipIds.has(id)).toBe(true)

    // a LUT driving src_0_0 must reach sink_2_2 THROUGH the route (and follow it up and down)
    const drv = buffer('in', 'src_0_0')
    const hi = stepLogic(bridgeToSim(fabric.rrg, res.onPips, [drv], [{ node: 'in', high: true }]))
    const lo = stepLogic(bridgeToSim(fabric.rrg, res.onPips, [drv], [{ node: 'in', high: false }]))
    expect(hi.value('sink_2_2', '')).toBe(true)
    expect(lo.value('sink_2_2', '')).toBe(false)
  })

  test('an UNROUTED sink stays undriven — the router never fakes reachability it did not route', () => {
    const fabric = generateFabric(DEFAULT_FABRIC_ARCH, 3, 3)
    const res = routeDesign(fabric.rrg, [{ id: 'n', source: 'src_0_0', sinks: ['sink_2_2'] }])
    const drv = buffer('in', 'src_0_0')
    // sink_1_1 was never part of any net's route → its own net, no driver
    const sim = stepLogic(bridgeToSim(fabric.rrg, res.onPips, [drv], [{ node: 'in', high: true }]))
    expect(sim.value('sink_2_2', '')).toBe(true)
    expect(sim.value('sink_1_1', '')).toBeUndefined()
  })
})

describe('routeDesign — a multi-sink net is one shared tree', () => {
  test('src(1,1) fans out to sink(0,0) and sink(2,2); both read the source', () => {
    const fabric = generateFabric(DEFAULT_FABRIC_ARCH, 3, 3)
    const res = routeDesign(fabric.rrg, [
      { id: 'n', source: 'src_1_1', sinks: ['sink_0_0', 'sink_2_2'] },
    ])
    expect(res.routed).toBe(true)
    const r = res.routes.get('n')
    expect(r?.nodes).toContain('src_1_1')
    expect(r?.nodes).toContain('sink_0_0')
    expect(r?.nodes).toContain('sink_2_2')

    const drv = buffer('in', 'src_1_1')
    const sim = stepLogic(bridgeToSim(fabric.rrg, res.onPips, [drv], [{ node: 'in', high: true }]))
    expect(sim.value('sink_0_0', '')).toBe(true)
    expect(sim.value('sink_2_2', '')).toBe(true)
  })
})

describe('routeDesign — independent nets route without shorting together', () => {
  test('two nets both route, no overuse, and each sink reads only its OWN source', () => {
    const fabric = generateFabric(DEFAULT_FABRIC_ARCH, 3, 3)
    const nets: RouteNet[] = [
      { id: 'a', source: 'src_0_0', sinks: ['sink_0_2'] },
      { id: 'b', source: 'src_2_0', sinks: ['sink_2_2'] },
    ]
    const res = routeDesign(fabric.rrg, nets)
    expect(res.routed).toBe(true)
    expect(res.overused).toEqual([])
    assertNoSharedNode(res) // no node shared across the two nets (independent of the router's own bookkeeping)

    // drive A high and B low: if the two routes shorted, the sinks would agree; they must not.
    const drvA = buffer('ia', 'src_0_0')
    const drvB = buffer('ib', 'src_2_0')
    const sim = stepLogic(
      bridgeToSim(
        fabric.rrg,
        res.onPips,
        [drvA, drvB],
        [
          { node: 'ia', high: true },
          { node: 'ib', high: false },
        ],
      ),
    )
    expect(sim.value('sink_0_2', '')).toBe(true) // A's value
    expect(sim.value('sink_2_2', '')).toBe(false) // B's value — electrically separate
  })
})

describe('routeDesign — negotiation resolves a contended channel', () => {
  test('two counter-nets over a width-1 fabric route only via the negotiation loop, and history speeds it', () => {
    // 3×2 grid, ONE track per channel: both nets want row-0's single track (chanx_0_0) by shortest path, so
    // iteration 0 collides. Resolving it needs the negotiation loop (rip-up + rising congestion cost), not a
    // first pass — the loser only reaches its sink via a row-1 detour once the shared track is expensive
    // enough. History converges it fast: 2 iterations here, where present-cost escalation ALONE (historyFac 0)
    // takes 5. The two bounds below pin BOTH facts — a first greedy pass did not suffice, and history did its job.
    const narrow = generateFabric({ ...DEFAULT_FABRIC_ARCH, channelWidth: 1, fs: 1 }, 3, 2)
    const res = routeDesign(narrow.rrg, [
      { id: 'a', source: 'src_0_0', sinks: ['sink_2_0'] },
      { id: 'b', source: 'src_2_0', sinks: ['sink_0_0'] },
    ])
    expect(res.routed).toBe(true)
    expect(res.overused).toEqual([])
    assertNoSharedNode(res)
    expect(res.iterations).toBeGreaterThan(1) // a first greedy pass did NOT suffice — negotiation was needed
    expect(res.iterations).toBeLessThan(4) // history converges it fast (=2); without it this rises to 5

    const drvA = buffer('ia', 'src_0_0')
    const drvB = buffer('ib', 'src_2_0')
    const sim = stepLogic(
      bridgeToSim(
        narrow.rrg,
        res.onPips,
        [drvA, drvB],
        [
          { node: 'ia', high: true },
          { node: 'ib', high: false },
        ],
      ),
    )
    expect(sim.value('sink_2_0', '')).toBe(true)
    expect(sim.value('sink_0_0', '')).toBe(false)
  })

  test('contention on a VERTICAL (chany) track negotiates apart too — both axes are congestion-counted', () => {
    // Mirror of the row test on the column axis: 2×3 grid, ONE track per channel, two counter-nets up/down
    // column 0 both want chany_0_0. If chany occupancy were not counted, they would silently share it and
    // short; instead they must negotiate onto a column-1 detour. Guards against a per-axis occupancy blind spot.
    const narrow = generateFabric({ ...DEFAULT_FABRIC_ARCH, channelWidth: 1, fs: 1 }, 2, 3)
    const res = routeDesign(narrow.rrg, [
      { id: 'a', source: 'src_0_0', sinks: ['sink_0_2'] },
      { id: 'b', source: 'src_0_2', sinks: ['sink_0_0'] },
    ])
    expect(res.routed).toBe(true)
    expect(res.overused).toEqual([])
    assertNoSharedNode(res) // in particular, chany_0_0 is not shared

    const drvA = buffer('ia', 'src_0_0')
    const drvB = buffer('ib', 'src_0_2')
    const sim = stepLogic(
      bridgeToSim(
        narrow.rrg,
        res.onPips,
        [drvA, drvB],
        [
          { node: 'ia', high: true },
          { node: 'ib', high: false },
        ],
      ),
    )
    expect(sim.value('sink_0_2', '')).toBe(true) // A's value, not shorted to B
    expect(sim.value('sink_0_0', '')).toBe(false)
  })
})

describe('routeDesign — two nets to one node are a short, and the router reports it (not accepts it)', () => {
  test('two nets to the SAME sink fail honestly BY DEFAULT — a shared node would short in the sim', () => {
    const fabric = generateFabric(DEFAULT_FABRIC_ARCH, 3, 3)
    // No capacity override: every node incl. the sink aggregator is capacity 1, so two nets onto sink_1_1 —
    // which bridgeToSim would union into ONE shorted net — is reported as overuse, never routed:true.
    const res = routeDesign(
      fabric.rrg,
      [
        { id: 'a', source: 'src_0_0', sinks: ['sink_1_1'] },
        { id: 'b', source: 'src_2_2', sinks: ['sink_1_1'] },
      ],
      { maxIterations: 20 },
    )
    expect(res.routed).toBe(false)
    expect(res.overused).toContain('sink_1_1') // the short is NAMED, not shipped as routed:true
    expect(res.unroutable).toEqual([]) // a congestion failure, not an unreachable one
    expect(res.iterations).toBe(20)
  })

  test('two loads in ONE tile route to DISTINCT ipins with no short — the correct multi-input pattern', () => {
    const fabric = generateFabric(DEFAULT_FABRIC_ARCH, 3, 3)
    // A LUT on tile (1,1) fed by two different source nets: each net targets a DIFFERENT input pin, so no
    // node is shared and nothing shorts — the legitimate two-signals-into-one-tile design the sink case is not.
    const res = routeDesign(fabric.rrg, [
      { id: 'a', source: 'src_0_0', sinks: ['ipin_1_1_0'] },
      { id: 'b', source: 'src_2_2', sinks: ['ipin_1_1_1'] },
    ])
    expect(res.routed).toBe(true)
    expect(res.overused).toEqual([])
    assertNoSharedNode(res)

    const drvA = buffer('ia', 'src_0_0')
    const drvB = buffer('ib', 'src_2_2')
    const sim = stepLogic(
      bridgeToSim(
        fabric.rrg,
        res.onPips,
        [drvA, drvB],
        [
          { node: 'ia', high: true },
          { node: 'ib', high: false },
        ],
      ),
    )
    expect(sim.value('ipin_1_1_0', '')).toBe(true) // pin 0 reads A
    expect(sim.value('ipin_1_1_1', '')).toBe(false) // pin 1 reads B — distinct, no short
  })
})

describe('routeDesign — an unreachable sink fails with a NAMED reason, not silently', () => {
  test('with switch blocks removed (Fs=0) a cross-tile net is unroutable, and `unroutable` names it', () => {
    // No SBs => the row/column channels never interconnect, so tile (0,0)'s driver cannot reach tile (1,2).
    // This is a genuine "fabric too poor to route this design" failure — it must name WHY, not return a bare
    // routed:false with an empty diagnostic (which is what the old sink-∞ / no-unroutable code did).
    const noSb = generateFabric({ ...DEFAULT_FABRIC_ARCH, fs: 0 }, 3, 3)
    const res = routeDesign(noSb.rrg, [{ id: 'n', source: 'src_0_0', sinks: ['sink_1_2'] }], {
      maxIterations: 5,
    })
    expect(res.routed).toBe(false)
    expect(res.unroutable).toContain('n->sink_1_2') // the unreachable sink is named
    expect(res.overused).toEqual([]) // nothing was overused — it's unreachability, not congestion
    // and the SAME net routes fine once switch blocks exist, confirming it was the fabric, not the net
    const ok = generateFabric(DEFAULT_FABRIC_ARCH, 3, 3)
    expect(routeDesign(ok.rrg, [{ id: 'n', source: 'src_0_0', sinks: ['sink_1_2'] }]).routed).toBe(
      true,
    )
  })
})

describe('routeDesign — deterministic AND correct', () => {
  test('the same design twice yields the identical routing, and that routing actually works electrically', () => {
    const fabric = generateFabric(DEFAULT_FABRIC_ARCH, 3, 3)
    const nets: RouteNet[] = [
      { id: 'a', source: 'src_0_0', sinks: ['sink_2_2'] },
      { id: 'b', source: 'src_2_0', sinks: ['sink_0_2'] },
    ]
    const a = routeDesign(fabric.rrg, nets)
    const b = routeDesign(fabric.rrg, nets)
    expect([...a.onPips].sort()).toEqual([...b.onPips].sort())
    expect(a.iterations).toBe(b.iterations)
    expect(a.routed).toBe(b.routed)

    // stability alone would pass for a wrong-but-deterministic router; pin that the routing is CORRECT too —
    // each sink reads its own source and the two nets do not short.
    expect(a.routed).toBe(true)
    assertNoSharedNode(a)
    const sim = stepLogic(
      bridgeToSim(
        fabric.rrg,
        a.onPips,
        [buffer('ia', 'src_0_0'), buffer('ib', 'src_2_0')],
        [
          { node: 'ia', high: true },
          { node: 'ib', high: false },
        ],
      ),
    )
    expect(sim.value('sink_2_2', '')).toBe(true) // net a
    expect(sim.value('sink_0_2', '')).toBe(false) // net b — separate
  })
})

describe('map → route → sim: LUTs drive each other across a PathFinder-routed interconnect', () => {
  test('LUT1 X=AND(a,b) on tile(0,0) reaches LUT2 Y=OR(X,c) on tile(2,2) — Y = (a·b)+c over all inputs', () => {
    const fabric = generateFabric(DEFAULT_FABRIC_ARCH, 3, 3)
    // the one interconnect net the router owns: LUT1's output tile-source → LUT2's tile-input aggregator
    const res = routeDesign(fabric.rrg, [{ id: 'x', source: 'src_0_0', sinks: ['sink_2_2'] }])
    expect(res.routed).toBe(true)

    const lut1: PlacedLut = { config: AND2, inputs: ['a', 'b'], output: 'src_0_0' }
    const lut2: PlacedLut = { config: OR2, inputs: ['sink_2_2', 'c'], output: 'src_2_2' }
    for (let combo = 0; combo < 8; combo++) {
      const [a, b, c] = [(combo & 1) !== 0, (combo & 2) !== 0, (combo & 4) !== 0]
      const sim = stepLogic(
        bridgeToSim(
          fabric.rrg,
          res.onPips,
          [lut1, lut2],
          [
            { node: 'a', high: a },
            { node: 'b', high: b },
            { node: 'c', high: c },
          ],
        ),
      )
      expect(sim.value('src_2_2', '')).toBe((a && b) || c)
    }
  })
})

/**
 * FPGA fabric — Stage 1, increment 5: the ON-pip → sim bridge (fpga-sim.ts).
 * Proves the router→sim seam: a set of ON pips unions the fabric wires into nets, a placed LUT becomes a
 * gate over those nets, and the whole thing simulates through the REAL stepLogic — so a LUT placed on one
 * tile drives a load on another *through the routed fabric*. Router-independent: the ON pips are hand-
 * chosen here (the future router will supply them, unchanged). An unrouted load stays undriven — the
 * bridge never fakes connectivity.
 */
import { describe, expect, test } from 'vitest'
import {
  DEFAULT_FABRIC_ARCH,
  generateFabric,
  type Pip,
  type Rrg,
} from '../src/renderer/fpga-rrg.ts'
import { bridgeToSim, type PlacedLut } from '../src/renderer/fpga-sim.ts'
import { stepLogic } from '../src/renderer/logic-sim.ts'

/** A bare RRG carrying only pips (all the bridge reads) — for hand-built routing scenarios. */
const rawRrg = (pips: Pip[]): Rrg => ({
  nodes: new Map(),
  pips,
  edgesFrom: new Map(),
  edgesTo: new Map(),
})

// LSB-first 2-input configs: index bit0 = input0, bit1 = input1.
const OR2 = [false, true, true, true]
const AND2 = [false, false, false, true]

describe('bridgeToSim — a LUT drives a load across a hand-chosen route', () => {
  test('DoD: a LUT + an ON route (src → mid → load) drives the far load through stepLogic', () => {
    const rrg = rawRrg([
      { id: 'a', from: 'src', to: 'mid', kind: 'buffer', configBits: null },
      { id: 'b', from: 'mid', to: 'load', kind: 'buffer', configBits: null },
    ])
    const orLut: PlacedLut = { config: OR2, inputs: ['i0', 'i1'], output: 'src' }
    // both pips ON → src, mid, load collapse to ONE net → the load reads the LUT's output
    const compiled = bridgeToSim(
      rrg,
      ['a', 'b'],
      [orLut],
      [
        { node: 'i0', high: false },
        { node: 'i1', high: true },
      ],
    )
    const result = stepLogic(compiled)
    expect(result.settled).toBe(true)
    expect(result.value('load', '')).toBe(true) // OR(0,1) = 1, carried across the route
  })

  test('the load follows the LUT — flipping an input flips the far load', () => {
    const rrg = rawRrg([{ id: 'a', from: 'src', to: 'load', kind: 'buffer', configBits: null }])
    const andLut: PlacedLut = { config: AND2, inputs: ['i0', 'i1'], output: 'src' }
    const high = bridgeToSim(
      rrg,
      ['a'],
      [andLut],
      [
        { node: 'i0', high: true },
        { node: 'i1', high: true },
      ],
    )
    const low = bridgeToSim(
      rrg,
      ['a'],
      [andLut],
      [
        { node: 'i0', high: true },
        { node: 'i1', high: false },
      ],
    )
    expect(stepLogic(high).value('load', '')).toBe(true) // AND(1,1) = 1
    expect(stepLogic(low).value('load', '')).toBe(false) // AND(1,0) = 0
  })

  test('an unrouted load stays UNDRIVEN — a broken route never fakes connectivity', () => {
    const rrg = rawRrg([
      { id: 'a', from: 'src', to: 'mid', kind: 'buffer', configBits: null },
      { id: 'b', from: 'mid', to: 'load', kind: 'buffer', configBits: null },
    ])
    const alwaysHigh: PlacedLut = {
      config: [true, true, true, true],
      inputs: ['i0', 'i1'],
      output: 'src',
    }
    // only pip 'a' ON → src+mid are one driven net, but 'load' is its OWN net with no driver
    const result = stepLogic(
      bridgeToSim(
        rrg,
        ['a'],
        [alwaysHigh],
        [
          { node: 'i0', high: true },
          { node: 'i1', high: true },
        ],
      ),
    )
    expect(result.value('src', '')).toBe(true)
    expect(result.value('mid', '')).toBe(true)
    expect(result.value('load', '')).toBeUndefined() // unrouted → undriven, not coerced to a bit
  })

  test('on a REAL generated fabric: a LUT routed across two tiles drives the far tile’s load', () => {
    const fabric = generateFabric(DEFAULT_FABRIC_ARCH, 2, 1) // two logic tiles side by side
    const pipId = (from: string, to: string): string => {
      const pip = fabric.rrg.pips.find((p) => p.from === from && p.to === to)
      if (pip === undefined) throw new Error(`no pip ${from} -> ${to}`)
      return pip.id
    }
    // hand-trace a real path through the fabric: src(0,0) → opin → chanx track 0 → ipin(1,0) → sink(1,0)
    const route = [
      pipId('src_0_0', 'opin_0_0'),
      pipId('opin_0_0', 'chanx_0_0'),
      pipId('chanx_0_0', 'ipin_1_0_0'),
      pipId('ipin_1_0_0', 'sink_1_0'),
    ]
    const andLut: PlacedLut = { config: AND2, inputs: ['x', 'y'], output: 'src_0_0' }
    const hi = bridgeToSim(
      fabric.rrg,
      route,
      [andLut],
      [
        { node: 'x', high: true },
        { node: 'y', high: true },
      ],
    )
    const lo = bridgeToSim(
      fabric.rrg,
      route,
      [andLut],
      [
        { node: 'x', high: true },
        { node: 'y', high: false },
      ],
    )
    expect(stepLogic(hi).value('sink_1_0', '')).toBe(true) // AND(1,1) carried clear across the fabric
    expect(stepLogic(lo).value('sink_1_0', '')).toBe(false) // AND(1,0) follows
  })
})

/**
 * Mixed-signal co-simulation, step 1 — the two engine hooks on solveTransient.
 *
 * onStepBegin(k, t, prevNodes) fires once at the top of each march step; externalSourceV(id)
 * overrides a timed source's voltage for the step (the digital→analog video bridge). Both are
 * optional and must be byte-identical no-ops when absent (regression guard). These tests prove the
 * hooks fire with the right arguments and that an override truly forces the source's node voltage,
 * WITHOUT any logic engine or char-gen yet (per the design's isolation-first plan).
 */

import { describe, expect, test } from 'vitest'
import type { World } from '../src/cross-fk-validator.ts'
import { solveTransient } from '../src/transient-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

/** bat(+) — vs — r1 — gnd(−), with an AC source so its native waveform swings. */
function acDivider(): World {
  const world: World = {
    definitions: new Map(),
    instances: new Map(),
    behaviors: new Map(),
    activeVariables: new Map(),
    nets: new Map(),
  }
  world.nets.set('vs', {
    id: 'vs',
    kind: 'net',
    members: [
      { instance: 'bat', terminal: 'terminal_positive' },
      { instance: 'r1', terminal: 'terminal_a' },
    ],
  })
  world.nets.set('gnd', {
    id: 'gnd',
    kind: 'net',
    type: 'ground',
    members: [
      { instance: 'bat', terminal: 'terminal_negative' },
      { instance: 'r1', terminal: 'terminal_b' },
    ],
  })
  world.instances.set('bat', {
    id: 'bat',
    kind_ref: 'primitive_device',
    definition: 'power_source',
    parameters: {
      nominal_voltage: scalar(0, 'volt'),
      ac_amplitude: scalar(5, 'volt'),
      frequency: scalar(1000, 'hertz'),
    },
    connects: [
      { net: 'vs', terminal: 'terminal_positive', of: 'bat' },
      { net: 'gnd', terminal: 'terminal_negative', of: 'bat' },
    ],
  })
  world.instances.set('r1', {
    id: 'r1',
    kind_ref: 'primitive_device',
    definition: 'resistor',
    parameters: { resistance: scalar(1000, 'ohm') },
    connects: [
      { net: 'vs', terminal: 'terminal_a', of: 'r1' },
      { net: 'gnd', terminal: 'terminal_b', of: 'r1' },
    ],
  })
  return world
}

const OPTS = { timeStep: 1e-5, duration: 1e-3 } // 100 steps of a 1 kHz sine

describe('co-sim hooks (step 1)', () => {
  test('absent hooks leave the series byte-identical (regression guard)', () => {
    const bare = solveTransient(acDivider(), OPTS)
    const noop = solveTransient(acDivider(), {
      ...OPTS,
      onStepBegin: () => {},
      externalSourceV: () => undefined,
    })
    expect(bare.status).toBe('solved')
    expect(noop.series.length).toBe(bare.series.length)
    for (let i = 0; i < bare.series.length; i++) {
      expect(noop.series[i]?.nodes.get('vs')).toBe(bare.series[i]?.nodes.get('vs'))
    }
  })

  test('onStepBegin fires once per step with increasing k and the prior nodes', () => {
    const seenK: number[] = []
    let prevWasPopulated = true
    solveTransient(acDivider(), {
      ...OPTS,
      onStepBegin: (k, t, prevNodes) => {
        seenK.push(k)
        expect(t).toBeCloseTo(k * OPTS.timeStep, 12)
        if (prevNodes.size === 0) prevWasPopulated = false
      },
    })
    // 100 march steps (t = 0 is the initial solve, outside the march), strictly 1..100.
    expect(seenK).toEqual(Array.from({ length: 100 }, (_, i) => i + 1))
    expect(prevWasPopulated).toBe(true)
  })

  test('externalSourceV forces the source node, overriding its own waveform', () => {
    const free = solveTransient(acDivider(), OPTS)
    const vsFree = free.series.map((p) => p.nodes.get('vs') ?? 0)
    const swing = Math.max(...vsFree) - Math.min(...vsFree)
    expect(swing).toBeGreaterThan(5) // the unforced 5 V sine genuinely swings

    const forced = solveTransient(acDivider(), {
      ...OPTS,
      externalSourceV: (id) => (id === 'bat' ? 3 : undefined),
    })
    for (const p of forced.series) {
      expect(p.nodes.get('vs') ?? 0).toBeCloseTo(3, 3) // pinned flat at the override, not the sine
    }
  })

  test('externalSourceV returning undefined for an id falls back to the native waveform', () => {
    const forced = solveTransient(acDivider(), { ...OPTS, externalSourceV: () => undefined })
    const bare = solveTransient(acDivider(), OPTS)
    for (let i = 0; i < bare.series.length; i++) {
      expect(forced.series[i]?.nodes.get('vs')).toBeCloseTo(bare.series[i]?.nodes.get('vs') ?? 0, 9)
    }
  })
})

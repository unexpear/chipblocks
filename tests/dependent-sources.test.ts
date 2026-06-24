/**
 * Dependent (controlled) source tests — the standalone VCCS and CCCS parts, in
 * BOTH the DC solver and the transient solver.
 *
 *   VCCS: output current I_out = g·V_control   (g = transconductance, siemens)
 *   CCCS: output current I_out = f·I_control   (f = current gain, dimensionless)
 *
 * Each circuit is hand-computed, then checked end-to-end: the output node voltage
 * AND (in DC) the device's reported current, so a flipped sign or a wrong gain
 * fails rather than passing quietly. The transient checks confirm the same parts
 * settle to the same operating point inside the time-domain engine.
 */

import { describe, expect, test } from 'vitest'
import { acResponse } from '../src/ac-analysis.ts'
import type { World } from '../src/cross-fk-validator.ts'
import { solveDC } from '../src/dc-solver.ts'
import { solveTransient } from '../src/transient-solver.ts'

const scalar = (amount: number, unit: string) => ({
  value: { kind: 'scalar' as const, amount, unit },
})

type Conn = { net: string; terminal: string }
type Dev = {
  id: string
  def: string
  params: Record<string, ReturnType<typeof scalar>>
  connects: Conn[]
}

/** Assemble a World from a part list, creating each referenced net ('gnd' is the ground). */
function build(devices: Dev[]): World {
  const world: World = {
    definitions: new Map(),
    instances: new Map(),
    behaviors: new Map(),
    activeVariables: new Map(),
    nets: new Map(),
  }
  for (const d of devices) {
    for (const c of d.connects) {
      if (!world.nets.has(c.net))
        world.nets.set(c.net, {
          id: c.net,
          kind: 'net',
          ...(c.net === 'gnd' ? { type: 'ground' } : {}),
          members: [],
        })
    }
    world.instances.set(d.id, {
      id: d.id,
      kind_ref: 'primitive_device',
      definition: d.def,
      parameters: d.params,
      connects: d.connects.map((c) => ({ ...c, of: d.id })),
    })
  }
  return world
}

/** A battery holds V_control across the VCCS's high-impedance control sense; the VCCS
 *  sources g·V_control into a load resistor. `reverse` swaps the control sense. */
function vccsWorld(g: number, ctrlVolts: number, rLoad: number, reverse = false): World {
  const ctrl: Conn[] = reverse
    ? [
        { net: 'gnd', terminal: 'control_positive' },
        { net: 'ctrl', terminal: 'control_negative' },
      ]
    : [
        { net: 'ctrl', terminal: 'control_positive' },
        { net: 'gnd', terminal: 'control_negative' },
      ]
  return build([
    {
      id: 'vctrl',
      def: 'power_source',
      params: { nominal_voltage: scalar(ctrlVolts, 'volt') },
      connects: [
        { net: 'ctrl', terminal: 'terminal_positive' },
        { net: 'gnd', terminal: 'terminal_negative' },
      ],
    },
    {
      id: 'g1',
      def: 'vccs',
      params: { transconductance: scalar(g, 'siemens') },
      connects: [
        ...ctrl,
        { net: 'out', terminal: 'output_positive' },
        { net: 'gnd', terminal: 'output_negative' },
      ],
    },
    {
      id: 'rl',
      def: 'resistor',
      params: { resistance: scalar(rLoad, 'ohm') },
      connects: [
        { net: 'out', terminal: 'terminal_a' },
        { net: 'gnd', terminal: 'terminal_b' },
      ],
    },
  ])
}

/** A source through rCtrl sets the control current (the 0 V sense pins its node to ground);
 *  the CCCS sources f·I_control into a load resistor. */
function cccsWorld(f: number, vSrc: number, rCtrl: number, rLoad: number): World {
  return build([
    {
      id: 'bat',
      def: 'power_source',
      params: { nominal_voltage: scalar(vSrc, 'volt') },
      connects: [
        { net: 'v1', terminal: 'terminal_positive' },
        { net: 'gnd', terminal: 'terminal_negative' },
      ],
    },
    {
      id: 'r1',
      def: 'resistor',
      params: { resistance: scalar(rCtrl, 'ohm') },
      connects: [
        { net: 'v1', terminal: 'terminal_a' },
        { net: 'c', terminal: 'terminal_b' },
      ],
    },
    {
      id: 'f1',
      def: 'cccs',
      params: { current_gain: scalar(f, 'dimensionless') },
      connects: [
        { net: 'c', terminal: 'control_positive' },
        { net: 'gnd', terminal: 'control_negative' },
        { net: 'out', terminal: 'output_positive' },
        { net: 'gnd', terminal: 'output_negative' },
      ],
    },
    {
      id: 'rl',
      def: 'resistor',
      params: { resistance: scalar(rLoad, 'ohm') },
      connects: [
        { net: 'out', terminal: 'terminal_a' },
        { net: 'gnd', terminal: 'terminal_b' },
      ],
    },
  ])
}

const lastOut = (res: { series: { nodes: Map<string, number> }[] }): number | undefined =>
  res.series[res.series.length - 1]?.nodes.get('out')

describe('VCCS — voltage-controlled current source', () => {
  // g = 0.01 S, V_control = 2 V → I_out = 20 mA into 100 Ω → V_out = 2 V.
  test('DC: I_out = g·V_control drives the output load', () => {
    const sol = solveDC(vccsWorld(0.01, 2, 100))
    expect(sol.status).toBe('solved')
    expect(sol.nodes.get('ctrl')).toBeCloseTo(2, 9)
    expect(sol.branches.get('g1')).toBeCloseTo(0.02, 9)
    expect(sol.nodes.get('out')).toBeCloseTo(2, 6)
  })

  test('DC: reversing the control sense reverses the output current', () => {
    const sol = solveDC(vccsWorld(0.01, 2, 100, true))
    expect(sol.status).toBe('solved')
    expect(sol.branches.get('g1')).toBeCloseTo(-0.02, 9)
    expect(sol.nodes.get('out')).toBeCloseTo(-2, 6)
  })

  test('transient: settles to the same 2 V output', () => {
    const res = solveTransient(vccsWorld(0.01, 2, 100), { timeStep: 1e-4, duration: 1e-3 })
    expect(res.status).toBe('solved')
    expect(lastOut(res)).toBeCloseTo(2, 5)
  })
})

describe('CCCS — current-controlled current source', () => {
  // I_control = 10 V / 1 kΩ = 10 mA, f = 5 → I_out = 50 mA into 100 Ω → V_out = 5 V.
  test('DC: I_out = f·I_control drives the output load', () => {
    const sol = solveDC(cccsWorld(5, 10, 1000, 100))
    expect(sol.status).toBe('solved')
    expect(sol.nodes.get('c')).toBeCloseTo(0, 6)
    expect(sol.branches.get('f1')).toBeCloseTo(0.05, 9)
    expect(sol.nodes.get('out')).toBeCloseTo(5, 6)
  })

  test('transient: settles to the same 5 V output', () => {
    const res = solveTransient(cccsWorld(5, 10, 1000, 100), { timeStep: 1e-4, duration: 1e-3 })
    expect(res.status).toBe('solved')
    expect(lastOut(res)).toBeCloseTo(5, 5)
  })
})

describe('dependent sources in the AC analyzer', () => {
  // The analyzer drives the input source with a unit phasor, so |V_out| IS the gain.
  test('VCCS: flat transconductance gain g·R_L, frequency-independent', () => {
    // Drive the control source: V_out = g·V_ctrl·R_L → gain = g·R_L = 0.01·100 = 1.0.
    const world = vccsWorld(0.01, 2, 100)
    const at = (f: number) => acResponse(world, { inputSource: 'vctrl', outputNet: 'out' }, f).gain
    expect(at(1)).toBeCloseTo(1.0, 6)
    expect(at(1e6)).toBeCloseTo(1.0, 6) // purely resistive → no roll-off
  })

  test('CCCS: flat current gain f·R_L/R_ctrl, frequency-independent', () => {
    // I_control = V_in/R_ctrl, V_out = f·I_control·R_L → gain = f·R_L/R_ctrl = 5·100/1000 = 0.5.
    const world = cccsWorld(5, 10, 1000, 100)
    const at = (f: number) => acResponse(world, { inputSource: 'bat', outputNet: 'out' }, f).gain
    expect(at(1)).toBeCloseTo(0.5, 6)
    expect(at(1e6)).toBeCloseTo(0.5, 6)
  })
})

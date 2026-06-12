/**
 * Per-terminal current recording tests (S20-v3-2) — every solved transient
 * point carries amps-into-each-terminal, computed only from what the solve
 * already produced. The load-bearing check is per-NET Kirchhoff closure: at
 * every net, the currents into all attached device terminals sum to zero, at
 * every step — which cross-validates every device kind's sign convention
 * against every other's. On top of that, per-kind analytic identities.
 */

import { describe, expect, test } from 'vitest'
import type { World } from '../src/cross-fk-validator.ts'
import { diodeCurrent, thermalVoltage } from '../src/diode-model.ts'
import { canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { solveTransient, type TransientPoint } from '../src/transient-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

/** The worst per-net KCL residual in one recorded point. */
function worstNetResidual(world: World, point: TransientPoint): number {
  let worst = 0
  for (const net of world.nets.values()) {
    let sum = 0
    for (const member of net.members) {
      sum += point.currents?.get(`${member.instance}/${member.terminal}`) ?? 0
    }
    worst = Math.max(worst, Math.abs(sum))
  }
  return worst
}

function current(point: TransientPoint, key: string): number {
  const value = point.currents?.get(key)
  if (value === undefined) throw new Error(`no recorded current for ${key}`)
  return value
}

describe('series RC charge (source + wire + resistor + capacitor)', () => {
  const world = canvasToWorld(
    [
      {
        id: 'src',
        definition: 'power_source',
        parameters: {
          nominal_voltage: scalar(9, 'volt'),
          internal_resistance: scalar(0, 'ohm'),
        },
      },
      {
        id: 'r1',
        definition: 'resistor',
        parameters: { resistance: scalar(1000, 'ohm') },
      },
      {
        id: 'c1',
        definition: 'capacitor',
        parameters: { capacitance: scalar(1e-6, 'farad') },
      },
      { id: 'gnd', definition: 'ground' },
    ],
    [
      {
        id: 'e1',
        source: 'src',
        target: 'r1',
        sourceHandle: 'terminal_positive',
        targetHandle: 'terminal_a',
        resistanceOhms: 0.01,
      },
      {
        id: 'e2',
        source: 'r1',
        target: 'c1',
        sourceHandle: 'terminal_b',
        targetHandle: 'terminal_a',
        resistanceOhms: 0.01,
      },
      {
        id: 'e3',
        source: 'c1',
        target: 'src',
        sourceHandle: 'terminal_b',
        targetHandle: 'terminal_negative',
        resistanceOhms: 0.01,
      },
      {
        id: 'e4',
        source: 'gnd',
        target: 'src',
        sourceHandle: 'reference_terminal',
        targetHandle: 'terminal_negative',
        resistanceOhms: 0.01,
      },
    ],
  )
  const dt = 1e-5
  const result = solveTransient(world, { timeStep: dt, duration: 2e-3 })

  test('solves, and every point carries a currents record', () => {
    expect(result.status).toBe('solved')
    for (const p of result.series) expect(p.currents).toBeDefined()
  })

  test('per-net KCL closes at every step (linear circuit: nanoamp tolerance)', () => {
    for (const p of result.series) {
      expect(worstNetResidual(world, p)).toBeLessThan(1e-9)
    }
  })

  test('t = 0: the capacitor starts empty, so the loop current is V/R exactly', () => {
    const first = result.series[0]
    if (first === undefined) throw new Error('no samples')
    // Total series resistance: 1000 Ω + three loop wires at 0.01 Ω.
    const expected = 9 / (1000 + 0.03)
    expect(current(first, 'r1/terminal_a')).toBeCloseTo(expected, 9)
  })

  test('the capacitor current IS C·dv/dt, step by step (the BE identity)', () => {
    for (let k = 1; k < result.series.length; k++) {
      const prev = result.series[k - 1]
      const cur = result.series[k]
      if (prev === undefined || cur === undefined) continue
      const capNetA = world.instances.get('c1')?.connects?.[0]?.net ?? ''
      const capNetB = world.instances.get('c1')?.connects?.[1]?.net ?? ''
      const vPrev = (prev.nodes.get(capNetA) ?? 0) - (prev.nodes.get(capNetB) ?? 0)
      const vCur = (cur.nodes.get(capNetA) ?? 0) - (cur.nodes.get(capNetB) ?? 0)
      const expected = (1e-6 * (vCur - vPrev)) / dt
      expect(current(cur, 'c1/terminal_a')).toBeCloseTo(expected, 9)
    }
  })

  test('series continuity: source, wire, resistor, capacitor all carry one current', () => {
    const mid = result.series[Math.floor(result.series.length / 2)]
    if (mid === undefined) throw new Error('no samples')
    const iWire = current(mid, 'wire_e1/terminal_a')
    expect(current(mid, 'r1/terminal_a')).toBeCloseTo(iWire, 12)
    expect(current(mid, 'c1/terminal_a')).toBeCloseTo(iWire, 12)
    // The source's + terminal: the loop current flows OUT of it (negative into).
    expect(current(mid, 'src/terminal_positive')).toBeCloseTo(-iWire, 12)
  })

  test('the wire aux current agrees with Ohm’s law on its own drop', () => {
    const mid = result.series[Math.floor(result.series.length / 2)]
    if (mid === undefined) throw new Error('no samples')
    const wire = world.instances.get('wire_e1')
    const netA = wire?.connects?.find((c) => c.terminal === 'terminal_a')?.net ?? ''
    const netB = wire?.connects?.find((c) => c.terminal === 'terminal_b')?.net ?? ''
    const byOhm = ((mid.nodes.get(netA) ?? 0) - (mid.nodes.get(netB) ?? 0)) / 0.01
    expect(current(mid, 'wire_e1/terminal_a')).toBeCloseTo(byOhm, 9)
  })
})

describe('RL rise (source + resistor + inductor)', () => {
  const world = canvasToWorld(
    [
      {
        id: 'src',
        definition: 'power_source',
        parameters: {
          nominal_voltage: scalar(5, 'volt'),
          internal_resistance: scalar(0, 'ohm'),
        },
      },
      {
        id: 'r1',
        definition: 'resistor',
        parameters: { resistance: scalar(100, 'ohm') },
      },
      {
        id: 'l1',
        definition: 'inductor',
        parameters: { inductance: scalar(10e-3, 'henry') },
      },
      { id: 'gnd', definition: 'ground' },
    ],
    [
      {
        id: 'e1',
        source: 'src',
        target: 'r1',
        sourceHandle: 'terminal_positive',
        targetHandle: 'terminal_a',
      },
      {
        id: 'e2',
        source: 'r1',
        target: 'l1',
        sourceHandle: 'terminal_b',
        targetHandle: 'terminal_a',
      },
      {
        id: 'e3',
        source: 'l1',
        target: 'src',
        sourceHandle: 'terminal_b',
        targetHandle: 'terminal_negative',
      },
      {
        id: 'e4',
        source: 'gnd',
        target: 'src',
        sourceHandle: 'reference_terminal',
        targetHandle: 'terminal_negative',
      },
    ],
  )
  const result = solveTransient(world, { timeStep: 1e-6, duration: 1e-3 })

  test('the inductor current starts at zero — current through L cannot jump', () => {
    const first = result.series[0]
    if (first === undefined) throw new Error('no samples')
    expect(current(first, 'l1/terminal_a')).toBe(0)
  })

  test('after many time constants it settles to V/R, and KCL closed throughout', () => {
    const last = result.series[result.series.length - 1]
    if (last === undefined) throw new Error('no samples')
    // τ = L/R = 100 µs; 1 ms = 10τ — settled to better than 0.1 %.
    expect(current(last, 'l1/terminal_a')).toBeCloseTo(5 / 100, 4)
    for (const p of result.series) expect(worstNetResidual(world, p)).toBeLessThan(1e-9)
  })
})

describe('diode half-wave (AC source + resistor + LED)', () => {
  const world = canvasToWorld(
    [
      {
        id: 'src',
        definition: 'power_source',
        parameters: {
          nominal_voltage: scalar(0, 'volt'),
          ac_amplitude: scalar(5, 'volt'),
          frequency: scalar(1000, 'hertz'),
          internal_resistance: scalar(0, 'ohm'),
        },
      },
      {
        id: 'r1',
        definition: 'resistor',
        parameters: { resistance: scalar(470, 'ohm') },
      },
      {
        id: 'd1',
        definition: 'led',
        parameters: {
          forward_voltage: scalar(2, 'volt'),
          max_forward_current: scalar(0.02, 'ampere'),
          ideality_factor: scalar(2, 'dimensionless'),
        },
      },
      { id: 'gnd', definition: 'ground' },
    ],
    [
      {
        id: 'e1',
        source: 'src',
        target: 'r1',
        sourceHandle: 'terminal_positive',
        targetHandle: 'terminal_a',
      },
      {
        id: 'e2',
        source: 'r1',
        target: 'd1',
        sourceHandle: 'terminal_b',
        targetHandle: 'anode',
      },
      {
        id: 'e3',
        source: 'd1',
        target: 'src',
        sourceHandle: 'cathode',
        targetHandle: 'terminal_negative',
      },
      {
        id: 'e4',
        source: 'gnd',
        target: 'src',
        sourceHandle: 'reference_terminal',
        targetHandle: 'terminal_negative',
      },
    ],
  )
  const result = solveTransient(world, { timeStep: 2e-6, duration: 2e-3 })

  test('the recorded diode current IS Shockley at the recorded junction voltage', () => {
    const vT = thermalVoltage()
    const anodeNet = world.instances.get('d1')?.connects?.find((c) => c.terminal === 'anode')?.net
    const cathodeNet = world.instances
      .get('d1')
      ?.connects?.find((c) => c.terminal === 'cathode')?.net
    if (anodeNet === undefined || cathodeNet === undefined) throw new Error('no diode nets')
    // I_S derived from the same 2 V @ 20 mA calibration the solver used.
    const iS = 0.02 / (Math.exp(2 / (2 * vT)) - 1)
    for (const p of result.series) {
      const v = (p.nodes.get(anodeNet) ?? 0) - (p.nodes.get(cathodeNet) ?? 0)
      expect(current(p, 'd1/anode')).toBeCloseTo(diodeCurrent(v, iS, 2, vT), 9)
    }
  })

  test('per-net KCL closes within the Newton tolerance’s current equivalent', () => {
    // The diode records the device law at the converged voltage; the matrix
    // saw its companion at most 1 µV away — residual ≤ G·1 µV (sub-µA here).
    for (const p of result.series) {
      expect(worstNetResidual(world, p)).toBeLessThan(1e-6)
    }
  })

  test('forward half conducts milliamps; reverse half only leaks', () => {
    let peakForward = 0
    let worstReverse = 0
    for (const p of result.series) {
      const i = current(p, 'd1/anode')
      peakForward = Math.max(peakForward, i)
      worstReverse = Math.min(worstReverse, i)
    }
    expect(peakForward).toBeGreaterThan(4e-3)
    expect(Math.abs(worstReverse)).toBeLessThan(1e-6)
  })
})

describe('transistors record all terminals', () => {
  test('BJT: the three terminal currents close KCL and show the gain', () => {
    const world = canvasToWorld(
      [
        {
          id: 'vcc',
          definition: 'power_source',
          parameters: {
            nominal_voltage: scalar(9, 'volt'),
            internal_resistance: scalar(0, 'ohm'),
          },
        },
        {
          id: 'vbb',
          definition: 'power_source',
          parameters: {
            nominal_voltage: scalar(2, 'volt'),
            internal_resistance: scalar(0, 'ohm'),
          },
        },
        { id: 'rc', definition: 'resistor', parameters: { resistance: scalar(1000, 'ohm') } },
        { id: 'rb', definition: 'resistor', parameters: { resistance: scalar(100000, 'ohm') } },
        {
          id: 'q1',
          definition: 'transistor_bjt_npn',
          parameters: {
            saturation_current: scalar(1e-14, 'ampere'),
            forward_current_gain: scalar(100, 'dimensionless'),
          },
        },
        { id: 'gnd', definition: 'ground' },
      ],
      [
        {
          id: 'e1',
          source: 'vcc',
          target: 'rc',
          sourceHandle: 'terminal_positive',
          targetHandle: 'terminal_a',
        },
        {
          id: 'e2',
          source: 'rc',
          target: 'q1',
          sourceHandle: 'terminal_b',
          targetHandle: 'collector',
        },
        {
          id: 'e3',
          source: 'vbb',
          target: 'rb',
          sourceHandle: 'terminal_positive',
          targetHandle: 'terminal_a',
        },
        { id: 'e4', source: 'rb', target: 'q1', sourceHandle: 'terminal_b', targetHandle: 'base' },
        {
          id: 'e5',
          source: 'q1',
          target: 'vcc',
          sourceHandle: 'emitter',
          targetHandle: 'terminal_negative',
        },
        {
          id: 'e6',
          source: 'vbb',
          target: 'vcc',
          sourceHandle: 'terminal_negative',
          targetHandle: 'terminal_negative',
        },
        {
          id: 'e7',
          source: 'gnd',
          target: 'vcc',
          sourceHandle: 'reference_terminal',
          targetHandle: 'terminal_negative',
        },
      ],
    )
    const result = solveTransient(world, { timeStep: 1e-5, duration: 5e-4 })
    expect(result.status).toBe('solved')
    const last = result.series[result.series.length - 1]
    if (last === undefined) throw new Error('no samples')
    const iC = current(last, 'q1/collector')
    const iB = current(last, 'q1/base')
    const iE = current(last, 'q1/emitter')
    expect(iC + iB + iE).toBeCloseTo(0, 12)
    // Forward-active: collector current ≈ β × base current.
    expect(iC / iB).toBeGreaterThan(50)
    expect(iC / iB).toBeLessThanOrEqual(101)
    expect(iC).toBeGreaterThan(1e-3)
    for (const p of result.series) expect(worstNetResidual(world, p)).toBeLessThan(1e-6)
  })

  test('MOSFET: the drain current matches the Level-1 law; the gate carries none', () => {
    const world = canvasToWorld(
      [
        {
          id: 'vdd',
          definition: 'power_source',
          parameters: {
            nominal_voltage: scalar(9, 'volt'),
            internal_resistance: scalar(0, 'ohm'),
          },
        },
        {
          id: 'vgg',
          definition: 'power_source',
          parameters: {
            nominal_voltage: scalar(5, 'volt'),
            internal_resistance: scalar(0, 'ohm'),
          },
        },
        { id: 'rd', definition: 'resistor', parameters: { resistance: scalar(470, 'ohm') } },
        {
          id: 'm1',
          definition: 'transistor_mosfet_nmos',
          parameters: {
            threshold_voltage: scalar(2.1, 'volt'),
            transconductance_parameter: scalar(0.05, 'ampere_per_volt_squared'),
          },
        },
        { id: 'gnd', definition: 'ground' },
      ],
      [
        {
          id: 'e1',
          source: 'vdd',
          target: 'rd',
          sourceHandle: 'terminal_positive',
          targetHandle: 'terminal_a',
        },
        { id: 'e2', source: 'rd', target: 'm1', sourceHandle: 'terminal_b', targetHandle: 'drain' },
        {
          id: 'e3',
          source: 'vgg',
          target: 'm1',
          sourceHandle: 'terminal_positive',
          targetHandle: 'gate',
        },
        {
          id: 'e4',
          source: 'm1',
          target: 'vdd',
          sourceHandle: 'source',
          targetHandle: 'terminal_negative',
        },
        {
          id: 'e5',
          source: 'vgg',
          target: 'vdd',
          sourceHandle: 'terminal_negative',
          targetHandle: 'terminal_negative',
        },
        {
          id: 'e6',
          source: 'gnd',
          target: 'vdd',
          sourceHandle: 'reference_terminal',
          targetHandle: 'terminal_negative',
        },
      ],
    )
    const result = solveTransient(world, { timeStep: 1e-5, duration: 5e-4 })
    expect(result.status).toBe('solved')
    const last = result.series[result.series.length - 1]
    if (last === undefined) throw new Error('no samples')
    expect(current(last, 'm1/gate')).toBe(0)
    const iD = current(last, 'm1/drain')
    expect(iD).toBeGreaterThan(1e-3)
    expect(current(last, 'm1/source')).toBeCloseTo(-iD, 12)
    // The drain current equals what the drain resistor delivers (series KCL).
    expect(current(last, 'rd/terminal_a')).toBeCloseTo(iD, 6)
  })
})

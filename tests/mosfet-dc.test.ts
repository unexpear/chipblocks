/**
 * MOSFET DC-solver tests (S19-v3-66) — the Level-1 companion inside the
 * Newton-Raphson loop, on canvas-built circuits with hand-computed answers.
 * The headline: a real CMOS inverter (PMOS + NMOS pair) produces the NOT
 * truth table — the first logic gate ChipBlocks solves from real transistors.
 *
 * Running parts: 2N7000-class NMOS (V_th 2.1 V, k 26 mA/V²) and BS250-class
 * PMOS (V_th −2.5 V, k 6.2 mA/V²).
 */

import { describe, expect, test } from 'vitest'
import { resolveMosfet, solveDC } from '../src/dc-solver.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

const nmosParams = {
  threshold_voltage: scalar(2.1, 'volt'),
  transconductance_parameter: scalar(0.026, 'ampere_per_volt_squared'),
}
const pmosParams = {
  threshold_voltage: scalar(-2.5, 'volt'),
  transconductance_parameter: scalar(0.0062, 'ampere_per_volt_squared'),
}

/**
 * NMOS low-side switch: 5 V supply → 100 Ω load → drain; source → ground;
 * gate driven from a separate source through the gate net (no DC gate current,
 * so the divider-free drive is exact).
 */
function nmosSwitch(gateVolts: number) {
  const nodes: CanvasNode[] = [
    {
      id: 'vdd',
      definition: 'power_source',
      parameters: { nominal_voltage: scalar(5, 'volt'), internal_resistance: scalar(0, 'ohm') },
    },
    {
      id: 'vgate',
      definition: 'power_source',
      parameters: {
        nominal_voltage: scalar(gateVolts, 'volt'),
        internal_resistance: scalar(0, 'ohm'),
      },
    },
    { id: 'rload', definition: 'resistor', parameters: { resistance: scalar(100, 'ohm') } },
    { id: 'm1', definition: 'transistor_mosfet_nmos', parameters: nmosParams },
    { id: 'gnd', definition: 'ground' },
  ]
  const edges = [
    {
      source: 'vdd',
      sourceHandle: 'terminal_positive',
      target: 'rload',
      targetHandle: 'terminal_a',
    },
    { source: 'rload', sourceHandle: 'terminal_b', target: 'm1', targetHandle: 'drain' },
    { source: 'm1', sourceHandle: 'source', target: 'vdd', targetHandle: 'terminal_negative' },
    { source: 'vgate', sourceHandle: 'terminal_positive', target: 'm1', targetHandle: 'gate' },
    {
      source: 'vgate',
      sourceHandle: 'terminal_negative',
      target: 'vdd',
      targetHandle: 'terminal_negative',
    },
    {
      source: 'gnd',
      sourceHandle: 'reference_terminal',
      target: 'vdd',
      targetHandle: 'terminal_negative',
    },
  ]
  return canvasToWorld(nodes, edges)
}

describe('NMOS in the DC solver', () => {
  test('gate low → cutoff: no drain current, the load sees the full supply at the drain', () => {
    const world = nmosSwitch(0)
    const solution = solveDC(world)
    expect(solution.status).toBe('solved')
    expect(Math.abs(solution.branches.get('m1') ?? 1)).toBeLessThan(1e-9)
    // No current → no drop across the load → the drain floats at ~5 V.
    const drainNet = [...world.instances.values()]
      .find((i) => i.id === 'm1')
      ?.connects?.find((c) => c.terminal === 'drain')?.net
    expect(solution.nodes.get(drainNet ?? '')).toBeCloseTo(5, 3)
  })

  test('gate high → triode: the hand-computed operating point, drain pulled near ground', () => {
    // V_GS = 5: solve 5 = 100·I_D + V_DS with the triode law
    // I_D = k·(V_OV·V_DS − V_DS²/2), V_OV = 2.9, k = 0.026.
    // Substituting I_D = (5 − V_DS)/100 gives
    // 1.3·V_DS² − 8.54·V_DS + 5 = 0 → V_DS = (8.54 − √46.9316)/2.6 = 0.64975 V
    // → I_D = (5 − 0.64975)/100 = 43.50 mA.
    const world = nmosSwitch(5)
    const solution = solveDC(world)
    expect(solution.status).toBe('solved')
    expect(solution.converged).toBe(true)
    const iD = solution.branches.get('m1') ?? 0
    expect(iD).toBeCloseTo(0.0435, 4)
    const drainNet = [...world.instances.values()]
      .find((i) => i.id === 'm1')
      ?.connects?.find((c) => c.terminal === 'drain')?.net
    expect(solution.nodes.get(drainNet ?? '')).toBeCloseTo(0.6498, 3)
  })
})

describe('MOSFET temperature laws (S20-v3-8)', () => {
  const tcParams = {
    ...nmosParams,
    threshold_temperature_coefficient: scalar(-0.0034, 'volt_per_kelvin'),
  }

  test('resolveMosfet at 125 °C: k falls by the mobility law, V_th by the declared tc', () => {
    const world = nmosSwitch(5)
    const inst = world.instances.get('m1')
    if (inst === undefined) throw new Error('missing instance')
    const withTc = {
      ...inst,
      parameters: {
        ...inst.parameters,
        threshold_temperature_coefficient: {
          value: { kind: 'scalar' as const, amount: -0.0034, unit: 'volt_per_kelvin' },
        },
      },
    }
    const hot = resolveMosfet(withTc as never, 125)
    if (hot === null) throw new Error('failed to resolve')
    // Mobility: k(T) = k·(T/T₀)^−1.5 in kelvin, T₀ = the same 298.15 K (25 °C)
    // reference the diode/BJT I_S(T) laws use (diode-model's ROOM_TEMPERATURE_KELVIN).
    expect(hot.params.transconductance).toBeCloseTo(0.026 * (398.15 / 298.15) ** -1.5, 12)
    // Threshold: 2.1 + (−3.4 mV/K)·(125 − 25) = 1.76 V exactly.
    expect(hot.params.thresholdVoltage).toBeCloseTo(1.76, 12)
    // No temperature → the declared 25 °C values, bit-identical behavior.
    const cold = resolveMosfet(withTc as never)
    expect(cold?.params.transconductance).toBe(0.026)
    expect(cold?.params.thresholdVoltage).toBe(2.1)
    // Without the tc parameter the mobility law still applies; V_th holds.
    const noTc = resolveMosfet(inst, 125)
    expect(noTc?.params.transconductance).toBeCloseTo(0.026 * (398.15 / 298.15) ** -1.5, 12)
    expect(noTc?.params.thresholdVoltage).toBe(2.1)
  })

  test('resolveMosfet rejects an out-of-range second-order param (θ < 0 or λ < 0); 0 is valid', () => {
    const inst = nmosSwitch(5).instances.get('m1')
    if (inst === undefined) throw new Error('missing instance')
    const withParam = (key: string, amount: number) => ({
      ...inst,
      parameters: { ...inst.parameters, [key]: scalar(amount, 'per_volt') },
    })
    // θ = 0 / λ = 0 are the valid defaults; a negative θ drives the (1 + θ·V_OV) divisor through
    // zero (NaN) and a negative λ flips the output conductance, so the resolver rejects them.
    expect(resolveMosfet(withParam('velocity_saturation_theta', 0) as never)).not.toBeNull()
    expect(resolveMosfet(withParam('velocity_saturation_theta', -0.5) as never)).toBeNull()
    expect(resolveMosfet(withParam('channel_length_modulation', -0.02) as never)).toBeNull()
  })

  test('a hot PMOS threshold drifts TOWARD zero (positive signed tc)', () => {
    const { world } = cmosInverter(0)
    const inst = world.instances.get('mp')
    if (inst === undefined) throw new Error('missing instance')
    const withTc = {
      ...inst,
      parameters: {
        ...inst.parameters,
        threshold_temperature_coefficient: {
          value: { kind: 'scalar' as const, amount: 0.0034, unit: 'volt_per_kelvin' },
        },
      },
    }
    const hot = resolveMosfet(withTc as never, 125)
    expect(hot?.params.thresholdVoltage).toBeCloseTo(-2.16, 12)
  })

  test('the ZTC crossover: hot conducts MORE near threshold, LESS at strong drive', () => {
    // The two laws oppose. Near threshold the V_th drop dominates (dangerous
    // in bias circuits); at strong gate drive the mobility fall dominates
    // (why MOSFETs parallel safely). The analytic crossover for the square
    // law sits at V_OV(ztc) = −2·tc·T/1.5 ≈ 1.35 V → V_GS ≈ 3.45 V here.
    const hotMap = new Map([['m1', 125]])
    const nearThreshold = nmosSwitch(3)
    for (const inst of nearThreshold.instances.values()) {
      if (inst.id === 'm1') Object.assign(inst.parameters ?? {}, tcParams)
    }
    const coldNear = solveDC(nearThreshold)
    const hotNear = solveDC(nearThreshold, { temperaturesC: hotMap })
    expect(Math.abs(hotNear.branches.get('m1') ?? 0)).toBeGreaterThan(
      Math.abs(coldNear.branches.get('m1') ?? 0),
    )

    const strongDrive = nmosSwitch(10)
    for (const inst of strongDrive.instances.values()) {
      if (inst.id === 'm1') Object.assign(inst.parameters ?? {}, tcParams)
    }
    const coldStrong = solveDC(strongDrive)
    const hotStrong = solveDC(strongDrive, { temperaturesC: hotMap })
    expect(Math.abs(hotStrong.branches.get('m1') ?? 0)).toBeLessThan(
      Math.abs(coldStrong.branches.get('m1') ?? 0),
    )
  })
})

/**
 * The CMOS inverter — the first real logic gate: PMOS from the 5 V rail to
 * the output, NMOS from the output to ground, gates tied together as the
 * input, and a 10 kΩ load to ground representing the next stage's pull.
 */
function cmosInverter(inputVolts: number) {
  const nodes: CanvasNode[] = [
    {
      id: 'vdd',
      definition: 'power_source',
      parameters: { nominal_voltage: scalar(5, 'volt'), internal_resistance: scalar(0, 'ohm') },
    },
    {
      id: 'vin',
      definition: 'power_source',
      parameters: {
        nominal_voltage: scalar(inputVolts, 'volt'),
        internal_resistance: scalar(0, 'ohm'),
      },
    },
    { id: 'mp', definition: 'transistor_mosfet_pmos', parameters: pmosParams },
    { id: 'mn', definition: 'transistor_mosfet_nmos', parameters: nmosParams },
    { id: 'rload', definition: 'resistor', parameters: { resistance: scalar(10000, 'ohm') } },
    { id: 'gnd', definition: 'ground' },
  ]
  const edges = [
    // PMOS: source at the supply, drain at the output.
    { source: 'vdd', sourceHandle: 'terminal_positive', target: 'mp', targetHandle: 'source' },
    { source: 'mp', sourceHandle: 'drain', target: 'mn', targetHandle: 'drain' }, // the output net
    // NMOS: source to ground.
    { source: 'mn', sourceHandle: 'source', target: 'vdd', targetHandle: 'terminal_negative' },
    // Gates tied together, driven by the input source.
    { source: 'vin', sourceHandle: 'terminal_positive', target: 'mp', targetHandle: 'gate' },
    { source: 'vin', sourceHandle: 'terminal_positive', target: 'mn', targetHandle: 'gate' },
    {
      source: 'vin',
      sourceHandle: 'terminal_negative',
      target: 'vdd',
      targetHandle: 'terminal_negative',
    },
    // Output load to ground (the next stage).
    { source: 'mp', sourceHandle: 'drain', target: 'rload', targetHandle: 'terminal_a' },
    {
      source: 'rload',
      sourceHandle: 'terminal_b',
      target: 'vdd',
      targetHandle: 'terminal_negative',
    },
    {
      source: 'gnd',
      sourceHandle: 'reference_terminal',
      target: 'vdd',
      targetHandle: 'terminal_negative',
    },
  ]
  const world = canvasToWorld(nodes, edges)
  const outputNet = [...world.instances.values()]
    .find((i) => i.id === 'mn')
    ?.connects?.find((c) => c.terminal === 'drain')?.net
  return { world, outputNet: outputNet ?? '' }
}

describe('the CMOS inverter — the first gate, built from real transistors', () => {
  test('input LOW (0 V) → output HIGH: the PMOS pulls the output to the rail', () => {
    const { world, outputNet } = cmosInverter(0)
    const solution = solveDC(world)
    expect(solution.status).toBe('solved')
    expect(solution.converged).toBe(true)
    const vOut = solution.nodes.get(outputNet) ?? -1
    // PMOS fully on (V_GS = −5), NMOS off; the 10 kΩ load draws ~0.5 mA, so
    // the output sits a hair under 5 V (the PMOS triode drop at that current).
    expect(vOut).toBeGreaterThan(4.5)
    expect(vOut).toBeLessThanOrEqual(5)
  })

  test('input HIGH (5 V) → output LOW: the NMOS pulls the output to ground', () => {
    const { world, outputNet } = cmosInverter(5)
    const solution = solveDC(world)
    expect(solution.status).toBe('solved')
    expect(solution.converged).toBe(true)
    const vOut = solution.nodes.get(outputNet) ?? -1
    // NMOS fully on, PMOS off; the load injects only ~0.5 mA to sink.
    expect(vOut).toBeGreaterThanOrEqual(0)
    expect(vOut).toBeLessThan(0.05)
  })

  test('at rest, almost nothing flows — the reason CMOS logic sips power', () => {
    const { world } = cmosInverter(0)
    const solution = solveDC(world)
    // The OFF transistor blocks the rail-to-rail path: supply current is just
    // the load's ~0.5 mA, with no shoot-through.
    const supply = Math.abs(solution.branches.get('vdd') ?? 1)
    expect(supply).toBeLessThan(0.001)
  })
})

// ---------------------------------------------------------------------------
// The inverter through TIME — clock in, inverted clock out
// ---------------------------------------------------------------------------

import { solveTransient } from '../src/transient-solver.ts'

describe('the CMOS inverter in the time domain', () => {
  test('a square clock at the input comes out inverted', () => {
    // Same inverter, but the input source is the 0–5 V square clock
    // (offset 2.5 ± 2.5 V at 100 Hz).
    const nodes: CanvasNode[] = [
      {
        id: 'vdd',
        definition: 'power_source',
        parameters: { nominal_voltage: scalar(5, 'volt'), internal_resistance: scalar(0, 'ohm') },
      },
      {
        id: 'clk',
        definition: 'power_source',
        parameters: {
          nominal_voltage: scalar(2.5, 'volt'),
          ac_amplitude: scalar(2.5, 'volt'),
          frequency: scalar(100, 'hertz'),
          internal_resistance: scalar(0, 'ohm'),
          waveform: { value: 'square' },
        },
      },
      { id: 'mp', definition: 'transistor_mosfet_pmos', parameters: pmosParams },
      { id: 'mn', definition: 'transistor_mosfet_nmos', parameters: nmosParams },
      { id: 'rload', definition: 'resistor', parameters: { resistance: scalar(10000, 'ohm') } },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      { source: 'vdd', sourceHandle: 'terminal_positive', target: 'mp', targetHandle: 'source' },
      { source: 'mp', sourceHandle: 'drain', target: 'mn', targetHandle: 'drain' },
      { source: 'mn', sourceHandle: 'source', target: 'vdd', targetHandle: 'terminal_negative' },
      { source: 'clk', sourceHandle: 'terminal_positive', target: 'mp', targetHandle: 'gate' },
      { source: 'clk', sourceHandle: 'terminal_positive', target: 'mn', targetHandle: 'gate' },
      {
        source: 'clk',
        sourceHandle: 'terminal_negative',
        target: 'vdd',
        targetHandle: 'terminal_negative',
      },
      { source: 'mp', sourceHandle: 'drain', target: 'rload', targetHandle: 'terminal_a' },
      {
        source: 'rload',
        sourceHandle: 'terminal_b',
        target: 'vdd',
        targetHandle: 'terminal_negative',
      },
      {
        source: 'gnd',
        sourceHandle: 'reference_terminal',
        target: 'vdd',
        targetHandle: 'terminal_negative',
      },
    ]
    const world = canvasToWorld(nodes, edges)
    const outputNet =
      [...world.instances.values()]
        .find((i) => i.id === 'mn')
        ?.connects?.find((c) => c.terminal === 'drain')?.net ?? ''
    const T = 1 / 100
    const result = solveTransient(world, { timeStep: (2 * T) / 400, duration: 2 * T })
    expect(result.status).toBe('solved')

    const at = (t: number) => {
      const point = result.series.reduce((best, p) =>
        Math.abs(p.time - t) < Math.abs(best.time - t) ? p : best,
      )
      return point.nodes.get(outputNet) ?? Number.NaN
    }
    // Clock HIGH (first half period) → output LOW; clock LOW → output HIGH.
    expect(at(T / 4)).toBeLessThan(0.05)
    expect(at((3 * T) / 4)).toBeGreaterThan(4.5)
    expect(at(T + T / 4)).toBeLessThan(0.05) // periodic — it keeps inverting
  })
})

// ---------------------------------------------------------------------------
// Failure checks — the ratings fire with real numbers
// ---------------------------------------------------------------------------

import { detectFailures } from '../src/failure-detector.ts'

describe('MOSFET failure checks', () => {
  test('drain overcurrent fires mosfet-overloaded', () => {
    // Same switch circuit, but the part is rated for only 20 mA — the solved
    // ~43.5 mA cooks it.
    const world = nmosSwitch(5)
    const m1 = [...world.instances.values()].find((i) => i.id === 'm1')
    if (m1?.parameters) m1.parameters.max_drain_current = scalar(0.02, 'ampere')
    const solution = solveDC(world)
    const failure = detectFailures(world, solution).find((f) => f.code === 'mosfet-overloaded')
    expect(failure).toBeDefined()
    expect(failure?.measured).toBeGreaterThan(0.04)
    expect(failure?.rated).toBeCloseTo(0.02, 9)
  })

  test('gate past the oxide rating fires mosfet-gate-overvoltage', () => {
    // 25 V on a ±20 V gate — the classic oxide rupture.
    const world = nmosSwitch(25)
    const m1 = [...world.instances.values()].find((i) => i.id === 'm1')
    if (m1?.parameters) m1.parameters.max_gate_source_voltage = scalar(20, 'volt')
    const solution = solveDC(world)
    const failure = detectFailures(world, solution).find(
      (f) => f.code === 'mosfet-gate-overvoltage',
    )
    expect(failure).toBeDefined()
    expect(failure?.measured).toBeCloseTo(25, 6)
    expect(failure?.rated).toBeCloseTo(20, 9)
  })

  test('within ratings nothing fires', () => {
    const world = nmosSwitch(5)
    const m1 = [...world.instances.values()].find((i) => i.id === 'm1')
    if (m1?.parameters) {
      m1.parameters.max_drain_current = scalar(0.2, 'ampere')
      m1.parameters.max_gate_source_voltage = scalar(20, 'volt')
    }
    const solution = solveDC(world)
    expect(detectFailures(world, solution).filter((f) => f.source === 'm1')).toEqual([])
  })
})

/**
 * Tunnel-diode (Esaki) tests — the N-shaped I-V with its NEGATIVE-RESISTANCE region. The defining
 * behavior: current rises to a peak (V_P, I_P), then FALLS through a negative-resistance slope to a
 * valley (V_V, I_V), then rises again. These check the model curve and that the DC solver's Newton
 * loop converges through the negative-conductance region.
 */

import { describe, expect, test } from 'vitest'
import type { Instance, World } from '../src/cross-fk-validator.ts'
import { resolveTunnelDiode, solveDC } from '../src/dc-solver.ts'
import { solveTransient } from '../src/transient-solver.ts'
import {
  type TunnelDiodeParams,
  tunnelDiodeCurrent,
  tunnelDiodeOperatingPoint,
  tunnelDiodeSaturationCurrent,
} from '../src/tunnel-diode-model.ts'

// 1N3712-class Ge tunnel diode: I_P = 1 mA at V_P = 65 mV, I_V = 0.12 mA at V_V = 350 mV.
const I_P = 1e-3
const V_P = 0.065
const I_V = 0.12e-3
const V_V = 0.35
const VT = 0.025852
const PARAMS: TunnelDiodeParams = {
  peakCurrent: I_P,
  peakVoltage: V_P,
  saturationCurrent: tunnelDiodeSaturationCurrent(I_P, V_P, I_V, V_V, 1, VT),
  idealityFactor: 1,
  thermalV: VT,
}

function checkDerivative(v: number) {
  const h = 1e-7
  const dNum =
    (tunnelDiodeOperatingPoint(v + h, PARAMS).current -
      tunnelDiodeOperatingPoint(v - h, PARAMS).current) /
    (2 * h)
  expect(Math.abs(tunnelDiodeOperatingPoint(v, PARAMS).conductance - dNum)).toBeLessThan(1e-4)
}

describe('tunnel diode I-V (N-shape with negative resistance)', () => {
  test('reaches the peak current I_P at the peak voltage V_P, with zero slope there', () => {
    const peak = tunnelDiodeOperatingPoint(V_P, PARAMS)
    expect(peak.current).toBeCloseTo(I_P, 6)
    expect(Math.abs(peak.conductance)).toBeLessThan(1e-4) // a peak ⇒ dI/dV ≈ 0
  })

  test('NEGATIVE resistance between the peak and the valley — the defining property', () => {
    expect(tunnelDiodeOperatingPoint(0.15, PARAMS).conductance).toBeLessThan(0)
    expect(tunnelDiodeOperatingPoint(0.25, PARAMS).conductance).toBeLessThan(0)
    // current actually FALLS as voltage rises across the negative-resistance region:
    expect(tunnelDiodeCurrent(0.25, PARAMS)).toBeLessThan(tunnelDiodeCurrent(0.1, PARAMS))
  })

  test('passes ~through the valley point, then rises again (injection region)', () => {
    expect(tunnelDiodeCurrent(V_V, PARAMS)).toBeCloseTo(I_V, 4)
    expect(tunnelDiodeCurrent(0.45, PARAMS)).toBeGreaterThan(I_V) // injection takes over
    expect(tunnelDiodeOperatingPoint(0.45, PARAMS).conductance).toBeGreaterThan(0)
  })

  test('analytic conductance matches finite differences across all three regions', () => {
    checkDerivative(0.03) // rising tunnel current
    checkDerivative(0.2) // negative resistance
    checkDerivative(0.45) // injection
  })
})

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

/** V+(supplyVolts) → R(seriesOhms) → tunnel diode → GND. Returns the solved loop current. */
function tunnelCurrent(supplyVolts: number, seriesOhms: number): number {
  const world: World = {
    definitions: new Map(),
    instances: new Map(),
    behaviors: new Map(),
    activeVariables: new Map(),
    nets: new Map(),
  }
  world.nets.set('vcc', {
    id: 'vcc',
    kind: 'net',
    members: [
      { instance: 'bat', terminal: 'terminal_positive' },
      { instance: 'rs', terminal: 'terminal_a' },
    ],
  })
  world.nets.set('mid', {
    id: 'mid',
    kind: 'net',
    members: [
      { instance: 'rs', terminal: 'terminal_b' },
      { instance: 'td', terminal: 'anode' },
    ],
  })
  world.nets.set('gnd', {
    id: 'gnd',
    kind: 'net',
    type: 'ground',
    members: [
      { instance: 'bat', terminal: 'terminal_negative' },
      { instance: 'td', terminal: 'cathode' },
    ],
  })
  world.instances.set('bat', {
    id: 'bat',
    kind_ref: 'primitive_device',
    definition: 'power_source',
    parameters: { nominal_voltage: scalar(supplyVolts, 'volt') },
    connects: [
      { net: 'vcc', terminal: 'terminal_positive', of: 'bat' },
      { net: 'gnd', terminal: 'terminal_negative', of: 'bat' },
    ],
  })
  world.instances.set('rs', {
    id: 'rs',
    kind_ref: 'primitive_device',
    definition: 'resistor',
    parameters: { resistance: scalar(seriesOhms, 'ohm') },
    connects: [
      { net: 'vcc', terminal: 'terminal_a', of: 'rs' },
      { net: 'mid', terminal: 'terminal_b', of: 'rs' },
    ],
  })
  world.instances.set('td', {
    id: 'td',
    kind_ref: 'primitive_device',
    definition: 'diode_tunnel',
    parameters: {
      peak_current: scalar(I_P, 'ampere'),
      peak_voltage: scalar(V_P, 'volt'),
      valley_current: scalar(I_V, 'ampere'),
      valley_voltage: scalar(V_V, 'volt'),
    },
    connects: [
      { net: 'mid', terminal: 'anode', of: 'td' },
      { net: 'gnd', terminal: 'cathode', of: 'td' },
    ],
  })
  return Math.abs(solveDC(world).branches.get('td') ?? Number.NaN)
}

describe('solveDC — tunnel diode through the Newton loop (negative resistance converges)', () => {
  test('biased near the peak it carries ~I_P; biased past the valley it carries LESS', () => {
    const atPeak = tunnelCurrent(0.065, 1) // ~V_P across the diode (1 Ω drops ~1 mV)
    const pastValley = tunnelCurrent(0.35, 1) // ~V_V across the diode
    expect(atPeak).toBeGreaterThan(pastValley) // MORE current at LOWER voltage = negative resistance
    expect(atPeak).toBeCloseTo(I_P, 4)
  })
})

describe('resolveTunnelDiode — a non-positive ideality is rejected (n > 0; else n·V_T = 0 → NaN)', () => {
  test('ideality_factor > 0 resolves; ≤ 0 returns null (the device is skipped, not stamped as NaN)', () => {
    const td = (ideality: number): Instance =>
      ({
        id: 'td',
        kind_ref: 'primitive_device',
        definition: 'diode_tunnel',
        parameters: {
          peak_current: scalar(I_P, 'ampere'),
          peak_voltage: scalar(V_P, 'volt'),
          valley_current: scalar(I_V, 'ampere'),
          valley_voltage: scalar(V_V, 'volt'),
          ideality_factor: scalar(ideality, 'dimensionless'),
        },
        connects: [
          { net: 'mid', terminal: 'anode', of: 'td' },
          { net: 'gnd', terminal: 'cathode', of: 'td' },
        ],
      }) as unknown as Instance
    expect(resolveTunnelDiode(td(1), VT)).not.toBeNull()
    expect(resolveTunnelDiode(td(0), VT)).toBeNull()
    expect(resolveTunnelDiode(td(-1), VT)).toBeNull()
  })
})

/** V+(supply) → R(1 Ω) → tunnel.anode; tunnel.cathode → GND, solved in the time domain. */
function tunnelTransientCurrent(supplyVolts: number): number {
  const world: World = {
    definitions: new Map(),
    instances: new Map(),
    behaviors: new Map(),
    activeVariables: new Map(),
    nets: new Map(),
  }
  world.nets.set('vcc', {
    id: 'vcc',
    kind: 'net',
    members: [
      { instance: 'bat', terminal: 'terminal_positive' },
      { instance: 'r', terminal: 'terminal_a' },
    ],
  })
  world.nets.set('mid', {
    id: 'mid',
    kind: 'net',
    members: [
      { instance: 'r', terminal: 'terminal_b' },
      { instance: 'td', terminal: 'anode' },
    ],
  })
  world.nets.set('gnd', {
    id: 'gnd',
    kind: 'net',
    type: 'ground',
    members: [
      { instance: 'bat', terminal: 'terminal_negative' },
      { instance: 'td', terminal: 'cathode' },
    ],
  })
  world.instances.set('bat', {
    id: 'bat',
    kind_ref: 'primitive_device',
    definition: 'power_source',
    parameters: { nominal_voltage: scalar(supplyVolts, 'volt') },
    connects: [
      { net: 'vcc', terminal: 'terminal_positive', of: 'bat' },
      { net: 'gnd', terminal: 'terminal_negative', of: 'bat' },
    ],
  })
  world.instances.set('r', {
    id: 'r',
    kind_ref: 'primitive_device',
    definition: 'resistor',
    parameters: { resistance: scalar(1, 'ohm') },
    connects: [
      { net: 'vcc', terminal: 'terminal_a', of: 'r' },
      { net: 'mid', terminal: 'terminal_b', of: 'r' },
    ],
  })
  world.instances.set('td', {
    id: 'td',
    kind_ref: 'primitive_device',
    definition: 'diode_tunnel',
    parameters: {
      peak_current: scalar(I_P, 'ampere'),
      peak_voltage: scalar(V_P, 'volt'),
      valley_current: scalar(I_V, 'ampere'),
      valley_voltage: scalar(V_V, 'volt'),
    },
    connects: [
      { net: 'mid', terminal: 'anode', of: 'td' },
      { net: 'gnd', terminal: 'cathode', of: 'td' },
    ],
  })
  const result = solveTransient(world, { timeStep: 2e-7, duration: 1e-5 })
  const last = result.series[result.series.length - 1]
  return Math.abs(last?.currents?.get('td/anode') ?? 0)
}

describe('solveTransient — the tunnel diode carries its negative-resistance I-V in the time domain', () => {
  test('peak current still exceeds valley current (the NDR survives into transient)', () => {
    // The negative resistance now present in the time loop is what an LC tank turns into a
    // tunnel-diode oscillator; here we confirm the I-V itself is reproduced after the solve settles.
    expect(tunnelTransientCurrent(0.065)).toBeGreaterThan(tunnelTransientCurrent(0.35))
    expect(tunnelTransientCurrent(0.065)).toBeCloseTo(I_P, 3) // ~I_P at the peak voltage
  })
})

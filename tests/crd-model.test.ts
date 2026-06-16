/**
 * Constant-current diode (current-limiting diode) tests. A CRD is an N-channel JFET with its gate
 * tied to its source, so V_GS = 0 and it regulates to its zero-bias current I_DSS = the limiting
 * current I_P once the voltage across it clears the knee. These drive the part through the real DC
 * solver (resolveCrd → the shared MOSFET companion) and check the DEFINING behavior: the current
 * is the same whether the supply is 10 V or 20 V (a plain resistor would double), and it falls
 * below I_P when there is not enough voltage to reach the knee.
 */

import { describe, expect, test } from 'vitest'
import type { World } from '../src/cross-fk-validator.ts'
import { solveDC } from '../src/dc-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

/**
 * V+(supplyVolts) → CRD(anode); CRD(cathode) → Rload → GND. Returns the loop current (through
 * Rload), which is the CRD's regulated current. I_P = 2 mA, knee 1.3 V, λ = 0 (exact regulation).
 */
function crdCurrent(supplyVolts: number, loadOhms: number): number {
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
      { instance: 'crd', terminal: 'anode' },
    ],
  })
  world.nets.set('mid', {
    id: 'mid',
    kind: 'net',
    members: [
      { instance: 'crd', terminal: 'cathode' },
      { instance: 'rload', terminal: 'terminal_a' },
    ],
  })
  world.nets.set('gnd', {
    id: 'gnd',
    kind: 'net',
    type: 'ground',
    members: [
      { instance: 'bat', terminal: 'terminal_negative' },
      { instance: 'rload', terminal: 'terminal_b' },
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
  world.instances.set('crd', {
    id: 'crd',
    kind_ref: 'primitive_device',
    definition: 'diode_constant_current',
    parameters: {
      limiting_current: scalar(2e-3, 'ampere'),
      knee_voltage: scalar(1.3, 'volt'),
      channel_length_modulation: scalar(0, 'per_volt'),
    },
    connects: [
      { net: 'vcc', terminal: 'anode', of: 'crd' },
      { net: 'mid', terminal: 'cathode', of: 'crd' },
    ],
  })
  world.instances.set('rload', {
    id: 'rload',
    kind_ref: 'primitive_device',
    definition: 'resistor',
    parameters: { resistance: scalar(loadOhms, 'ohm') },
    connects: [
      { net: 'mid', terminal: 'terminal_a', of: 'rload' },
      { net: 'gnd', terminal: 'terminal_b', of: 'rload' },
    ],
  })
  const sol = solveDC(world)
  return Math.abs(sol.branches.get('rload') ?? Number.NaN)
}

describe('solveDC — constant-current diode (resolveCrd, JFET gate tied to source)', () => {
  test('regulates to I_P = 2 mA, independent of supply (10 V and 20 V give the same current)', () => {
    const at10 = crdCurrent(10, 1000)
    const at20 = crdCurrent(20, 1000)
    expect(at10).toBeCloseTo(0.002, 5) // I_DSS = I_P, in saturation
    expect(at20).toBeCloseTo(0.002, 5)
    // The defining property: doubling the supply does NOT change the current (a resistor would).
    expect(Math.abs(at20 - at10)).toBeLessThan(1e-6)
  })

  test('below the knee it cannot reach I_P — the current ramps in the triode region', () => {
    // 0.5 V supply cannot put the knee (1.3 V) across the device, so it never saturates.
    expect(crdCurrent(0.5, 10)).toBeLessThan(0.0018)
  })
})

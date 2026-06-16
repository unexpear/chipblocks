/**
 * Laser-diode tests — the L-I (light-vs-current) curve with its lasing threshold. Electrically the
 * laser is an LED-like junction (covered by the diode tests); these check the DEFINING optical
 * behavior: zero output below the threshold current, then a steep linear rise above it, and that
 * the live reading is wired from the solved forward current end to end.
 */

import { describe, expect, test } from 'vitest'
import type { World } from '../src/cross-fk-validator.ts'
import { PHOTON_EV_NM, solveDC } from '../src/dc-solver.ts'
import { laserOpticalPowerW } from '../src/laser-model.ts'
import { partReadings } from '../src/renderer/part-readings.ts'

// 650 nm red laser: I_th = 25 mA, eta_d = 0.3. Photon energy 1239.84/650 = 1.907 eV.
const WAVELENGTH = 650
const I_TH = 0.025
const ETA = 0.3
const PHOTON_V = PHOTON_EV_NM / WAVELENGTH

describe('laser L-I curve (threshold + slope)', () => {
  test('emits nothing at or below the threshold current', () => {
    expect(laserOpticalPowerW(0, I_TH, ETA, WAVELENGTH)).toBe(0)
    expect(laserOpticalPowerW(I_TH, I_TH, ETA, WAVELENGTH)).toBe(0)
    expect(laserOpticalPowerW(0.02, I_TH, ETA, WAVELENGTH)).toBe(0) // below threshold
  })

  test('above threshold, power rises linearly at eta_d · E_photon per amp', () => {
    // 10 mA above threshold → 0.3 · 1.907 V · 0.01 A ≈ 5.72 mW.
    expect(laserOpticalPowerW(0.035, I_TH, ETA, WAVELENGTH)).toBeCloseTo(ETA * PHOTON_V * 0.01, 9)
    // Doubling the above-threshold current doubles the output.
    const p1 = laserOpticalPowerW(0.035, I_TH, ETA, WAVELENGTH)
    const p2 = laserOpticalPowerW(0.045, I_TH, ETA, WAVELENGTH)
    expect(p2).toBeCloseTo(2 * p1, 9)
  })

  test('a bogus device (zero wavelength or efficiency) emits nothing, not a NaN', () => {
    expect(laserOpticalPowerW(0.05, I_TH, ETA, 0)).toBe(0)
    expect(laserOpticalPowerW(0.05, I_TH, 0, WAVELENGTH)).toBe(0)
  })
})

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

/**
 * V+(supplyVolts) → laser(anode); laser(cathode) → Rseries → GND. Returns the laser's live optical
 * output reading (W) — proving the solver → part-readings wiring end to end.
 */
function laserOpticalReading(supplyVolts: number, seriesOhms: number): number | undefined {
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
      { instance: 'ld', terminal: 'anode' },
    ],
  })
  world.nets.set('mid', {
    id: 'mid',
    kind: 'net',
    members: [
      { instance: 'ld', terminal: 'cathode' },
      { instance: 'rs', terminal: 'terminal_a' },
    ],
  })
  world.nets.set('gnd', {
    id: 'gnd',
    kind: 'net',
    type: 'ground',
    members: [
      { instance: 'bat', terminal: 'terminal_negative' },
      { instance: 'rs', terminal: 'terminal_b' },
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
  world.instances.set('ld', {
    id: 'ld',
    kind_ref: 'primitive_device',
    definition: 'diode_laser',
    parameters: {
      forward_voltage: scalar(2.0, 'volt'),
      peak_wavelength: scalar(WAVELENGTH, 'nanometer'),
      threshold_current: scalar(I_TH, 'ampere'),
      external_quantum_efficiency: scalar(ETA, 'dimensionless'),
      max_forward_current: scalar(0.05, 'ampere'),
    },
    connects: [
      { net: 'vcc', terminal: 'anode', of: 'ld' },
      { net: 'mid', terminal: 'cathode', of: 'ld' },
    ],
  })
  world.instances.set('rs', {
    id: 'rs',
    kind_ref: 'primitive_device',
    definition: 'resistor',
    parameters: { resistance: scalar(seriesOhms, 'ohm') },
    connects: [
      { net: 'mid', terminal: 'terminal_a', of: 'rs' },
      { net: 'gnd', terminal: 'terminal_b', of: 'rs' },
    ],
  })
  return partReadings(world, solveDC(world)).get('ld')?.opticalOutputW
}

describe('solveDC + partReadings — laser optical output is wired from the solved current', () => {
  test('driven well above threshold the laser reads positive optical output', () => {
    // 5 V supply, 50 Ω series → after the ~2 V drop, tens of mA forward → above the 25 mA threshold.
    expect(laserOpticalReading(5, 50)).toBeGreaterThan(0)
  })

  test('starved below threshold the optical output reads zero', () => {
    // 1.9 V supply through 1 kΩ → only a fraction of a mA, well below the 25 mA threshold.
    expect(laserOpticalReading(1.9, 1000)).toBe(0)
  })
})

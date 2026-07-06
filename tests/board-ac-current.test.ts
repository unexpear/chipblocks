import { describe, expect, test } from 'vitest'
import type { World } from '../src/cross-fk-validator.ts'
import { boardRmsTerminalCurrents } from '../src/renderer/board-ac-current.ts'

/**
 * The board over-current DRC's AC path: a trace's ampacity is an RMS heating limit, so an AC-driven
 * circuit must be checked against the RMS current, not the DC operating point (which is ~0 A for a
 * pure AC source). boardRmsTerminalCurrents runs a short transient and takes the true RMS of each
 * terminal's current waveform. A pure sine through a resistor: I_rms = (A/√2)/R.
 */

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

/** AC source (amplitude A, frequency f, DC offset Vdc) → R → ground. */
function acResistor(A: number, f: number, R: number, Vdc = 0): World {
  const world: World = {
    definitions: new Map(),
    instances: new Map(),
    behaviors: new Map(),
    activeVariables: new Map(),
    nets: new Map(),
  }
  world.nets.set('a', {
    id: 'a',
    kind: 'net',
    members: [
      { instance: 'src', terminal: 'terminal_positive' },
      { instance: 'r1', terminal: 'terminal_a' },
    ],
  })
  world.nets.set('gnd', {
    id: 'gnd',
    kind: 'net',
    type: 'ground',
    members: [
      { instance: 'src', terminal: 'terminal_negative' },
      { instance: 'r1', terminal: 'terminal_b' },
    ],
  })
  world.instances.set('src', {
    id: 'src',
    kind_ref: 'primitive_device',
    definition: 'power_source',
    parameters: {
      nominal_voltage: scalar(Vdc, 'volt'),
      ac_amplitude: scalar(A, 'volt'),
      frequency: scalar(f, 'hertz'),
    },
    connects: [
      { net: 'a', terminal: 'terminal_positive', of: 'src' },
      { net: 'gnd', terminal: 'terminal_negative', of: 'src' },
    ],
  })
  world.instances.set('r1', {
    id: 'r1',
    kind_ref: 'primitive_device',
    definition: 'resistor',
    parameters: { resistance: scalar(R, 'ohm') },
    connects: [
      { net: 'a', terminal: 'terminal_a', of: 'r1' },
      { net: 'gnd', terminal: 'terminal_b', of: 'r1' },
    ],
  })
  return world
}

describe('boardRmsTerminalCurrents', () => {
  test('a pure sine through a resistor: I_rms = (A/√2)/R at every terminal', () => {
    // 10 V amplitude, 1 kHz, 10 Ω → I_rms = (10/√2)/10 = 0.7071 A.
    const rms = boardRmsTerminalCurrents(acResistor(10, 1000, 10))
    if (rms === undefined) throw new Error('AC circuit should produce RMS currents')
    const expected = 10 / Math.SQRT2 / 10
    expect(rms.get('r1/terminal_a') ?? 0).toBeCloseTo(expected, 2)
    expect(rms.get('r1/terminal_b') ?? 0).toBeCloseTo(expected, 2) // same through-current on both pads
    expect(rms.get('src/terminal_positive') ?? 0).toBeCloseTo(expected, 2)
  })

  test('the RMS is well above the DC operating point (~0) for a pure AC source', () => {
    // The whole point: a DC solve reads ~0 A here, but the trace really carries ~0.7 A RMS.
    const rms = boardRmsTerminalCurrents(acResistor(10, 1000, 10))
    expect(rms?.get('r1/terminal_a') ?? 0).toBeGreaterThan(0.5)
  })

  test('a larger resistor carries proportionally less RMS current', () => {
    const rms = boardRmsTerminalCurrents(acResistor(10, 1000, 100))
    expect(rms?.get('r1/terminal_a') ?? 0).toBeCloseTo(10 / Math.SQRT2 / 100, 2)
  })

  test('a DC circuit (no AC source) returns undefined — the DC currents are used instead', () => {
    expect(boardRmsTerminalCurrents(acResistor(0, 0, 10))).toBeUndefined()
  })
})

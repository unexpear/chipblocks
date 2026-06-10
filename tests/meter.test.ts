/**
 * Multimeter tests (S19-v3-53/54) — the measurements behind the probes:
 *  - terminal-voltage lookup: every wired terminal reads its real solved
 *    voltage; unwired terminals have no entry (the meter says "not wired"
 *    instead of faking 0).
 *  - Ω mode: equivalent resistance by the real powered-off method — source
 *    EMFs zeroed (internal resistance kept), 1 V test source across the
 *    probes, R = V/I from the solved branch current. Open loop → null (OL).
 */

import { describe, expect, test } from 'vitest'
import type { Instance, Net, World } from '../src/cross-fk-validator.ts'
import type { Solution } from '../src/dc-solver.ts'
import {
  acVoltsRms,
  capacitanceTest,
  diodeTest,
  equivalentResistance,
  terminalNets,
  terminalVoltages,
} from '../src/renderer/meter.tsx'

const world: World = {
  definitions: new Map(),
  behaviors: new Map(),
  activeVariables: new Map(),
  nets: new Map(),
  instances: new Map([
    [
      'r1',
      {
        id: 'r1',
        kind_ref: 'primitive_device',
        definition: 'resistor',
        connects: [
          { net: 'net_top', terminal: 'terminal_a', of: 'r1' },
          { net: 'net_bottom', terminal: 'terminal_b', of: 'r1' },
        ],
        // biome-ignore lint/suspicious/noExplicitAny: minimal test fixture
      } as any,
    ],
    [
      'led_1',
      {
        id: 'led_1',
        kind_ref: 'primitive_device',
        definition: 'led',
        // Unwired part: canvasToWorld gives it no connects.
        // biome-ignore lint/suspicious/noExplicitAny: minimal test fixture
      } as any,
    ],
  ]),
}

const solved: Solution = {
  status: 'solved',
  nodes: new Map([
    ['net_top', 8.985],
    ['net_bottom', 1.985],
  ]),
  branches: new Map(),
  ground: 'gnd',
  warnings: [],
  iterations: 1,
  converged: true,
}

describe('terminalVoltages', () => {
  test('wired terminals read their real solved voltage', () => {
    const volts = terminalVoltages(world, solved)
    expect(volts.get('r1/terminal_a')).toBeCloseTo(8.985, 9)
    expect(volts.get('r1/terminal_b')).toBeCloseTo(1.985, 9)
  })
  test('unwired terminals have NO entry — not a fake zero', () => {
    const volts = terminalVoltages(world, solved)
    expect(volts.has('led_1/anode')).toBe(false)
  })
  test('an unsolved circuit yields no readings at all', () => {
    const volts = terminalVoltages(world, { ...solved, status: 'no-ground' })
    expect(volts.size).toBe(0)
  })
})

describe('terminalNets', () => {
  test('each wired terminal maps to its net; unwired terminals are absent', () => {
    const nets = terminalNets(world)
    expect(nets.get('r1/terminal_a')).toBe('net_top')
    expect(nets.get('r1/terminal_b')).toBe('net_bottom')
    expect(nets.has('led_1/anode')).toBe(false)
  })
})

// --- Ω mode -----------------------------------------------------------------

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

function ohmWorld(
  nets: Array<{ id: string; ground?: boolean }>,
  instances: Array<{ id: string; definition: string; parameters: object; connects: string[][] }>,
): World {
  const world: World = {
    definitions: new Map(),
    instances: new Map(),
    behaviors: new Map(),
    activeVariables: new Map(),
    nets: new Map(),
  }
  for (const net of nets) {
    world.nets.set(net.id, {
      id: net.id,
      kind: 'net',
      ...(net.ground ? { type: 'ground' } : {}),
      members: [],
    } as unknown as Net)
  }
  for (const inst of instances) {
    world.instances.set(inst.id, {
      id: inst.id,
      kind_ref: 'primitive_device',
      definition: inst.definition,
      parameters: inst.parameters,
      connects: inst.connects.map(([net, terminal]) => ({ net, terminal, of: inst.id })),
    } as unknown as Instance)
  }
  return world
}

describe('equivalentResistance (Ω mode)', () => {
  test('two resistors in series read their sum', () => {
    const w = ohmWorld(
      [{ id: 'a' }, { id: 'mid' }, { id: 'gnd', ground: true }],
      [
        {
          id: 'r1',
          definition: 'resistor',
          parameters: { resistance: scalar(100, 'ohm') },
          connects: [
            ['a', 'terminal_a'],
            ['mid', 'terminal_b'],
          ],
        },
        {
          id: 'r2',
          definition: 'resistor',
          parameters: { resistance: scalar(220, 'ohm') },
          connects: [
            ['mid', 'terminal_a'],
            ['gnd', 'terminal_b'],
          ],
        },
      ],
    )
    expect(equivalentResistance(w, 'a', 'gnd')).toBeCloseTo(320, 6)
    expect(equivalentResistance(w, 'a', 'mid')).toBeCloseTo(100, 6)
  })

  test('two resistors in parallel read the parallel combination', () => {
    const w = ohmWorld(
      [{ id: 'a' }, { id: 'gnd', ground: true }],
      [
        {
          id: 'r1',
          definition: 'resistor',
          parameters: { resistance: scalar(100, 'ohm') },
          connects: [
            ['a', 'terminal_a'],
            ['gnd', 'terminal_b'],
          ],
        },
        {
          id: 'r2',
          definition: 'resistor',
          parameters: { resistance: scalar(100, 'ohm') },
          connects: [
            ['a', 'terminal_a'],
            ['gnd', 'terminal_b'],
          ],
        },
      ],
    )
    expect(equivalentResistance(w, 'a', 'gnd')).toBeCloseTo(50, 6)
  })

  test("a battery's EMF is zeroed but its internal resistance stays (Thévenin)", () => {
    // 9 V battery (1 Ω internal) in parallel with a 470 Ω resistor. Power off
    // → the battery becomes its 1 Ω internal resistance: R = 1 ∥ 470.
    const w = ohmWorld(
      [{ id: 'vcc' }, { id: 'gnd', ground: true }],
      [
        {
          id: 'bat',
          definition: 'power_source',
          parameters: {
            nominal_voltage: scalar(9, 'volt'),
            internal_resistance: scalar(1, 'ohm'),
          },
          connects: [
            ['vcc', 'terminal_positive'],
            ['gnd', 'terminal_negative'],
          ],
        },
        {
          id: 'r1',
          definition: 'resistor',
          parameters: { resistance: scalar(470, 'ohm') },
          connects: [
            ['vcc', 'terminal_a'],
            ['gnd', 'terminal_b'],
          ],
        },
      ],
    )
    expect(equivalentResistance(w, 'vcc', 'gnd')).toBeCloseTo((1 * 470) / 471, 6)
  })

  test('no conductive path between the probes reads null — OL, like a real meter', () => {
    const w = ohmWorld(
      [{ id: 'a' }, { id: 'mid' }, { id: 'gnd', ground: true }],
      [
        {
          id: 'r1',
          definition: 'resistor',
          parameters: { resistance: scalar(100, 'ohm') },
          connects: [
            ['a', 'terminal_a'],
            ['mid', 'terminal_b'],
          ],
        },
      ],
    )
    expect(equivalentResistance(w, 'a', 'gnd')).toBeNull()
  })

  test('a lone part on the bench measures with NO circuit ground — the meter brings its own reference', () => {
    const w = ohmWorld(
      [{ id: 'a' }, { id: 'b' }],
      [
        {
          id: 'r1',
          definition: 'resistor',
          parameters: { resistance: scalar(4700, 'ohm') },
          connects: [
            ['a', 'terminal_a'],
            ['b', 'terminal_b'],
          ],
        },
      ],
    )
    expect(equivalentResistance(w, 'a', 'b')).toBeCloseTo(4700, 3)
  })

  test('a diode reads OL in Ω mode — the test voltage sits below junction turn-on, like a real DMM', () => {
    const w = ohmWorld(
      [{ id: 'a' }, { id: 'b' }],
      [
        {
          id: 'd1',
          definition: 'led',
          parameters: {
            forward_voltage: scalar(2.1, 'volt'),
            max_forward_current: scalar(0.03, 'ampere'),
          },
          connects: [
            ['a', 'anode'],
            ['b', 'cathode'],
          ],
        },
      ],
    )
    expect(equivalentResistance(w, 'a', 'b')).toBeNull()
  })

  test('both probes on the same net read 0 Ω — continuity', () => {
    const w = ohmWorld([{ id: 'a' }, { id: 'gnd', ground: true }], [])
    expect(equivalentResistance(w, 'a', 'a')).toBe(0)
  })

  test('a closed switch (ideal short) reads 0 Ω, not a solver blow-up', () => {
    // A closed switch stamps as an ideal 0 V source — a dead short. The test
    // source's own series resistance (real meters have it too) is what makes
    // this solvable; the subtraction then lands the reading at 0.
    const w = ohmWorld(
      [{ id: 'a' }, { id: 'b' }],
      [
        {
          id: 'sw1',
          definition: 'switch_spst_toggle',
          parameters: {},
          connects: [
            ['a', 'terminal_in'],
            ['b', 'terminal_out'],
          ],
        },
      ],
    )
    const ohms = equivalentResistance(w, 'a', 'b')
    expect(ohms).not.toBeNull()
    expect(ohms).toBeLessThan(1e-6)
  })
})

// --- ⏵ diode test -------------------------------------------------------------

function loneLed(forwardVolts: number): World {
  return ohmWorld(
    [{ id: 'a' }, { id: 'b' }],
    [
      {
        id: 'd1',
        definition: 'led',
        parameters: {
          forward_voltage: scalar(forwardVolts, 'volt'),
          max_forward_current: scalar(0.03, 'ampere'),
        },
        connects: [
          ['a', 'anode'],
          ['b', 'cathode'],
        ],
      },
    ],
  )
}

describe('diodeTest (⏵ mode)', () => {
  test('forward: reads the junction drop near its rated forward voltage', () => {
    const result = diodeTest(loneLed(2.1), 'a', 'b')
    expect(result).not.toBeNull()
    if (result === null) return
    // At ~0.45 mA (vs the 30 mA rating point) the junction sits a little under
    // its rated drop — the same lower-than-datasheet number a real meter shows.
    expect(result.volts).toBeGreaterThan(1.6)
    expect(result.volts).toBeLessThan(2.1)
    expect(result.amps).toBeGreaterThan(1e-4)
  })

  test('reversed probes read OL — the junction blocks', () => {
    expect(diodeTest(loneLed(2.1), 'b', 'a')).toBeNull()
  })

  test('a forward voltage above the 3 V compliance reads OL — like a real low-compliance meter on a blue LED', () => {
    expect(diodeTest(loneLed(3.6), 'a', 'b')).toBeNull()
  })

  test('a resistor in diode mode shows its real voltage drop at the test current', () => {
    const w = ohmWorld(
      [{ id: 'a' }, { id: 'b' }],
      [
        {
          id: 'r1',
          definition: 'resistor',
          parameters: { resistance: scalar(470, 'ohm') },
          connects: [
            ['a', 'terminal_a'],
            ['b', 'terminal_b'],
          ],
        },
      ],
    )
    const result = diodeTest(w, 'a', 'b')
    expect(result).not.toBeNull()
    if (result === null) return
    // I = 3.0 / (2000 + 470); V = I·470 — real meters show this on resistors too.
    expect(result.volts).toBeCloseTo((3.0 / 2470) * 470, 4)
  })
})

// --- ⊣⊢ capacitance -----------------------------------------------------------

function capWorld(
  parts: Array<{ id: string; definition: string; parameters: object; connects: string[][] }>,
  extraNets: string[] = [],
): World {
  const netIds = new Set<string>(extraNets)
  for (const part of parts) for (const [net] of part.connects) netIds.add(net ?? '')
  return ohmWorld(
    [...netIds].map((id) => ({ id })),
    parts,
  )
}

const capPart = (id: string, farads: number, netA: string, netB: string) => ({
  id,
  definition: 'capacitor',
  parameters: { capacitance: scalar(farads, 'farad') },
  connects: [
    [netA, 'terminal_a'],
    [netB, 'terminal_b'],
  ],
})

describe('capacitanceTest (⊣⊢ mode)', () => {
  const relativeError = (measured: number, expected: number) =>
    Math.abs(measured - expected) / expected

  test('a lone 100 µF capacitor measures from real integrated charge — C = Q/V', () => {
    const result = capacitanceTest(capWorld([capPart('c1', 100e-6, 'a', 'b')]), 'a', 'b')
    expect(result.status).toBe('measured')
    if (result.status !== 'measured') return
    expect(relativeError(result.farads, 100e-6)).toBeLessThan(0.005)
  })

  test('two capacitors in parallel add', () => {
    const w = capWorld([capPart('c1', 100e-6, 'a', 'b'), capPart('c2', 47e-6, 'a', 'b')])
    const result = capacitanceTest(w, 'a', 'b')
    expect(result.status).toBe('measured')
    if (result.status !== 'measured') return
    expect(relativeError(result.farads, 147e-6)).toBeLessThan(0.005)
  })

  test('two capacitors in series halve', () => {
    const w = capWorld([capPart('c1', 100e-6, 'a', 'mid'), capPart('c2', 100e-6, 'mid', 'b')])
    const result = capacitanceTest(w, 'a', 'b')
    expect(result.status).toBe('measured')
    if (result.status !== 'measured') return
    expect(relativeError(result.farads, 50e-6)).toBeLessThan(0.005)
  })

  test('a resistor in parallel keeps current flowing forever — honest refusal, like a real meter', () => {
    const w = capWorld([
      capPart('c1', 100e-6, 'a', 'b'),
      {
        id: 'r1',
        definition: 'resistor',
        parameters: { resistance: scalar(470, 'ohm') },
        connects: [
          ['a', 'terminal_a'],
          ['b', 'terminal_b'],
        ],
      },
    ])
    expect(capacitanceTest(w, 'a', 'b').status).toBe('parallel-leak')
  })

  test('a pure resistor between the probes is also a leak — no capacitance to read', () => {
    const w = capWorld([
      {
        id: 'r1',
        definition: 'resistor',
        parameters: { resistance: scalar(470, 'ohm') },
        connects: [
          ['a', 'terminal_a'],
          ['b', 'terminal_b'],
        ],
      },
    ])
    expect(capacitanceTest(w, 'a', 'b').status).toBe('parallel-leak')
  })

  test('a 1 F capacitor charges past the longest window — over range', () => {
    const result = capacitanceTest(capWorld([capPart('c1', 1, 'a', 'b')]), 'a', 'b')
    expect(result.status).toBe('over-range')
  })

  test('no conductive path between the probes reads open', () => {
    // The capacitor hangs off net a toward mid; net b only reaches gnd — there
    // is nothing between the probe pair.
    const w = capWorld(
      [
        capPart('c1', 100e-6, 'a', 'mid'),
        {
          id: 'r1',
          definition: 'resistor',
          parameters: { resistance: scalar(1000, 'ohm') },
          connects: [
            ['b', 'terminal_a'],
            ['gnd', 'terminal_b'],
          ],
        },
      ],
      ['b'],
    )
    expect(capacitanceTest(w, 'a', 'b').status).toBe('open')
  })
})

// --- V~ true-RMS --------------------------------------------------------------

describe('acVoltsRms (V~ mode)', () => {
  test('a sine source reads amplitude/√2 rms and its real frequency', () => {
    const w = ohmWorld(
      [{ id: 'live' }, { id: 'gnd', ground: true }],
      [
        {
          id: 'src',
          definition: 'power_source',
          parameters: {
            nominal_voltage: scalar(0, 'volt'),
            ac_amplitude: scalar(10, 'volt'),
            frequency: scalar(60, 'hertz'),
            internal_resistance: scalar(1, 'ohm'),
          },
          connects: [
            ['live', 'terminal_positive'],
            ['gnd', 'terminal_negative'],
          ],
        },
        {
          id: 'r1',
          definition: 'resistor',
          parameters: { resistance: scalar(1000, 'ohm') },
          connects: [
            ['live', 'terminal_a'],
            ['gnd', 'terminal_b'],
          ],
        },
      ],
    )
    const result = acVoltsRms(w, 'live', 'gnd')
    expect(result).not.toBeNull()
    if (result === null || result === 'span-too-wide') return
    // 10 V amplitude × (1000/1001) divider → rms ≈ 7.06 V; backward-Euler at
    // ~167 steps/cycle attenuates slightly, so the tolerance is loose-but-real.
    expect(Math.abs(result.rms - 10 / Math.sqrt(2))).toBeLessThan(0.2)
    expect(result.hz).not.toBeNull()
    if (result.hz === null) return
    expect(Math.abs(result.hz - 60)).toBeLessThan(1.5)
  })

  test('two sources decades apart: the fast one is sampled, not aliased — RMS adds in quadrature', () => {
    // 10 V @ 60 Hz in series with 1 V @ 5 kHz into 1 kΩ. The window follows the
    // slow source; sampling must follow the FAST one (≥32 points/period) or the
    // 5 kHz part aliases. Orthogonal components: rms² = rms₁² + rms₂².
    const w = ohmWorld(
      [{ id: 'live' }, { id: 'mid' }, { id: 'gnd', ground: true }],
      [
        {
          id: 'src_slow',
          definition: 'power_source',
          parameters: {
            nominal_voltage: scalar(0, 'volt'),
            ac_amplitude: scalar(10, 'volt'),
            frequency: scalar(60, 'hertz'),
            internal_resistance: scalar(1, 'ohm'),
          },
          connects: [
            ['live', 'terminal_positive'],
            ['mid', 'terminal_negative'],
          ],
        },
        {
          id: 'src_fast',
          definition: 'power_source',
          parameters: {
            nominal_voltage: scalar(0, 'volt'),
            ac_amplitude: scalar(1, 'volt'),
            frequency: scalar(5000, 'hertz'),
            internal_resistance: scalar(1, 'ohm'),
          },
          connects: [
            ['mid', 'terminal_positive'],
            ['gnd', 'terminal_negative'],
          ],
        },
        {
          id: 'r1',
          definition: 'resistor',
          parameters: { resistance: scalar(1000, 'ohm') },
          connects: [
            ['live', 'terminal_a'],
            ['gnd', 'terminal_b'],
          ],
        },
      ],
    )
    const result = acVoltsRms(w, 'live', 'gnd')
    expect(result).not.toBeNull()
    expect(result).not.toBe('span-too-wide')
    if (result === null || result === 'span-too-wide') return
    const divider = 1000 / 1002
    const expected = divider * Math.sqrt((10 * 10 + 1 * 1) / 2)
    expect(Math.abs(result.rms - expected)).toBeLessThan(0.1)
    // The hysteresis band (±10 % of peak ≈ ±1.1 V) is wider than the 1 V ripple,
    // so the counter still reads the 60 Hz fundamental, not ripple crossings.
    expect(result.hz).not.toBeNull()
    if (result.hz === null) return
    expect(Math.abs(result.hz - 60)).toBeLessThan(1.5)
  })

  test('sources too many decades apart refuse honestly instead of aliasing', () => {
    const w = ohmWorld(
      [{ id: 'live' }, { id: 'mid' }, { id: 'gnd', ground: true }],
      [
        {
          id: 'src_slow',
          definition: 'power_source',
          parameters: {
            nominal_voltage: scalar(0, 'volt'),
            ac_amplitude: scalar(5, 'volt'),
            frequency: scalar(0.1, 'hertz'),
            internal_resistance: scalar(1, 'ohm'),
          },
          connects: [
            ['live', 'terminal_positive'],
            ['mid', 'terminal_negative'],
          ],
        },
        {
          id: 'src_fast',
          definition: 'power_source',
          parameters: {
            nominal_voltage: scalar(0, 'volt'),
            ac_amplitude: scalar(1, 'volt'),
            frequency: scalar(1e6, 'hertz'),
            internal_resistance: scalar(1, 'ohm'),
          },
          connects: [
            ['mid', 'terminal_positive'],
            ['gnd', 'terminal_negative'],
          ],
        },
        {
          id: 'r1',
          definition: 'resistor',
          parameters: { resistance: scalar(1000, 'ohm') },
          connects: [
            ['live', 'terminal_a'],
            ['gnd', 'terminal_b'],
          ],
        },
      ],
    )
    expect(acVoltsRms(w, 'live', 'gnd')).toBe('span-too-wide')
  })

  test('a half-wave rectified hump (strongly asymmetric) still counts the true source frequency', () => {
    // Rising-edge-only counting is what makes this exact: consecutive rising
    // transitions are one full period apart for ANY periodic shape. Counting
    // both edge directions would misread this waveform by ~7 %.
    const w = ohmWorld(
      [{ id: 'live' }, { id: 'out' }, { id: 'gnd', ground: true }],
      [
        {
          id: 'src',
          definition: 'power_source',
          parameters: {
            nominal_voltage: scalar(0, 'volt'),
            ac_amplitude: scalar(10, 'volt'),
            frequency: scalar(60, 'hertz'),
            internal_resistance: scalar(1, 'ohm'),
          },
          connects: [
            ['live', 'terminal_positive'],
            ['gnd', 'terminal_negative'],
          ],
        },
        {
          id: 'd1',
          definition: 'diode_silicon_rectifier',
          parameters: {
            forward_voltage: scalar(0.7, 'volt'),
            max_forward_current: scalar(1, 'ampere'),
          },
          connects: [
            ['live', 'anode'],
            ['out', 'cathode'],
          ],
        },
        {
          id: 'r1',
          definition: 'resistor',
          parameters: { resistance: scalar(1000, 'ohm') },
          connects: [
            ['out', 'terminal_a'],
            ['gnd', 'terminal_b'],
          ],
        },
      ],
    )
    const result = acVoltsRms(w, 'out', 'gnd')
    expect(result).not.toBeNull()
    expect(result).not.toBe('span-too-wide')
    if (result === null || result === 'span-too-wide') return
    // AC-coupled rms of a ~9.3 V half-sine hump train ≈ 3.6 V — loose real bounds.
    expect(result.rms).toBeGreaterThan(3.0)
    expect(result.rms).toBeLessThan(4.2)
    expect(result.hz).not.toBeNull()
    if (result.hz === null) return
    expect(Math.abs(result.hz - 60)).toBeLessThan(1.5)
  })

  test('a square wave reads rms = amplitude — the true-RMS difference from a sine', () => {
    // An AC-coupled ±A square has rms exactly A, where a sine of the same peak
    // reads A/√2 ≈ 0.707·A — the entire reason true-RMS meters exist (an
    // average-responding meter calibrated for sines misreads square waves).
    const w = ohmWorld(
      [{ id: 'live' }, { id: 'gnd', ground: true }],
      [
        {
          id: 'clk',
          definition: 'power_source',
          parameters: {
            nominal_voltage: scalar(2.5, 'volt'),
            ac_amplitude: scalar(2.5, 'volt'),
            frequency: scalar(100, 'hertz'),
            internal_resistance: scalar(1, 'ohm'),
            waveform: { value: 'square' },
          },
          connects: [
            ['live', 'terminal_positive'],
            ['gnd', 'terminal_negative'],
          ],
        },
        {
          id: 'r1',
          definition: 'resistor',
          parameters: { resistance: scalar(1000, 'ohm') },
          connects: [
            ['live', 'terminal_a'],
            ['gnd', 'terminal_b'],
          ],
        },
      ],
    )
    const result = acVoltsRms(w, 'live', 'gnd')
    expect(result).not.toBeNull()
    expect(result).not.toBe('span-too-wide')
    if (result === null || result === 'span-too-wide') return
    const amplitude = 2.5 * (1000 / 1001)
    expect(Math.abs(result.rms - amplitude)).toBeLessThan(0.05)
    expect(result.hz).not.toBeNull()
    if (result.hz === null) return
    expect(Math.abs(result.hz - 100)).toBeLessThan(1.5)
  })

  test('a steady DC circuit reads ~0 V~ and no frequency — AC-coupled, like a real V~ range', () => {
    const w = ohmWorld(
      [{ id: 'vcc' }, { id: 'gnd', ground: true }],
      [
        {
          id: 'bat',
          definition: 'power_source',
          parameters: {
            nominal_voltage: scalar(9, 'volt'),
            internal_resistance: scalar(1, 'ohm'),
          },
          connects: [
            ['vcc', 'terminal_positive'],
            ['gnd', 'terminal_negative'],
          ],
        },
        {
          id: 'r1',
          definition: 'resistor',
          parameters: { resistance: scalar(470, 'ohm') },
          connects: [
            ['vcc', 'terminal_a'],
            ['gnd', 'terminal_b'],
          ],
        },
      ],
    )
    const result = acVoltsRms(w, 'vcc', 'gnd')
    expect(result).not.toBeNull()
    if (result === null || result === 'span-too-wide') return
    expect(result.rms).toBeLessThan(0.05)
    expect(result.hz).toBeNull()
  })
})

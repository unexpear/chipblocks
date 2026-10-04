import { describe, expect, test } from 'vitest'
import { acResponse } from '../src/ac-analysis.ts'
import type { World } from '../src/cross-fk-validator.ts'
import { solveDC } from '../src/dc-solver.ts'
import { NAND2_BLOCK } from '../src/renderer/builtin-blocks.ts'
import { runTrace } from '../src/renderer/run-trace.ts'
import {
  acTestSignals,
  dcTestSignals,
  digitalTestSignals,
  transientTestSignals,
} from '../src/renderer/simulation-test-results.ts'
import { runElectricalTestCopy } from '../src/renderer/simulation-test-runner.ts'
import {
  evaluateAssertion,
  type SimulationAssertion,
  type TestSeries,
} from '../src/simulation-assertions.ts'
import { solveTransient } from '../src/transient-solver.ts'

function rcWorld(): World {
  const world: World = {
    definitions: new Map(),
    instances: new Map(),
    nets: new Map(),
    behaviors: new Map(),
    activeVariables: new Map(),
  }
  const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
  for (const [id, definition, parameters, connections] of [
    [
      'source',
      'power_source',
      { nominal_voltage: scalar(1, 'volt') },
      [
        ['terminal_positive', 'in'],
        ['terminal_negative', 'gnd'],
      ],
    ],
    [
      'resistor',
      'resistor',
      { resistance: scalar(1000, 'ohm') },
      [
        ['terminal_a', 'in'],
        ['terminal_b', 'out'],
      ],
    ],
    [
      'capacitor',
      'capacitor',
      { capacitance: scalar(1e-6, 'farad') },
      [
        ['terminal_a', 'out'],
        ['terminal_b', 'gnd'],
      ],
    ],
  ] as const) {
    world.instances.set(id, {
      id,
      definition,
      kind_ref: 'primitive_device',
      parameters,
      connects: connections.map(([terminal, net]) => ({ terminal, net, of: id })),
    })
    for (const [terminal, netId] of connections) {
      let net = world.nets.get(netId)
      if (!net) {
        net = {
          id: netId,
          kind: 'net',
          members: [],
          ...(netId === 'gnd' ? { type: 'ground' } : {}),
        }
        world.nets.set(netId, net)
      }
      net.members.push({ instance: id, terminal })
    }
  }
  return world
}

const provenance = 'RC fixture: source=1 V; R=1000 ohm; C=1 microfarad'
const check = (
  signal: TestSeries | undefined,
  expected: number,
  changes: Partial<SimulationAssertion> = {},
) =>
  evaluateAssertion(
    {
      id: 'check',
      label: 'Analytic reference',
      signal: 'probe',
      unit: signal?.unit ?? 'volt',
      measurement: { kind: 'point', at: 0 },
      expected: { kind: 'near', value: expected, absolute: 1e-8, relative: 0 },
      provenance: { kind: 'analytic', description: 'Closed-form RC response' },
      ...changes,
    },
    signal,
  )

describe('analysis to unified test-result adapters', () => {
  test.each([
    'esr',
    'dissipation_factor',
  ])('transient tests refuse silently ignored capacitor %s', (parameter) => {
    const world = rcWorld()
    const capacitor = world.instances.get('capacitor')
    if (!capacitor) throw new Error('Missing capacitor')
    capacitor.parameters = {
      ...capacitor.parameters,
      [parameter]: {
        value: { kind: 'scalar', amount: 0.2, unit: parameter === 'esr' ? 'ohm' : 'dimensionless' },
      },
    }
    const result = runElectricalTestCopy(
      world,
      { kind: 'transient', projectAmbientC: 25, timeStep: 1e-5, duration: 2e-5 },
      [
        {
          id: 'voltage',
          label: 'Source',
          signal: 'voltage:in',
          unit: 'volt',
          measurement: { kind: 'point', at: 1e-5 },
          expected: { kind: 'near', value: 1, absolute: 0.001, relative: 0 },
          provenance: { kind: 'analytic', description: 'Ideal source: 1 V' },
        },
      ],
    )
    expect(result.passed).toBe(false)
    expect(result.reports[0]?.status).toBe('unavailable')
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'unsupported-transient-capacitor-loss',
        targets: [{ blockId: 'capacitor' }],
      }),
    )
    expect(result.warnings.join(' ')).toContain(parameter)
  })
  test('DC voltage and KCL come from the actual solved circuit', () => {
    const world = rcWorld()
    const solution = solveDC(world)
    expect(solution.status).toBe('solved')
    const signals = dcTestSignals(world, solution, provenance, new Map(), true)
    expect(check(signals.get('voltage:out'), 1).status).toBe('pass')
    expect(check(signals.get('kcl:out'), 0).status).toBe('pass')
    expect(check(signals.get('temperature:resistor'), 25).status).toBe('unavailable')
    expect(signals.get('voltage:out')?.targets).toEqual([{ netId: 'out' }])
    expect(signals.get('voltage:out')?.provenance.inputs).toBe(provenance)
  })
  test('does not certify unsupported DC models or nonconverged thermal readings', () => {
    const world = rcWorld()
    const solution = solveDC(world)
    const unsupported = dcTestSignals(
      world,
      { ...solution, status: 'unsupported-element', warnings: ['unsupported test device'] },
      provenance,
      new Map(),
      true,
    )
    expect(check(unsupported.get('voltage:out'), 1).status).toBe('unavailable')
    expect(unsupported.get('voltage:out')?.warnings).toContain('unsupported test device')
    const thermal = dcTestSignals(world, solution, provenance, new Map([['resistor', 50]]), false)
    expect(check(thermal.get('temperature:resistor'), 50).status).toBe('unavailable')
  })
  test('AC gain and phase match the RC corner including the documented 1 nS ground shunt', () => {
    const frequency = 1 / (2 * Math.PI * 1000 * 1e-6)
    const points = [acResponse(rcWorld(), { inputSource: 'source', outputNet: 'out' }, frequency)]
    const signals = acTestSignals(points, 'source', 'out', provenance, [], true)
    const expectedGain = 1 / Math.hypot(1 + 1000 * 1e-9, 1)
    const expectedPhase = (-Math.atan2(1, 1 + 1000 * 1e-9) * 180) / Math.PI
    const reference = {
      kind: 'analytic' as const,
      description: 'H = 1 / (1 + R*Gmin + j*w*R*C); Gmin=1 nS',
    }
    expect(
      check(signals.get('gain:out'), expectedGain, {
        measurement: { kind: 'point', at: frequency },
        provenance: reference,
      }).status,
    ).toBe('pass')
    expect(
      check(signals.get('phaseDeg:out'), expectedPhase, {
        measurement: { kind: 'point', at: frequency },
        provenance: reference,
      }).status,
    ).toBe('pass')
    const unsupported = acTestSignals(
      points,
      'source',
      'out',
      provenance,
      ['unmodeled part'],
      false,
    )
    expect(
      check(unsupported.get('gain:out'), 1 / Math.sqrt(2), {
        measurement: { kind: 'point', at: frequency },
      }).status,
    ).toBe('unavailable')
  })
  test('real transient samples support waveform, timing, signed power, energy, and KCL assertions', () => {
    const world = rcWorld()
    const result = solveTransient(world, { timeStep: 1e-5, duration: 0.005 })
    expect(result.status).toBe('solved')
    const signals = transientTestSignals(
      world,
      result,
      `${provenance}; dt=10us; duration=5ms; capacitor initially uncharged`,
    )
    const first = result.series[1]?.time
    const last = result.series.at(-1)?.time
    if (first === undefined || last === undefined) throw new Error('missing transient samples')
    expect(
      check(signals.get('voltage:out'), 1 - Math.exp(-5), {
        measurement: { kind: 'point', at: last },
        expected: { kind: 'near', value: 1 - Math.exp(-5), absolute: 0.001, relative: 0 },
      }).status,
    ).toBe('pass')
    expect(
      check(signals.get('voltage:out'), 0.001 * Math.log(2), {
        unit: 'second',
        measurement: {
          kind: 'crossing',
          from: first,
          to: last,
          threshold: 0.5,
          direction: 'rising',
        },
        expected: { kind: 'near', value: 0.001 * Math.log(2), absolute: 2e-5, relative: 0 },
      }).status,
    ).toBe('pass')
    expect(
      check(signals.get('voltage:out'), 0.004, {
        unit: 'second',
        measurement: { kind: 'settling', from: first, to: last, finalValue: 1, band: 0.02 },
        expected: { kind: 'range', minimum: 0.0038, maximum: 0.0041 },
      }).status,
    ).toBe('pass')
    expect(
      check(signals.get('kcl:out'), 0, { measurement: { kind: 'maximum', from: first, to: last } })
        .status,
    ).toBe('pass')
    expect(
      check(signals.get('power-balance'), 0, {
        measurement: { kind: 'maximum', from: first, to: last },
      }).status,
    ).toBe('pass')
    expect(
      check(signals.get('power-balance'), 0, {
        unit: 'joule',
        measurement: { kind: 'integral', from: first, to: last },
      }).status,
    ).toBe('pass')
    expect(signals.get('power:source')?.samples[1]?.value).toBeLessThan(0)
    expect(signals.get('power:resistor')?.samples[1]?.value).toBeGreaterThan(0)
  })
  test('integrated device energies match independent RC storage and dissipation formulas', () => {
    const world = rcWorld()
    const result = solveTransient(world, { timeStep: 2e-6, duration: 0.005 })
    expect(result.status).toBe('solved')
    const signals = transientTestSignals(world, result, provenance)
    const from = result.series[1]?.time
    const to = result.series.at(-1)?.time
    if (from === undefined || to === undefined) throw new Error('Missing energy window')
    const capacitance = 1e-6
    const initialDecay = Math.exp(-from / 0.001)
    const finalDecay = Math.exp(-to / 0.001)
    const supplied = capacitance * (initialDecay - finalDecay)
    const dissipated = (capacitance / 2) * (initialDecay ** 2 - finalDecay ** 2)
    const stored = (capacitance / 2) * ((1 - finalDecay) ** 2 - (1 - initialDecay) ** 2)
    expect(supplied - dissipated - stored).toBeCloseTo(0, 18)
    for (const [device, energy, formula] of [
      ['source', -supplied, '-C*Vs^2*(exp(-a/RC)-exp(-b/RC))'],
      ['resistor', dissipated, 'C*Vs^2/2*(exp(-2a/RC)-exp(-2b/RC))'],
      ['capacitor', stored, 'C/2*(Vc(b)^2-Vc(a)^2); Vc(t)=Vs*(1-exp(-t/RC))'],
    ] as const) {
      const report = check(signals.get(`power:${device}`), energy, {
        unit: 'joule',
        measurement: { kind: 'integral', from, to },
        expected: { kind: 'near', value: energy, absolute: 4e-9, relative: 0 },
        provenance: {
          kind: 'analytic',
          description: `${formula}; Vs=1 V, R=1000 ohm, C=1 uF; 4 nJ allowance for backward-Euler and sampled quadrature at dt=2 us. https://openstax.org/books/college-physics-2e/pages/19-7-energy-stored-in-capacitors`,
        },
      })
      expect(report.status, `${device}: ${report.actual} versus ${energy}`).toBe('pass')
    }
  })
  test('missing terminal currents invalidate conservation rather than disappearing from sums', () => {
    const world = rcWorld()
    const result = solveTransient(world, { timeStep: 1e-5, duration: 2e-5 })
    for (const point of result.series) point.currents?.delete('resistor/terminal_b')
    const signals = transientTestSignals(world, result, provenance)
    expect(signals.get('kcl:out')?.samples.every((sample) => sample.value === null)).toBe(true)
    expect(signals.get('power-balance')?.samples.every((sample) => sample.value === null)).toBe(
      true,
    )
  })
  test('digital signals retain exact cycle, block identity, and real gate values', () => {
    const trace = runTrace(
      NAND2_BLOCK,
      2,
      new Map([
        ['a', 1],
        ['b', 1],
      ]),
    )
    if (!trace) throw new Error('trace not created')
    const signals = digitalTestSignals(trace, 'nand', 'a=1, b=1; 2 cycles')
    expect(check(signals.get('out'), 0, { measurement: { kind: 'point', at: 2 } })).toMatchObject({
      status: 'pass',
      at: 2,
      axis: 'cycle',
      targets: [{ blockId: 'nand' }],
    })
  })
})

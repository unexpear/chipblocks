import { describe, expect, test } from 'vitest'
import { asNetId } from '../src/runtime-contracts.ts'
import {
  evaluateAssertion,
  evaluateAssertions,
  type SimulationAssertion,
  type TestSeries,
} from '../src/simulation-assertions.ts'

const series = (values = [0, 2, 4]): TestSeries => ({
  axis: 'second',
  unit: 'volt',
  status: 'complete',
  samples: values.map((value, at) => ({ at, value })),
  targets: [{ netId: asNetId('out') }],
  provenance: { engine: 'fixture', inputs: 'linear ramp, 2 volts/second', formula: 'V = 2t' },
  warnings: [],
})
const assertion = (changes: Partial<SimulationAssertion> = {}): SimulationAssertion => ({
  id: 'voltage',
  label: 'Ramp at one second',
  signal: 'out',
  unit: 'volt',
  measurement: { kind: 'point', at: 1 },
  expected: { kind: 'near', value: 2, absolute: 0, relative: 0 },
  provenance: { kind: 'analytic', description: 'V = 2t' },
  ...changes,
})

describe('shared simulation assertions', () => {
  test('reports actual sample, target, formula, and provenance', () => {
    const result = evaluateAssertion(assertion(), series())
    expect(result).toMatchObject({ status: 'pass', actual: 2, at: 1, axis: 'second' })
    expect(result.targets).toEqual([{ netId: 'out' }])
    expect(result.provenance?.inputs).toContain('2 volts/second')
    expect(result.formula).toContain('absolute + relative')
  })
  test('reports failures with expected/actual and a repair, not only a red flag', () => {
    const result = evaluateAssertion(assertion(), series([0, 3, 4]))
    expect(result.status).toBe('fail')
    expect(result.actual).toBe(3)
    expect(result.assertion.expected).toMatchObject({ value: 2 })
    expect(result.repair).toContain('block/net')
  })
  test('uses explicit absolute plus expected-relative tolerance, including expected zero', () => {
    expect(
      evaluateAssertion(
        assertion({ expected: { kind: 'near', value: 2, absolute: 0.125, relative: 0.0625 } }),
        series([0, 2.25, 4]),
      ).status,
    ).toBe('pass')
    expect(
      evaluateAssertion(
        assertion({ expected: { kind: 'near', value: 0, absolute: 0.125, relative: 100 } }),
        series([0, 0.25, 4]),
      ).status,
    ).toBe('fail')
  })
  test.each([
    undefined,
    { ...series(), status: 'incomplete' as const },
    { ...series(), status: 'unsupported' as const },
    { ...series(), samples: [] },
  ])('never passes absent or incomplete analysis', (input) => {
    expect(evaluateAssertion(assertion(), input).status).toBe('unavailable')
  })
  test.each([
    Number.NaN,
    Infinity,
    null,
  ])('does not turn missing or invalid readings into zero: %s', (value) => {
    expect(
      evaluateAssertion(assertion(), { ...series(), samples: [{ at: 1, value }] }).status,
    ).toBe('unavailable')
  })
  test('does not guess, interpolate, or extrapolate requested point samples', () => {
    for (const at of [0.5, 3])
      expect(
        evaluateAssertion(assertion({ measurement: { kind: 'point', at } }), series()).status,
      ).toBe('unavailable')
  })
  test('rejects bad tolerances, windows, units, provenance, and coordinates', () => {
    expect(
      evaluateAssertion(
        assertion({ expected: { kind: 'near', value: 2, absolute: -1, relative: 0 } }),
        series(),
      ).status,
    ).toBe('invalid')
    expect(
      evaluateAssertion(assertion({ measurement: { kind: 'maximum', from: 2, to: 1 } }), series())
        .status,
    ).toBe('invalid')
    expect(evaluateAssertion(assertion({ unit: 'ampere' }), series()).status).toBe('invalid')
    expect(
      evaluateAssertion(assertion({ provenance: { kind: 'manual', description: '' } }), series())
        .status,
    ).toBe('invalid')
    expect(
      evaluateAssertion(assertion(), {
        ...series(),
        samples: [
          { at: 1, value: 2 },
          { at: 1, value: 2 },
        ],
      }).status,
    ).toBe('unavailable')
  })
  test('locates extrema and requires complete bounded-window coverage', () => {
    const request = assertion({
      measurement: { kind: 'maximum', from: 0, to: 2 },
      expected: { kind: 'range', minimum: 3, maximum: 4 },
    })
    expect(evaluateAssertion(request, series())).toMatchObject({ status: 'pass', actual: 4, at: 2 })
    expect(
      evaluateAssertion({ ...request, measurement: { kind: 'maximum', from: 0, to: 3 } }, series())
        .status,
    ).toBe('unavailable')
    expect(
      evaluateAssertion({ ...request, measurement: { kind: 'minimum', from: 0, to: 2 } }, series()),
    ).toMatchObject({ status: 'fail', actual: 0, at: 0 })
  })
  test('integrates signed power on nonuniform time steps with joule units', () => {
    const input = {
      ...series(),
      unit: 'watt' as const,
      samples: [
        { at: 0, value: -2 },
        { at: 0.5, value: -1 },
        { at: 2, value: 2 },
      ],
    }
    const request = assertion({
      measurement: { kind: 'integral', from: 0, to: 2 },
      unit: 'joule',
      expected: { kind: 'near', value: 0, absolute: 1e-12, relative: 0 },
    })
    expect(evaluateAssertion(request, input)).toMatchObject({ status: 'pass', actual: 0 })
    expect(evaluateAssertion(request, series()).status).toBe('invalid')
  })
  test('reports directed crossing coordinates and interpolation bracket', () => {
    const request = assertion({
      measurement: { kind: 'crossing', from: 0, to: 2, threshold: 3, direction: 'rising' },
      unit: 'second',
      expected: { kind: 'near', value: 1.5, absolute: 0, relative: 0 },
    })
    expect(evaluateAssertion(request, series())).toMatchObject({
      status: 'pass',
      actual: 1.5,
      at: 1.5,
    })
    expect(evaluateAssertion(request, series()).detail).toContain('between 1 and 2')
    expect(
      evaluateAssertion(
        {
          ...request,
          measurement: { kind: 'crossing', from: 0, to: 2, threshold: 3, direction: 'falling' },
        },
        series(),
      ).status,
    ).toBe('unavailable')
  })
  test('settling requires staying in an explicit band, not just touching it', () => {
    const input = series([0, 1, 0.5, 1, 1])
    const request = assertion({
      measurement: { kind: 'settling', from: 0, to: 4, finalValue: 1, band: 0.01 },
      unit: 'second',
      expected: { kind: 'near', value: 3, absolute: 0, relative: 0 },
    })
    expect(evaluateAssertion(request, input)).toMatchObject({ status: 'pass', actual: 3 })
    expect(evaluateAssertion(request, series([0, 0, 0, 0, 1])).status).toBe('unavailable')
    expect(evaluateAssertion(request, input).detail).toContain('only through 4')
  })
  test('compares phase with shortest angular distance at an exact frequency', () => {
    const input = {
      ...series(),
      axis: 'hertz' as const,
      unit: 'degree' as const,
      samples: [{ at: 100, value: -179 }],
    }
    const request = assertion({
      unit: 'degree',
      measurement: { kind: 'point', at: 100 },
      expected: { kind: 'near', value: 179, absolute: 2, relative: 0 },
    })
    expect(evaluateAssertion(request, input)).toMatchObject({
      status: 'pass',
      at: 100,
      axis: 'hertz',
    })
  })
  test('empty and duplicate-ID suites cannot pass', () => {
    expect(evaluateAssertions([], new Map()).passed).toBe(false)
    const result = evaluateAssertions([assertion(), assertion()], new Map([['out', series()]]))
    expect(result.passed).toBe(false)
    expect(result.reports.every((report) => report.status === 'invalid')).toBe(true)
  })
})

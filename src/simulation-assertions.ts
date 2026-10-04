import type { RuntimeTarget, Unit } from './runtime-contracts.ts'

export type TestUnit = Unit | 'joule' | 'decibel' | 'degree'
export type TestAxis = 'operating-point' | 'cycle' | 'second' | 'hertz'
export type TestSample = { at: number; value: number | null }
export type TestSeries = {
  axis: TestAxis
  unit: TestUnit
  samples: TestSample[]
  status: 'complete' | 'incomplete' | 'unsupported'
  targets: RuntimeTarget[]
  provenance: { engine: string; inputs: string; formula: string }
  warnings: string[]
}

export type TestMeasurement =
  | { kind: 'point'; at: number }
  | { kind: 'minimum'; from: number; to: number }
  | { kind: 'maximum'; from: number; to: number }
  | { kind: 'integral'; from: number; to: number }
  | {
      kind: 'crossing'
      from: number
      to: number
      threshold: number
      direction: 'rising' | 'falling'
    }
  | {
      kind: 'settling'
      from: number
      to: number
      finalValue: number
      band: number
    }

export type TestExpectation =
  | { kind: 'near'; value: number; absolute: number; relative: number }
  | { kind: 'range'; minimum: number; maximum: number }

export type SimulationAssertion = {
  probe?: {
    kind: 'terminal-voltage' | 'net-kcl' | 'ac-output'
    blockId: string
    terminalId: string
  }
  id: string
  label: string
  signal: string
  measurement: TestMeasurement
  expected: TestExpectation
  unit: TestUnit
  provenance: { kind: 'analytic' | 'manual' | 'captured'; description: string }
}

export type AssertionReport = {
  assertion: SimulationAssertion
  status: 'pass' | 'fail' | 'unavailable' | 'invalid'
  actual: number | null
  at: number | null
  axis: TestAxis | null
  targets: RuntimeTarget[]
  provenance: TestSeries['provenance'] | null
  warnings: string[]
  formula: string
  detail: string
  repair: string
}

const finite = (value: number): boolean => Number.isFinite(value)
const tolerance = (expected: Extract<TestExpectation, { kind: 'near' }>): number =>
  expected.absolute + expected.relative * Math.abs(expected.value)

function validExpectation(expected: TestExpectation): boolean {
  return expected.kind === 'near'
    ? [expected.value, expected.absolute, expected.relative].every(finite) &&
        expected.absolute >= 0 &&
        expected.relative >= 0 &&
        finite(tolerance(expected))
    : finite(expected.minimum) && finite(expected.maximum) && expected.minimum <= expected.maximum
}

function outputUnit(series: TestSeries, measurement: TestMeasurement): TestUnit | null {
  if (measurement.kind === 'integral')
    return series.axis === 'second' && series.unit === 'watt' ? 'joule' : null
  if (measurement.kind === 'crossing')
    return series.axis === 'second' || series.axis === 'hertz' ? series.axis : null
  if (measurement.kind === 'settling') return series.axis === 'second' ? 'second' : null
  return series.unit
}

function validMeasurement(measurement: TestMeasurement): boolean {
  if (measurement.kind === 'point') return finite(measurement.at) && measurement.at >= 0
  if (!finite(measurement.from) || !finite(measurement.to)) return false
  if (measurement.from < 0 || measurement.to <= measurement.from) return false
  if (measurement.kind === 'crossing') return finite(measurement.threshold)
  if (measurement.kind === 'settling')
    return finite(measurement.finalValue) && finite(measurement.band) && measurement.band >= 0
  return true
}

function orderedSamples(series: TestSeries): boolean {
  return series.samples.every(
    (sample, index) =>
      finite(sample.at) &&
      sample.at >= 0 &&
      (series.axis !== 'cycle' || Number.isInteger(sample.at)) &&
      (index === 0 || sample.at > (series.samples[index - 1]?.at ?? Infinity)),
  )
}

function sampleAt(series: TestSeries, at: number): TestSample | null {
  const exact = series.samples.find((sample) => sample.at === at)
  if (exact) return exact
  return null
}

function measure(
  samples: TestSample[],
  measurement: TestMeasurement,
): { value: number | null; at: number | null; formula: string; detail: string } {
  const first = samples[0]
  if (!first || first.value === null)
    return { value: null, at: null, formula: '', detail: 'No samples.' }
  if (measurement.kind === 'point')
    return {
      value: first.value,
      at: first.at,
      formula: 'recorded sample at the requested coordinate',
      detail: 'Exact recorded sample; no interpolation.',
    }
  if (measurement.kind === 'minimum' || measurement.kind === 'maximum') {
    let extreme = first
    for (const sample of samples) {
      if (sample.value === null || extreme.value === null) continue
      if (
        measurement.kind === 'minimum' ? sample.value < extreme.value : sample.value > extreme.value
      )
        extreme = sample
    }
    return {
      value: extreme.value,
      at: extreme.at,
      formula: `${measurement.kind}(recorded samples in the inclusive window)`,
      detail: 'Sampled extremum; between-sample peaks are not certified.',
    }
  }
  if (measurement.kind === 'integral') {
    let total = 0
    for (let index = 1; index < samples.length; index++) {
      const before = samples[index - 1]
      const after = samples[index]
      if (!before || !after || before.value === null || after.value === null) continue
      total += (after.at - before.at) * (before.value / 2 + after.value / 2)
    }
    return {
      value: total,
      at: measurement.to,
      formula: 'E ≈ Σ (t[i+1] − t[i]) × (P[i] + P[i+1]) / 2',
      detail: 'Signed trapezoidal integral of recorded power; accuracy depends on the time step.',
    }
  }
  if (measurement.kind === 'crossing') {
    for (let index = 1; index < samples.length; index++) {
      const before = samples[index - 1]
      const after = samples[index]
      if (!before || !after || before.value === null || after.value === null) continue
      const crosses =
        measurement.direction === 'rising'
          ? before.value < measurement.threshold && after.value >= measurement.threshold
          : before.value > measurement.threshold && after.value <= measurement.threshold
      if (!crosses) continue
      const at =
        before.at +
        ((measurement.threshold - before.value) / (after.value - before.value)) *
          (after.at - before.at)
      return {
        value: at,
        at,
        formula: 'x = x0 + (threshold − y0) × (x1 − x0) / (y1 − y0)',
        detail: `First ${measurement.direction} crossing, linearly interpolated between ${before.at} and ${after.at}.`,
      }
    }
    return {
      value: null,
      at: null,
      formula: 'first directed threshold crossing',
      detail: 'No threshold crossing in the recorded window.',
    }
  }
  let lastOutside = -1
  samples.forEach((sample, index) => {
    if (sample.value !== null && Math.abs(sample.value - measurement.finalValue) > measurement.band)
      lastOutside = index
  })
  const settled = samples[lastOutside + 1]
  const observedAfter = settled && settled.at < measurement.to
  return {
    value: observedAfter ? settled.at : null,
    at: observedAfter ? settled.at : null,
    formula: 'first recorded t after the last |y − finalValue| > band',
    detail: observedAfter
      ? `Sampled settling, confirmed only through ${measurement.to}; band is an absolute quantity, not an inferred percentage.`
      : 'No settled interval observed; extend the run or inspect the response.',
  }
}

export function evaluateAssertion(
  assertion: SimulationAssertion,
  series: TestSeries | undefined,
): AssertionReport {
  const report: AssertionReport = {
    assertion,
    status: 'invalid',
    actual: null,
    at: null,
    axis: series?.axis ?? null,
    targets: series?.targets ?? [],
    provenance: series?.provenance ?? null,
    warnings: series?.warnings ?? [],
    formula: '',
    detail: '',
    repair: '',
  }
  const refuse = (
    status: AssertionReport['status'],
    detail: string,
    repair: string,
  ): AssertionReport => ({ ...report, status, detail, repair })
  if (!assertion.id.trim() || !assertion.signal.trim() || !assertion.provenance.description.trim())
    return refuse(
      'invalid',
      'The assertion needs an ID, signal, and expectation provenance.',
      'Name the signal and explain where its expected value comes from.',
    )
  if (!validExpectation(assertion.expected) || !validMeasurement(assertion.measurement))
    return refuse(
      'invalid',
      'Invalid expectation, tolerance, or measurement window.',
      'Use finite values, non-negative tolerances, and an increasing window.',
    )
  if (series?.status !== 'complete' || series.samples.length === 0)
    return refuse(
      'unavailable',
      'A complete supported analysis is required.',
      'Resolve solver/support warnings and rerun the requested analysis.',
    )
  if (outputUnit(series, assertion.measurement) !== assertion.unit)
    return refuse(
      'invalid',
      'Measurement and expectation units are incompatible.',
      'Choose the unit produced by this measurement; energy is power integrated over seconds.',
    )
  if (!orderedSamples(series))
    return refuse(
      'unavailable',
      'Samples have invalid, duplicate, or unordered coordinates.',
      'Rerun with finite, strictly increasing coordinates.',
    )
  const measurement = assertion.measurement
  let samples: TestSample[]
  if (measurement.kind === 'point') {
    const sample = sampleAt(series, measurement.at)
    samples = sample ? [sample] : []
  } else {
    if (!sampleAt(series, measurement.from) || !sampleAt(series, measurement.to))
      return refuse(
        'unavailable',
        'The measurement window endpoints were not recorded.',
        'Use recorded coordinates or rerun with samples at both endpoints; no extrapolation is performed.',
      )
    samples = series.samples.filter(
      (sample) => sample.at >= measurement.from && sample.at <= measurement.to,
    )
  }
  if (
    samples.length === 0 ||
    samples.some((sample) => sample.value === null || !finite(sample.value))
  )
    return refuse(
      'unavailable',
      'The requested samples are absent or non-finite.',
      'Inspect the affected signal and rerun; missing measurements cannot be treated as zero.',
    )
  const measured = measure(samples, measurement)
  report.formula = measured.formula
  report.at = measured.at
  if (measured.value === null || !finite(measured.value))
    return refuse(
      'unavailable',
      measured.detail,
      'Extend or refine the analysis, or correct the measurement request.',
    )
  report.actual = measured.value
  const expected = assertion.expected
  const error =
    assertion.unit === 'degree'
      ? Math.abs(
          ((((measured.value - (expected.kind === 'near' ? expected.value : 0)) % 360) + 540) %
            360) -
            180,
        )
      : expected.kind === 'near'
        ? Math.abs(measured.value - expected.value)
        : 0
  const passed =
    expected.kind === 'near'
      ? error <= tolerance(expected)
      : measured.value >= expected.minimum && measured.value <= expected.maximum
  return {
    ...report,
    status: passed ? 'pass' : 'fail',
    formula: `${measured.formula}; ${expected.kind === 'near' ? '|error| ≤ absolute + relative × |expected|' : 'minimum ≤ actual ≤ maximum'}${assertion.unit === 'degree' && expected.kind === 'near' ? ' (shortest angular distance)' : ''}`,
    detail: measured.detail,
    repair: passed
      ? ''
      : 'Inspect the affected block/net, its inputs, and the expectation provenance; correct the cause and rerun.',
  }
}

export function evaluateAssertions(
  assertions: SimulationAssertion[],
  signals: ReadonlyMap<string, TestSeries>,
): { passed: boolean; reports: AssertionReport[] } {
  const reports = assertions.map((assertion) => {
    const report = evaluateAssertion(assertion, signals.get(assertion.signal))
    if (assertions.filter((candidate) => candidate.id === assertion.id).length > 1)
      return {
        ...report,
        status: 'invalid' as const,
        detail: 'Duplicate assertion ID.',
        repair: 'Give each assertion a unique ID.',
      }
    return report
  })
  const uniqueIds = new Set(assertions.map((assertion) => assertion.id)).size === assertions.length
  return {
    passed: reports.length > 0 && uniqueIds && reports.every((report) => report.status === 'pass'),
    reports,
  }
}

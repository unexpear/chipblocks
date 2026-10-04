import type {
  SimulationAssertion,
  TestExpectation,
  TestMeasurement,
  TestUnit,
} from '../simulation-assertions.ts'
import type { ElectricalTestRun } from './simulation-test-runner.ts'

export type SavedSimulationTest = {
  version: 1
  id: string
  name: string
  run:
    | ElectricalTestRun
    | { kind: 'digital'; blockId: string; cycles: number; inputs: Record<string, number> }
  assertions: SimulationAssertion[]
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const number = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 4096
const units = new Set<TestUnit>([
  'unknown',
  'boolean',
  'dimensionless',
  'volt',
  'ampere',
  'ohm',
  'watt',
  'farad',
  'henry',
  'second',
  'hertz',
  'degree_celsius',
  'joule',
  'decibel',
  'degree',
])

function measurement(value: unknown): TestMeasurement | null {
  if (!object(value)) return null
  if (value.kind === 'point')
    return number(value.at) && value.at >= 0 ? { kind: 'point', at: value.at } : null
  if (!number(value.from) || !number(value.to) || value.from < 0 || value.to <= value.from)
    return null
  const window = { from: value.from, to: value.to }
  if (value.kind === 'minimum' || value.kind === 'maximum' || value.kind === 'integral')
    return { kind: value.kind, ...window }
  if (
    value.kind === 'crossing' &&
    number(value.threshold) &&
    (value.direction === 'rising' || value.direction === 'falling')
  )
    return { kind: 'crossing', ...window, threshold: value.threshold, direction: value.direction }
  if (
    value.kind === 'settling' &&
    number(value.finalValue) &&
    number(value.band) &&
    value.band >= 0
  )
    return { kind: 'settling', ...window, finalValue: value.finalValue, band: value.band }
  return null
}

function expectation(value: unknown): TestExpectation | null {
  if (!object(value)) return null
  if (
    value.kind === 'near' &&
    number(value.value) &&
    number(value.absolute) &&
    number(value.relative) &&
    value.absolute >= 0 &&
    value.relative >= 0 &&
    Number.isFinite(value.absolute + value.relative * Math.abs(value.value))
  )
    return { kind: 'near', value: value.value, absolute: value.absolute, relative: value.relative }
  if (
    value.kind === 'range' &&
    number(value.minimum) &&
    number(value.maximum) &&
    value.minimum <= value.maximum
  )
    return { kind: 'range', minimum: value.minimum, maximum: value.maximum }
  return null
}

function assertion(value: unknown): SimulationAssertion | null {
  if (
    !object(value) ||
    !text(value.id) ||
    !text(value.label) ||
    !text(value.signal) ||
    !units.has(value.unit as TestUnit) ||
    !object(value.provenance)
  )
    return null
  const expected = expectation(value.expected)
  const measured = measurement(value.measurement)
  const source = value.provenance
  const probe = value.probe
  if (
    probe !== undefined &&
    (!object(probe) ||
      !text(probe.blockId) ||
      !text(probe.terminalId) ||
      (probe.kind !== 'terminal-voltage' && probe.kind !== 'net-kcl' && probe.kind !== 'ac-output'))
  )
    return null
  if (
    !expected ||
    !measured ||
    !text(source.description) ||
    !['analytic', 'manual', 'captured'].includes(String(source.kind))
  )
    return null
  return {
    ...(probe === undefined
      ? {}
      : {
          probe: {
            kind: (probe as NonNullable<SimulationAssertion['probe']>).kind,
            blockId: (probe as NonNullable<SimulationAssertion['probe']>).blockId,
            terminalId: (probe as NonNullable<SimulationAssertion['probe']>).terminalId,
          },
        }),
    id: value.id,
    label: value.label,
    signal: value.signal,
    unit: value.unit as TestUnit,
    measurement: measured,
    expected,
    provenance: {
      kind: source.kind as SimulationAssertion['provenance']['kind'],
      description: source.description,
    },
  }
}

function run(value: unknown): SavedSimulationTest['run'] | null {
  if (!object(value)) return null
  const outputProbe = value.outputProbe
  if (
    outputProbe !== undefined &&
    (!object(outputProbe) || !text(outputProbe.blockId) || !text(outputProbe.terminalId))
  )
    return null
  if (value.kind === 'digital') {
    if (
      !text(value.blockId) ||
      !number(value.cycles) ||
      !Number.isInteger(value.cycles) ||
      value.cycles < 1 ||
      value.cycles > 256 ||
      !object(value.inputs)
    )
      return null
    if (
      Object.entries(value.inputs).some(
        ([name, input]) =>
          !text(name) || !number(input) || !Number.isSafeInteger(input) || input < 0,
      )
    )
      return null
    return {
      kind: 'digital',
      blockId: value.blockId,
      cycles: value.cycles,
      inputs: { ...value.inputs } as Record<string, number>,
    }
  }
  if (!number(value.projectAmbientC) || value.projectAmbientC < -273.15) return null
  const ambient = { projectAmbientC: value.projectAmbientC }
  if (value.kind === 'dc') return { kind: 'dc', ...ambient }
  if (
    value.kind === 'transient' &&
    number(value.timeStep) &&
    number(value.duration) &&
    value.timeStep > 0 &&
    value.duration >= value.timeStep
  )
    return { kind: 'transient', ...ambient, timeStep: value.timeStep, duration: value.duration }
  if (
    value.kind === 'ac' &&
    text(value.inputSource) &&
    text(value.outputNet) &&
    Array.isArray(value.frequenciesHz)
  ) {
    const frequencies = value.frequenciesHz
    if (
      frequencies.length < 1 ||
      frequencies.length > 512 ||
      frequencies.some(
        (frequency, index) =>
          !number(frequency) ||
          frequency <= 0 ||
          (index > 0 && frequency <= frequencies[index - 1]),
      )
    )
      return null
    return {
      kind: 'ac',
      ...ambient,
      inputSource: value.inputSource,
      outputNet: value.outputNet,
      ...(outputProbe === undefined
        ? {}
        : {
            outputProbe: {
              blockId: (outputProbe as { blockId: string }).blockId,
              terminalId: (outputProbe as { terminalId: string }).terminalId,
            },
          }),
      frequenciesHz: [...frequencies],
    }
  }
  return null
}

export function validateSimulationTests(
  value: unknown,
): { ok: true; tests: SavedSimulationTest[] } | { ok: false; reason: string } {
  if (value === undefined) return { ok: true, tests: [] }
  if (!Array.isArray(value) || value.length > 256)
    return { ok: false, reason: 'Saved simulation tests must be a list of at most 256 tests.' }
  const tests: SavedSimulationTest[] = []
  const ids = new Set<string>()
  for (const entry of value) {
    if (
      !object(entry) ||
      entry.version !== 1 ||
      !text(entry.id) ||
      !text(entry.name) ||
      ids.has(entry.id) ||
      !Array.isArray(entry.assertions) ||
      entry.assertions.length < 1 ||
      entry.assertions.length > 1024
    )
      return {
        ok: false,
        reason: 'A saved simulation test has an invalid version, identity, or assertion list.',
      }
    const request = run(entry.run)
    const assertions = entry.assertions.map(assertion)
    if (
      !request ||
      assertions.some((item) => item === null) ||
      new Set(assertions.map((item) => item?.id)).size !== assertions.length
    )
      return {
        ok: false,
        reason: `Saved simulation test "${entry.name}" has invalid run settings or assertions.`,
      }
    ids.add(entry.id)
    tests.push({
      version: 1,
      id: entry.id,
      name: entry.name,
      run: request,
      assertions: assertions as SimulationAssertion[],
    })
  }
  return { ok: true, tests }
}

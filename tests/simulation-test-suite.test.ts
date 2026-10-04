import { describe, expect, test } from 'vitest'
import { deserializeCircuit, serializeCircuit } from '../src/renderer/circuit-file.ts'
import {
  type SavedSimulationTest,
  validateSimulationTests,
} from '../src/renderer/simulation-test-suite.ts'

const savedTest = (): SavedSimulationTest => ({
  version: 1,
  id: 'supply',
  name: 'Supply voltage',
  run: { kind: 'dc', projectAmbientC: 25 },
  assertions: [
    {
      id: 'volts',
      label: 'Supply',
      signal: 'voltage:supply',
      unit: 'volt',
      measurement: { kind: 'point', at: 0 },
      expected: { kind: 'near', value: 5, absolute: 0.1, relative: 0.01 },
      provenance: { kind: 'analytic', description: 'Expected regulated supply = 5 V.' },
    },
  ],
})

describe('saved unified simulation tests', () => {
  test('persists stable endpoint probes for both AC output and its expectation', () => {
    const suite = savedTest()
    const endpoint = { blockId: 'source', terminalId: 'terminal_positive' }
    suite.run = {
      kind: 'ac',
      projectAmbientC: 25,
      inputSource: 'source',
      outputNet: 'old-net',
      outputProbe: endpoint,
      frequenciesHz: [100],
    }
    const first = suite.assertions[0]
    if (!first) throw new Error('missing assertion')
    first.probe = { kind: 'ac-output', ...endpoint }
    first.signal = 'gain:old-net'
    expect(validateSimulationTests([suite])).toEqual({ ok: true, tests: [suite] })
    expect(
      validateSimulationTests([{ ...suite, run: { ...suite.run, outputProbe: { blockId: '' } } }])
        .ok,
    ).toBe(false)
  })
  test('preserves a clean, independent definition through the real circuit-file writer and loader', () => {
    const suite = savedTest()
    const args: Parameters<typeof serializeCircuit> = [[], []]
    args[13] = [suite]
    const file = serializeCircuit(...args)
    expect(file.simulationTests).toEqual([suite])
    suite.name = 'Changed after saving'
    expect(file.simulationTests?.[0]?.name).toBe('Supply voltage')
    const loaded = deserializeCircuit(JSON.stringify(file))
    expect(loaded.ok).toBe(true)
    if (loaded.ok) expect(loaded.file.simulationTests).toEqual(file.simulationTests)
  })
  test('old files still load without inventing tests', () => {
    const loaded = deserializeCircuit(JSON.stringify(serializeCircuit([], [])))
    expect(loaded.ok).toBe(true)
    if (loaded.ok) expect(loaded.file.simulationTests).toBeUndefined()
  })
  test('retains only input definitions, never cached results or unknown execution fields', () => {
    const input = {
      ...savedTest(),
      actual: 5,
      passed: true,
      run: { kind: 'dc', projectAmbientC: 25, cachedSolution: { anything: 1 } },
    }
    const parsed = validateSimulationTests([input])
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.tests).toEqual([savedTest()])
  })
  test.each([
    { kind: 'digital', blockId: 'counter', cycles: 4, inputs: { reset: 0 } },
    {
      kind: 'ac',
      projectAmbientC: 25,
      inputSource: 'source',
      outputNet: 'out',
      frequenciesHz: [10, 100],
    },
    { kind: 'transient', projectAmbientC: 25, timeStep: 1e-6, duration: 1e-3 },
  ])('roundtrips $kind run parameters', (run) => {
    const input = { ...savedTest(), run }
    const parsed = validateSimulationTests(JSON.parse(JSON.stringify([input])))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.tests[0]?.run).toEqual(run)
  })
  test('rejects malformed saved tests instead of silently dropping their requirements', () => {
    for (const simulationTests of [
      null,
      {},
      [{ ...savedTest(), version: 2 }],
      [savedTest(), savedTest()],
      [{ ...savedTest(), assertions: [] }],
      [{ ...savedTest(), run: { kind: 'digital', cycles: 999, blockId: 'x', inputs: {} } }],
    ]) {
      const loaded = deserializeCircuit(
        JSON.stringify({ ...serializeCircuit([], []), simulationTests }),
      )
      expect(loaded.ok).toBe(false)
    }
  })
  test('rejects malformed numeric expectations and unknown units', () => {
    const suite = savedTest()
    const original = suite.assertions[0]
    if (!original) throw new Error('missing assertion')
    for (const invalid of [
      { ...original, unit: 'bananas' },
      { ...original, expected: { kind: 'near', value: 5, absolute: -1, relative: 0 } },
      { ...original, measurement: { kind: 'maximum', from: 2, to: 1 } },
      { ...original, provenance: { kind: 'analytic', description: '' } },
    ])
      expect(validateSimulationTests([{ ...suite, assertions: [invalid] }]).ok).toBe(false)
  })
})

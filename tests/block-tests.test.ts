import { afterEach, describe, expect, test, vi } from 'vitest'
import { createBlockTestCase, runBlockTest, runBlockTests } from '../src/renderer/block-tests.ts'
import { NAND2_BLOCK } from '../src/renderer/builtin-blocks.ts'
import { deserializeCircuit, serializeCircuit } from '../src/renderer/circuit-file.ts'
import * as traceEngine from '../src/renderer/run-trace.ts'

describe('block testbench', () => {
  afterEach(() => vi.restoreAllMocks())

  test('fails unsettled cycles even when every output matches the expectation', () => {
    const trace = traceEngine.runTrace(
      NAND2_BLOCK,
      1,
      new Map([
        ['a', 1],
        ['b', 1],
      ]),
    )
    if (!trace) throw new Error('trace was not created')
    const cycle = trace.cycles[0]
    if (!cycle) throw new Error('cycle was not created')
    cycle.settled = false
    vi.spyOn(traceEngine, 'runTrace').mockReturnValue(trace)
    const result = runBlockTest(NAND2_BLOCK, {
      id: 'unsettled',
      name: 'Unsettled',
      cycles: 1,
      inputs: { a: 1, b: 1 },
      expected: { out: [0] },
    })
    expect(result.passed).toBe(false)
    expect(result.failures).toContainEqual(expect.objectContaining({ cycle: 1, signal: 'settled' }))
    expect(createBlockTestCase(NAND2_BLOCK, 'capture', 'Capture', 1, new Map())).toBeNull()
  })

  test('fails an incomplete trace instead of certifying only its prefix', () => {
    const trace = traceEngine.runTrace(
      NAND2_BLOCK,
      1,
      new Map([
        ['a', 1],
        ['b', 1],
      ]),
    )
    if (!trace) throw new Error('trace was not created')
    vi.spyOn(traceEngine, 'runTrace').mockReturnValue(trace)
    expect(
      runBlockTest(NAND2_BLOCK, {
        id: 'short',
        name: 'Short run',
        cycles: 2,
        inputs: { a: 1, b: 1 },
        expected: { out: [0, 0] },
      }).passed,
    ).toBe(false)
  })
  test.each([
    Number.NaN,
    Infinity,
    -1,
    0,
    1.5,
    257,
  ])('rejects invalid or truncated cycle count %s rather than reporting a pass', (cycles) => {
    const result = runBlockTest(NAND2_BLOCK, {
      id: 'invalid-cycles',
      name: 'Invalid cycles',
      cycles,
      inputs: { a: 1, b: 1 },
      expected: { out: Array.from({ length: 256 }, () => 0) },
    })
    expect(result.passed).toBe(false)
    expect(result.failures[0]?.signal).toBe('cycles')
    expect(createBlockTestCase(NAND2_BLOCK, 'capture', 'Capture', cycles, new Map())).toBeNull()
  })

  test('rejects extra expected cycles rather than silently ignoring them', () => {
    const result = runBlockTest(NAND2_BLOCK, {
      id: 'extra',
      name: 'Extra samples',
      cycles: 1,
      inputs: { a: 1, b: 1 },
      expected: { out: [0, 1] },
    })
    expect(result.passed).toBe(false)
    expect(result.failures.some((failure) => failure.signal === 'out')).toBe(true)
  })

  test('rejects non-finite or fractional digital inputs', () => {
    for (const input of [Number.NaN, Infinity, 0.5]) {
      const result = runBlockTest(NAND2_BLOCK, {
        id: 'bad-input',
        name: 'Bad input',
        cycles: 1,
        inputs: { a: input, b: 0 },
        expected: { out: [1] },
      })
      expect(result.passed).toBe(false)
      expect(result.failures[0]?.signal).toBe('a')
    }
  })

  test('captures a repeatable expected waveform from the real logic trace', () => {
    const testCase = createBlockTestCase(
      NAND2_BLOCK,
      'nand-low-b',
      'A high, B low',
      3,
      new Map([
        ['a', 1],
        ['b', 0],
      ]),
    )
    expect(testCase?.name).toBe('A high, B low')
    expect(testCase?.inputs).toEqual({ a: 1, b: 0 })
    expect(testCase?.expected.out).toEqual([1, 1, 1])
    expect(testCase && runBlockTest(NAND2_BLOCK, testCase)).toMatchObject({ passed: true })
  })

  test('reports the first wrong expected value with cycle and signal', () => {
    const testCase = createBlockTestCase(
      NAND2_BLOCK,
      'nand-high-high',
      'Both high',
      2,
      new Map([
        ['a', 1],
        ['b', 1],
      ]),
    )
    if (!testCase) throw new Error('test case was not created')
    const expectedOut = testCase.expected.out
    if (!expectedOut) throw new Error('output expectation was not created')
    expectedOut[1] = 1
    const result = runBlockTest(NAND2_BLOCK, testCase)
    expect(result.passed).toBe(false)
    expect(result.failures[0]).toEqual({ cycle: 2, signal: 'out', expected: 1, actual: 0 })
  })

  test('runs a saved suite and preserves per-test results', () => {
    const first = createBlockTestCase(
      NAND2_BLOCK,
      'first',
      'A high, B low',
      1,
      new Map([
        ['a', 1],
        ['b', 0],
      ]),
    )
    const second = createBlockTestCase(
      NAND2_BLOCK,
      'second',
      'Both high',
      1,
      new Map([
        ['a', 1],
        ['b', 1],
      ]),
    )
    if (!first || !second) throw new Error('test cases were not created')
    const secondExpectedOut = second.expected.out
    if (!secondExpectedOut) throw new Error('output expectation was not created')
    secondExpectedOut[0] = 1
    expect(runBlockTests(NAND2_BLOCK, [first, second]).map((result) => result.passed)).toEqual([
      true,
      false,
    ])
  })

  test('keeps saved tests through circuit serialization', () => {
    const testCase = createBlockTestCase(
      NAND2_BLOCK,
      'persisted',
      'Persisted vector',
      1,
      new Map([
        ['a', 0],
        ['b', 1],
      ]),
    )
    if (!testCase) throw new Error('test case was not created')
    const file = serializeCircuit(
      [
        {
          id: 'u1',
          position: { x: 0, y: 0 },
          data: {
            definition: 'block',
            block: { ...NAND2_BLOCK, tests: [testCase] },
          },
        },
      ],
      [],
    )
    const loaded = deserializeCircuit(JSON.stringify(file))
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.file.nodes[0]?.block?.tests).toEqual([testCase])
  })
})

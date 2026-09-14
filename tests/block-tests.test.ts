import { describe, expect, test } from 'vitest'
import { createBlockTestCase, runBlockTest, runBlockTests } from '../src/renderer/block-tests.ts'
import { NAND2_BLOCK } from '../src/renderer/builtin-blocks.ts'
import { deserializeCircuit, serializeCircuit } from '../src/renderer/circuit-file.ts'

describe('block testbench', () => {
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

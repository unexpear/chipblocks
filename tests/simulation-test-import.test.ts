import { expect, test } from 'vitest'
import { createBlockTestCase } from '../src/renderer/block-tests.ts'
import type { BlockTestCase } from '../src/renderer/blocks.ts'
import { NAND2_BLOCK } from '../src/renderer/builtin-blocks.ts'
import { importBlockTest } from '../src/renderer/simulation-test-import.ts'
import { runDigitalTestCopy } from '../src/renderer/simulation-test-runner.ts'
import { validateSimulationTests } from '../src/renderer/simulation-test-suite.ts'

function captured(): BlockTestCase {
  const result = createBlockTestCase(
    NAND2_BLOCK,
    'both-high',
    'Both high',
    3,
    new Map([
      ['a', 1],
      ['b', 1],
    ]),
  )
  if (!result) throw new Error('Capture failed')
  return result
}

test('imports every saved cycle without changing the original or claiming independent evidence', () => {
  const original = captured()
  const before = structuredClone(original)
  const imported = importBlockTest(NAND2_BLOCK, 'nand', original)
  expect(imported.ok).toBe(true)
  if (!imported.ok) return
  expect(original).toEqual(before)
  expect(imported.test.assertions).toHaveLength(3)
  expect(imported.test.assertions.map((assertion) => assertion.measurement)).toEqual([
    { kind: 'point', at: 1 },
    { kind: 'point', at: 2 },
    { kind: 'point', at: 3 },
  ])
  expect(
    imported.test.assertions.every((assertion) => assertion.provenance.kind === 'captured'),
  ).toBe(true)
  expect(validateSimulationTests(JSON.parse(JSON.stringify([imported.test])))).toEqual({
    ok: true,
    tests: [imported.test],
  })
  const report = runDigitalTestCopy(
    NAND2_BLOCK,
    'nand',
    3,
    new Map(Object.entries(original.inputs)),
    imported.test.assertions,
  )
  expect(report.passed).toBe(true)
  expect(report.reports).toHaveLength(3)
  const second = imported.test.assertions[1]
  if (!second) throw new Error('Missing second cycle assertion')
  second.expected = { kind: 'near', value: 1, absolute: 0, relative: 0 }
  const failed = runDigitalTestCopy(
    NAND2_BLOCK,
    'nand',
    3,
    new Map(Object.entries(original.inputs)),
    imported.test.assertions,
  )
  expect(failed.passed).toBe(false)
  expect(failed.reports[1]?.status).toBe('fail')
  expect(original).toEqual(before)
})

test.each([
  'missing-cycle',
  'extra-cycle',
  'missing-output',
  'unknown-output',
  'out-of-range',
  'unknown-input',
])('refuses %s rather than importing a narrower passing test', (invalid) => {
  const original = captured()
  if (invalid === 'missing-cycle') original.expected.out = [0, 0]
  if (invalid === 'extra-cycle') original.expected.out = [0, 0, 0, 0]
  if (invalid === 'missing-output') original.expected = {}
  if (invalid === 'unknown-output') original.expected.other = [0, 0, 0]
  if (invalid === 'out-of-range') original.expected.out = [0, 2, 0]
  if (invalid === 'unknown-input') original.inputs.missing = 1
  expect(importBlockTest(NAND2_BLOCK, 'nand', original).ok).toBe(false)
})

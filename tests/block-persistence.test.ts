import type { Node } from '@xyflow/react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, test } from 'vitest'
import {
  BLOCK_TEST_MAX_CYCLES,
  readSavedBlockTests,
  versionedBlockData,
} from '../src/renderer/block-persistence.ts'
import { createBlockTestCase, runBlockTest } from '../src/renderer/block-tests.ts'
import { blockStructureError } from '../src/renderer/block-validation.ts'
import type { BlockData } from '../src/renderer/blocks.ts'
import { NAND2_BLOCK } from '../src/renderer/builtin-blocks.ts'
import { deserializeCircuit, serializeCircuit } from '../src/renderer/circuit-file.ts'
import { attachInternalCircuits } from '../src/renderer/pipeline/canvas-world.ts'
import { MAX_TRACE_CYCLES } from '../src/renderer/run-trace.ts'
import { SimulationTestBench } from '../src/renderer/simulation-test-bench.tsx'
import { importBlockTest } from '../src/renderer/simulation-test-import.ts'
import { runDigitalTestCopy } from '../src/renderer/simulation-test-runner.ts'
import { simulationTestInputKey } from '../src/renderer/simulation-test-world.ts'
import { userPartFromBlock } from '../src/renderer/user-part-draft.ts'
import { validateUserPart } from '../src/renderer/user-part-validate.ts'
import { registerUserPart, setUserParts } from '../src/renderer/user-parts.ts'

const example = {
  id: 'high',
  name: 'Both high',
  cycles: 2,
  inputs: { a: 1, b: 1 },
  expected: { out: [0, 0] },
}
afterEach(() => setUserParts([]))

describe('versioned reusable block tests', () => {
  test('trace and persistence share the same cycle bound', () => {
    expect(MAX_TRACE_CYCLES).toBe(BLOCK_TEST_MAX_CYCLES)
  })

  test('accepts legacy blocks and rejects future versions at every nested level', () => {
    expect(blockStructureError(NAND2_BLOCK, 'gate')).toBeNull()
    expect(blockStructureError({ ...NAND2_BLOCK, version: 2 }, 'gate')).toContain(
      'unsupported format version',
    )
    const nested = {
      ...NAND2_BLOCK,
      nodes: [
        { id: 'child', definition: 'block', x: 0, y: 0, block: { ...NAND2_BLOCK, version: 2 } },
      ],
      ports: [],
      edges: [],
    }
    expect(blockStructureError(nested, 'gate')).toContain('gate/child')
    expect(() => versionedBlockData(nested as BlockData)).toThrow('Unsupported block format')
  })

  test('writes versions recursively without mutating the source', () => {
    const block: BlockData = {
      ...NAND2_BLOCK,
      nodes: [{ id: 'child', definition: 'block', x: 0, y: 0, block: NAND2_BLOCK }],
      edges: [],
      ports: [],
      tests: [example],
    }
    const saved = versionedBlockData(block)
    expect(saved.version).toBe(1)
    expect(saved.nodes[0]?.block?.version).toBe(1)
    expect(block.version).toBeUndefined()
    expect(saved.tests).toEqual(block.tests)
    expect(saved.tests).not.toBe(block.tests)
  })

  test.each([
    null,
    {},
    [null],
    [example, example],
    [{ ...example, cycles: 0 }],
    [{ ...example, cycles: 257 }],
    [{ ...example, expected: {} }],
    [{ ...example, expected: { out: [0] } }],
    [{ ...example, inputs: { a: NaN } }],
    [{ ...example, inputs: { a: -1 } }],
    [{ ...example, expected: { out: [0, 0.5] } }],
  ])('rejects malformed test definitions: %j', (raw) => {
    expect(readSavedBlockTests(raw)).toBeNull()
    expect(blockStructureError({ ...NAND2_BLOCK, tests: raw }, 'gate')).toContain('saved tests')
  })

  test('drops cached results from the persisted test definition', () => {
    expect(readSavedBlockTests([{ ...example, passed: true, reports: ['fake success'] }])).toEqual([
      example,
    ])
  })

  test('save-as-part and circuit reload preserve runnable tests without carrying instance ids', () => {
    const captured = createBlockTestCase(
      NAND2_BLOCK,
      'capture',
      'Both high',
      2,
      new Map([
        ['a', 1],
        ['b', 1],
      ]),
    )
    if (!captured) throw new Error('Capture failed')
    const source: BlockData = { ...NAND2_BLOCK, tests: [captured] }
    const draft = userPartFromBlock('Tested Nand', 'U', source)
    if (!draft.ok) throw new Error(draft.error)
    const file = serializeCircuit(
      [{ id: 'new_instance', position: { x: 0, y: 0 }, data: { definition: draft.part.id } }],
      [],
      undefined,
      undefined,
      undefined,
      [draft.part],
    )
    const loaded = deserializeCircuit(JSON.stringify(file))
    if (!loaded.ok) throw new Error(loaded.reason)
    const part = loaded.file.userParts?.[0]
    if (!part?.internal) throw new Error('Missing loaded internal block')
    registerUserPart(part)
    const nodes: Node[] = [
      { id: 'new_instance', position: { x: 0, y: 0 }, data: { definition: part.id } },
    ]
    const signature = simulationTestInputKey(nodes, [])
    const resolved = attachInternalCircuits(nodes)[0]?.data.block as BlockData
    const testCase = resolved.tests?.[0]
    if (!testCase) throw new Error('Missing saved test')
    expect(resolved.version).toBe(1)
    expect(runBlockTest(resolved, testCase).passed).toBe(true)
    const imported = importBlockTest(resolved, 'new_instance', testCase)
    if (!imported.ok) throw new Error(imported.reason)
    const report = runDigitalTestCopy(
      resolved,
      'new_instance',
      2,
      new Map(Object.entries(testCase.inputs)),
      imported.test.assertions,
    )
    expect(report.passed).toBe(true)
    const markup = renderToStaticMarkup(
      createElement(SimulationTestBench, {
        nodes,
        edges: [],
        tests: [],
        ambientC: 25,
        onChange: () => {},
        onClose: () => {},
        onSelect: () => {},
      }),
    )
    expect(markup).toContain('Both high')
    registerUserPart({
      ...part,
      internal: {
        ...part.internal,
        tests: [{ ...testCase, name: 'Changed expectation definition' }],
      },
    })
    expect(simulationTestInputKey(nodes, [])).not.toBe(signature)
    const nested = {
      ...source,
      nodes: [{ id: 'child', definition: 'block', x: 0, y: 0, block: source }],
      ports: source.ports.map((port) => ({
        ...port,
        inner: { nodeId: 'child', handleId: port.id },
      })),
      edges: [],
    }
    const nestedDraft = userPartFromBlock('Nested Tested Nand', 'U', nested)
    if (!nestedDraft.ok) throw new Error(nestedDraft.error)
    expect(validateUserPart(nestedDraft.part)?.internal?.nodes[0]?.block?.tests).toEqual([captured])
  })
})

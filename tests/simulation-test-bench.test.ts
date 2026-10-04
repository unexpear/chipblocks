import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { NAND2_BLOCK } from '../src/renderer/builtin-blocks.ts'
import { SimulationTestBench } from '../src/renderer/simulation-test-bench.tsx'

test('mounts a test-authoring surface with explicit independence and provenance', () => {
  const markup = renderToStaticMarkup(
    createElement(SimulationTestBench, {
      nodes: [],
      edges: [],
      tests: [],
      ambientC: 25,
      onChange: () => {},
      onClose: () => {},
      onSelect: () => {},
    }),
  )
  expect(markup).toContain('Tests and preflight')
  expect(markup).toContain('independent copies')
  expect(markup).toContain('Reference or formula')
  expect(markup).toContain('Save check')
  expect(markup).toContain('Saved tests (0)')
  expect(markup).toContain('max-width:calc(100% - 32px)')
  expect(markup).toContain('box-sizing:border-box')
})

test('exposes existing block waveforms without replacing the legacy tests', () => {
  const block = structuredClone(NAND2_BLOCK)
  block.tests = [
    { id: 'saved', name: 'Both high', cycles: 1, inputs: { a: 1, b: 1 }, expected: { out: [0] } },
  ]
  const markup = renderToStaticMarkup(
    createElement(SimulationTestBench, {
      nodes: [{ id: 'nand', position: { x: 0, y: 0 }, data: { definition: 'block', block } }],
      edges: [],
      tests: [],
      ambientC: 25,
      onChange: () => {},
      onClose: () => {},
      onSelect: () => {},
    }),
  )
  expect(markup).toContain('Existing block waveforms')
  expect(markup).toContain('Import nand: Both high')
  expect(markup).toContain('original block test stays unchanged')
  expect(block.tests).toHaveLength(1)
})

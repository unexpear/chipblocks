import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import {
  patchBlockPort,
  portContractProblems,
  removeBlockPort,
} from '../src/renderer/block-contracts.ts'
import { BlockInspector } from '../src/renderer/block-inspector.tsx'
import type { BlockData, BlockPort } from '../src/renderer/blocks.ts'
import { deserializeCircuit, serializeCircuit } from '../src/renderer/circuit-file.ts'

const port: BlockPort = {
  id: 'input',
  label: 'Input',
  side: 'left',
  inner: { nodeId: 'resistor', handleId: 'terminal_a' },
}
const block: BlockData = {
  name: 'Block',
  origin: { x: 0, y: 0 },
  nodes: [{ id: 'resistor', definition: 'resistor', x: 0, y: 0 }],
  edges: [],
  ports: [port],
}

describe('editable block contracts', () => {
  test('removing an enable pin leaves the output enable unknown, not dangling or always enabled', () => {
    const output: BlockPort = {
      ...port,
      id: 'output',
      drive: 'tristate',
      enable: { pin: 'input', activeHigh: false },
    }
    const removed = removeBlockPort([port, output], 'input')
    expect(removed).toHaveLength(1)
    expect(removed[0]?.drive).toBe('tristate')
    expect(removed[0]?.enable).toBeUndefined()
    expect(output.enable).toEqual({ pin: 'input', activeHigh: false })
  })

  test('edits and clears declarations without modifying the internal connection', () => {
    const edited = patchBlockPort(port, {
      domain: 'electrical',
      direction: 'input',
      role: 'load',
      unit: 'volt',
      drive: 'input',
    })
    expect(edited.inner).toEqual(port.inner)
    expect(port.domain).toBeUndefined()
    expect(edited).toMatchObject({
      domain: 'electrical',
      direction: 'input',
      role: 'load',
      unit: 'volt',
    })
    const cleared = patchBlockPort(edited, {
      domain: undefined,
      direction: undefined,
      role: undefined,
      unit: undefined,
      drive: undefined,
    })
    expect(cleared).toEqual(port)
    expect(Object.hasOwn(cleared, 'domain')).toBe(false)
  })

  test('retains the existing empty-enable clearing behavior', () => {
    expect(
      patchBlockPort(
        { ...port, enable: { pin: 'en', activeHigh: false } },
        { enable: { pin: '', activeHigh: true } },
      ).enable,
    ).toBeUndefined()
  })

  test('reports conflicting declarations without guessing missing ones', () => {
    expect(portContractProblems(port)).toEqual([])
    expect(portContractProblems({ ...port, direction: 'input', drive: 'push_pull' })).toHaveLength(
      1,
    )
    expect(portContractProblems({ ...port, direction: 'output', drive: 'input' })).toHaveLength(1)
    expect(
      portContractProblems({ ...port, direction: 'bidirectional', drive: 'tristate' }),
    ).toEqual([])
    expect(portContractProblems({ ...port, enable: { pin: 'en', activeHigh: true } })).toHaveLength(
      1,
    )
  })

  test('edited declarations survive circuit save and reload', () => {
    const edited = {
      ...block,
      ports: [
        patchBlockPort(port, {
          domain: 'electrical',
          direction: 'bidirectional',
          role: 'passive',
          unit: 'volt',
        }),
      ],
    }
    const saved = serializeCircuit(
      [{ id: 'module', position: { x: 0, y: 0 }, data: { definition: 'block', block: edited } }],
      [],
    )
    const loaded = deserializeCircuit(JSON.stringify(saved))
    expect(loaded.ok).toBe(true)
    if (loaded.ok) expect(loaded.file.nodes[0]?.block).toEqual({ ...edited, version: 1 })
  })

  test('inspector exposes labeled controls and does not display an invented input declaration', () => {
    const markup = renderToStaticMarkup(
      createElement(BlockInspector, {
        block,
        ports: block.ports,
        available: [],
        fidelity: 'transistor',
        onFidelity: () => {},
        onEditPort: () => {},
        onAddPort: () => {},
        onReorderPort: () => {},
        onRemovePort: () => {},
      }),
    )
    for (const field of ['drive type', 'domain', 'direction', 'role', 'unit']) {
      expect(markup).toContain(`aria-label="Input ${field}"`)
    }
    expect(markup).toContain('drive not declared')
    expect(markup).not.toContain('<option value="input" selected="">')
    expect(markup).toContain('do not convert signals')
  })
})

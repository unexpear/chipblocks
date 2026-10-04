import { describe, expect, test } from 'vitest'
import { blockStructureError } from '../src/renderer/block-validation.ts'
import { deserializeCircuit, serializeCircuit } from '../src/renderer/circuit-file.ts'

function circuit() {
  return {
    name: 'Resistor block',
    origin: { x: 0, y: 0 },
    nodes: [{ id: 'resistor', definition: 'resistor', x: 0, y: 0 }],
    edges: [],
    ports: [
      {
        id: 'input',
        label: 'Input',
        side: 'left',
        domain: 'electrical',
        direction: 'bidirectional',
        unit: 'volt',
        inner: { nodeId: 'resistor', handleId: 'terminal_a' },
      },
    ],
  }
}

describe('persisted block structural validation', () => {
  test('allows empty annotation text but not a unitless scalar', () => {
    const block = circuit()
    const annotation = {
      id: 'text',
      definition: 'text_note',
      x: 0,
      y: 0,
      parameters: { note_text: { value: '' } },
    }
    expect(
      blockStructureError({ ...block, nodes: [...block.nodes, annotation] }, 'root'),
    ).toBeNull()
    const invalid = {
      ...annotation,
      parameters: { width: { value: { kind: 'scalar', amount: 1, unit: '' } } },
    }
    expect(blockStructureError({ ...block, nodes: [...block.nodes, invalid] }, 'root')).toContain(
      'finite scalar',
    )
  })
  test('accepts legacy blocks without contract metadata', () => {
    const block = circuit()
    const port = block.ports[0]
    if (!port) throw new Error('Missing fixture port')
    const { domain, direction, unit, ...legacy } = port
    expect(blockStructureError({ ...block, ports: [legacy] }, 'root')).toBeNull()
  })

  test.each([
    null,
    [],
    {},
    { ...circuit(), origin: { x: Infinity, y: 0 } },
  ])('rejects malformed structures without throwing', (block) => {
    expect(blockStructureError(block, 'root')).toContain('Block root:')
  })

  test('rejects duplicated internal identities', () => {
    const block = circuit()
    expect(
      blockStructureError({ ...block, nodes: [...block.nodes, ...block.nodes] }, 'root'),
    ).toContain('unique')
    expect(
      blockStructureError({ ...block, ports: [...block.ports, ...block.ports] }, 'root'),
    ).toContain('unique')
  })

  test('rejects dangling wires and ports', () => {
    const block = circuit()
    expect(
      blockStructureError(
        {
          ...block,
          edges: [
            {
              id: 'wire',
              source: 'missing',
              sourceHandle: null,
              target: 'resistor',
              targetHandle: 'terminal_a',
            },
          ],
        },
        'root',
      ),
    ).toContain('wire wire')
    expect(blockStructureError({ ...block, nodes: [] }, 'root')).toContain('port input')
  })

  test('checks contract fields and enable references', () => {
    const block = circuit()
    for (const patch of [
      { domain: 'invented' },
      { unit: 'bananas' },
      { direction: 'sideways' },
      { enable: { pin: 'missing', activeHigh: true } },
    ]) {
      expect(
        blockStructureError({ ...block, ports: [{ ...block.ports[0], ...patch }] }, 'root'),
      ).not.toBeNull()
    }
  })

  test('reports the nested path and bounds recursion', () => {
    const nested = { ...circuit(), ports: [] }
    const block = {
      ...circuit(),
      nodes: [{ id: 'child', definition: 'circuit_block', x: 0, y: 0, block: nested }],
      ports: [],
    }
    expect(blockStructureError(block, 'root')).toBeNull()
    expect(
      blockStructureError({ ...block, nodes: [{ ...block.nodes[0], block: null }] }, 'root'),
    ).toContain('root/child')
    expect(blockStructureError(block, 'root', 64)).toContain('depth')
  })

  test('does not silently accept a missing nested terminal', () => {
    const child = circuit()
    const parent = {
      ...circuit(),
      nodes: [{ id: 'resistor', definition: 'circuit_block', x: 0, y: 0, block: child }],
    }
    expect(blockStructureError(parent, 'root')).toContain('nested port')
  })

  test('file load rejects broken blocks and preserves valid contract metadata', () => {
    const file = serializeCircuit([], [])
    const block = circuit()
    const saved = {
      ...file,
      nodes: [{ id: 'module', definition: 'circuit_block', x: 0, y: 0, block }],
    }
    const loaded = deserializeCircuit(JSON.stringify(saved))
    expect(loaded.ok).toBe(true)
    if (loaded.ok) expect(loaded.file.nodes[0]?.block).toEqual(block)
    block.nodes = []
    const broken = deserializeCircuit(JSON.stringify(saved))
    expect(broken.ok).toBe(false)
    if (!broken.ok) expect(broken.reason).toContain('Block module:')
  })
})

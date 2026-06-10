/**
 * Circuit-file tests (S19-v3-52) — Save/Load round-trips exactly what the user
 * built (parts, values, wires, hand-routed corners), and rejects anything that
 * isn't a valid circuit file with a plain-language reason.
 */

import { describe, expect, test } from 'vitest'
import {
  CIRCUIT_FILE_VERSION,
  deserializeCircuit,
  maxIdSuffix,
  serializeCircuit,
} from '../src/renderer/circuit-file.ts'

const nodes = [
  {
    id: 'power_source_1',
    position: { x: 40, y: 80 },
    data: {
      definition: 'power_source',
      parameters: { nominal_voltage: { value: { kind: 'scalar', amount: 9, unit: 'volt' } } },
    },
  },
  {
    id: 'resistor_2',
    position: { x: 220, y: 80 },
    data: {
      definition: 'resistor',
      rotation: 90,
      parameters: { resistance: { value: { kind: 'scalar', amount: 470, unit: 'ohm' } } },
    },
  },
]
const edges = [
  {
    id: 'e1',
    source: 'power_source_1',
    sourceHandle: 'terminal_positive',
    target: 'resistor_2',
    targetHandle: 'terminal_a',
    data: { waypoints: [{ id: 'w1', x: 130, y: 40 }], amps: 0.0149 },
  },
]

describe('serialize → deserialize round-trip', () => {
  test('keeps everything the user built; drops solved data', () => {
    const file = serializeCircuit(nodes, edges)
    const text = JSON.stringify(file, null, 2)
    const back = deserializeCircuit(text)
    expect(back.ok).toBe(true)
    if (!back.ok) return

    expect(back.file.nodes).toHaveLength(2)
    expect(back.file.nodes[1]).toMatchObject({
      id: 'resistor_2',
      definition: 'resistor',
      x: 220,
      y: 80,
      rotation: 90,
    })
    expect(back.file.nodes[0]?.parameters?.nominal_voltage?.value).toEqual({
      kind: 'scalar',
      amount: 9,
      unit: 'volt',
    })
    expect(back.file.wires[0]).toMatchObject({
      source: 'power_source_1',
      sourceHandle: 'terminal_positive',
      target: 'resistor_2',
      targetHandle: 'terminal_a',
    })
    expect(back.file.wires[0]?.waypoints).toEqual([{ id: 'w1', x: 130, y: 40 }])
    // Solved data must never be persisted — it is recomputed on load.
    expect(text.includes('amps')).toBe(false)
  })
})

describe('deserializeCircuit — honest rejections', () => {
  test('garbage text is not JSON', () => {
    const r = deserializeCircuit('this is not json')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('JSON')
  })
  test('JSON that is not a circuit file', () => {
    const r = deserializeCircuit('{"hello": "world"}')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('format')
  })
  test('a future version is rejected, not guessed at', () => {
    const file = { ...serializeCircuit([], []), version: CIRCUIT_FILE_VERSION + 1 }
    const r = deserializeCircuit(JSON.stringify(file))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('version')
  })
  test('a structurally broken part is rejected', () => {
    const file = serializeCircuit(nodes, edges) as unknown as { nodes: unknown[] }
    file.nodes[0] = { id: 'x' } // missing definition/position
    const r = deserializeCircuit(JSON.stringify(file))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('part')
  })
})

describe('maxIdSuffix', () => {
  test('the drop counter resumes above loaded ids', () => {
    expect(maxIdSuffix([{ id: 'resistor_7' }, { id: 'led_12' }, { id: 'ground_001' }])).toBe(12)
    expect(maxIdSuffix([])).toBe(0)
  })
})

describe('junctions + curve subtool (S19-v3-61)', () => {
  test('a junction node and a curved wire survive the save/load round trip', () => {
    const file = serializeCircuit(
      [
        {
          id: 'junction_3',
          position: { x: 40, y: 60 },
          data: { definition: 'junction' },
        },
      ],
      [
        {
          id: 'w9',
          source: 'junction_3',
          sourceHandle: 'tie',
          target: 'r1',
          targetHandle: 'terminal_a',
          data: {
            waypoints: [{ id: 'wp1', x: 80, y: 60 }],
            curved: true,
          },
        },
      ],
    )
    const parsed = deserializeCircuit(JSON.stringify(file))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.file.nodes[0]?.definition).toBe('junction')
    expect(parsed.file.wires[0]?.curved).toBe(true)
    expect(parsed.file.wires[0]?.waypoints?.length).toBe(1)
  })

  test('a straight wire saves WITHOUT a curved flag — nothing invented', () => {
    const file = serializeCircuit(
      [],
      [{ id: 'w1', source: 'a', sourceHandle: 'x', target: 'b', targetHandle: 'y' }],
    )
    expect('curved' in (file.wires[0] ?? {})).toBe(false)
  })
})

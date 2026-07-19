/**
 * The personal templates library (~/.chipblocks/user-templates.json) — round-trips a saved starter,
 * rejects a foreign / future-version file honestly, and drops a single template whose circuit this build
 * can't read while keeping the good ones. Mirrors user-library.test.ts.
 */
import { describe, expect, test } from 'vitest'
import { serializeCircuit } from '../src/renderer/circuit-file.ts'
import {
  deserializeUserTemplates,
  serializeUserTemplates,
  type UserTemplate,
  withTemplate,
} from '../src/renderer/user-templates.ts'

const sc = (amount: number, unit: string) => ({ value: { kind: 'scalar' as const, amount, unit } })
// A minimal but real saved circuit: a 5 V source and a resistor (no wires needed for the round-trip).
const sampleCircuit = () =>
  serializeCircuit(
    [
      {
        id: 'V1',
        position: { x: 0, y: 0 },
        data: { definition: 'power_source', parameters: { nominal_voltage: sc(5, 'volt') } },
      },
      {
        id: 'R1',
        position: { x: 100, y: 0 },
        data: { definition: 'resistor', parameters: { resistance: sc(1000, 'ohm') } },
      },
      // biome-ignore lint/suspicious/noExplicitAny: minimal DeviceNodeData for the test
    ] as any,
    [],
  )
const tpl = (id: string, name: string, createdAt: number): UserTemplate => ({
  id,
  name,
  workspace: 'schematic',
  circuit: sampleCircuit(),
  createdAt,
})

describe('user templates library format', () => {
  test('round-trips a saved template', () => {
    const templates = [tpl('t1', 'My Divider', 100)]
    const result = deserializeUserTemplates(serializeUserTemplates(templates))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.templates).toHaveLength(1)
    expect(result.templates[0]?.name).toBe('My Divider')
    expect(result.templates[0]?.workspace).toBe('schematic')
    expect(result.templates[0]?.circuit.nodes.length).toBe(2)
  })

  test('rejects a foreign file and a future version', () => {
    expect(deserializeUserTemplates('not json').ok).toBe(false)
    expect(deserializeUserTemplates(JSON.stringify({ format: 'something-else' })).ok).toBe(false)
    expect(
      deserializeUserTemplates(
        JSON.stringify({ format: 'chipblocks-user-templates', version: 99, templates: [] }),
      ).ok,
    ).toBe(false)
  })

  test('drops a template with an unreadable circuit, keeps the good ones', () => {
    const good = tpl('good', 'Good', 200)
    const file = JSON.stringify({
      format: 'chipblocks-user-templates',
      version: 1,
      templates: [
        good,
        { id: 'bad', name: 'Bad', workspace: 'schematic', circuit: { nope: true }, createdAt: 1 },
      ],
    })
    const result = deserializeUserTemplates(file)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.templates.map((t) => t.id)).toEqual(['good'])
  })

  test('deserialize sorts newest-first; withTemplate replaces by id', () => {
    const older = tpl('a', 'Older', 100)
    const newer = tpl('b', 'Newer', 300)
    const result = deserializeUserTemplates(serializeUserTemplates([older, newer]))
    expect(result.ok && result.templates.map((t) => t.id)).toEqual(['b', 'a'])
    const replaced = withTemplate([older, newer], { ...older, name: 'Renamed', createdAt: 400 })
    expect(replaced.map((t) => t.id)).toEqual(['a', 'b']) // 'a' now newest
    expect(replaced.find((t) => t.id === 'a')?.name).toBe('Renamed')
  })
})

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
  templatesAfterDelete,
  templatesAfterSave,
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

  test('a missing templates file starts with the one just saved', () => {
    const saved = templatesAfterSave(null, tpl('new', 'New', 500))
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    const back = deserializeUserTemplates(saved.text)
    expect(back.ok && back.templates.map((t) => t.id)).toEqual(['new'])
  })

  test('saving keeps a template that was already in the file', () => {
    const saved = templatesAfterSave(
      serializeUserTemplates([tpl('a', 'Older', 100)]),
      tpl('b', 'Newer', 300),
    )
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    const back = deserializeUserTemplates(saved.text)
    expect(back.ok && back.templates.map((t) => t.id)).toEqual(['b', 'a'])
  })

  test('saving onto an unreadable templates file refuses instead of replacing it', () => {
    const refused = templatesAfterSave('not json', tpl('new', 'New', 500))
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.reason).toMatch(/Nothing was written/)
    expect(
      templatesAfterSave(
        JSON.stringify({ format: 'chipblocks-user-templates', version: 99, templates: [] }),
        tpl('new', 'New', 500),
      ).ok,
    ).toBe(false)
  })

  test('deleting one template keeps the others that are in the file', () => {
    const text = serializeUserTemplates([tpl('a', 'Older', 100), tpl('b', 'Newer', 300)])
    const deleted = templatesAfterDelete(text, 'a')
    expect(deleted.ok).toBe(true)
    if (!deleted.ok) return
    expect(deleted.templates.map((t) => t.id)).toEqual(['b'])
    const back = deserializeUserTemplates(deleted.text)
    expect(back.ok && back.templates.map((t) => t.id)).toEqual(['b'])
  })

  test('deleting from a missing or broken templates file writes nothing', () => {
    expect(templatesAfterDelete(null, 'a').ok).toBe(false)
    const broken = templatesAfterDelete('not json', 'a')
    expect(broken.ok).toBe(false)
    if (broken.ok) return
    expect(broken.reason).toMatch(/Nothing was written/)
  })
})

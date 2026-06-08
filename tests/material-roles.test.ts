/**
 * material-roles tests (S19-v3-34) — the Properties panel offers only materials
 * that satisfy a role's declared must_enable. The headline case: an LED's n_side
 * lists only n-type direct-bandgap semiconductors (no copper, no indirect silicon).
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { parse as parseYAML } from 'yaml'
import { materialCapabilities, validMaterialsByRole } from '../src/renderer/material-roles.ts'

const material = (id: string, enables: string[]) => ({ id, kind: 'material', enables })

describe('materialCapabilities', () => {
  test('maps each material to its capability set; skips non-materials', () => {
    const defs = new Map<string, ReturnType<typeof material> | { id: string; kind: string }>([
      ['copper', material('copper', ['electrical_conduction'])],
      [
        'ingan_n',
        material('ingan_n', ['electrical_conduction', 'n_type_semiconductor', 'direct_bandgap']),
      ],
      ['led', { id: 'led', kind: 'primitive_device' }],
    ])
    const caps = materialCapabilities(defs.values())
    expect(caps.has('led')).toBe(false)
    expect(caps.get('ingan_n')?.has('direct_bandgap')).toBe(true)
    expect(caps.get('copper')?.has('direct_bandgap')).toBe(false)
  })
})

describe('validMaterialsByRole', () => {
  const caps = new Map<string, Set<string>>([
    ['copper', new Set(['electrical_conduction', 'thermal_conduction'])],
    ['nichrome', new Set(['electrical_conduction', 'thermal_conduction'])],
    ['silicon_n', new Set(['electrical_conduction', 'semiconductor', 'n_type_semiconductor'])], // indirect
    [
      'ingan_n',
      new Set(['electrical_conduction', 'semiconductor', 'n_type_semiconductor', 'direct_bandgap']),
    ],
    [
      'algainp_n',
      new Set(['electrical_conduction', 'semiconductor', 'n_type_semiconductor', 'direct_bandgap']),
    ],
  ])
  const led = {
    id: 'led',
    kind: 'primitive_device',
    composition: {
      requires: {
        n_side: { kind: 'material', must_enable: ['n_type_semiconductor', 'direct_bandgap'] },
        endpoints: { kind: 'interface', min_count: 2 },
      },
    },
  }
  const resistor = {
    id: 'resistor',
    kind: 'primitive_device',
    composition: {
      requires: {
        resistive_material: { kind: 'material', must_enable: ['electrical_conduction'] },
      },
    },
  }

  test('n_side offers only n-type direct-bandgap semiconductors (sorted)', () => {
    expect(validMaterialsByRole(led, caps).n_side).toEqual(['algainp_n', 'ingan_n'])
  })
  test('a conductor role (resistor body) hides specialized semiconductors', () => {
    // electrical_conduction is satisfied by all five, but the semiconductors are
    // hidden — a resistor body is a metal/alloy, not an LED's InGaN.
    expect(validMaterialsByRole(resistor, caps).resistive_material).toEqual(['copper', 'nichrome'])
  })
  test('skips non-material roles (endpoints)', () => {
    expect(validMaterialsByRole(led, caps).endpoints).toBeUndefined()
  })
  test('a definition with no material roles → empty', () => {
    expect(validMaterialsByRole({ id: 'x', kind: 'primitive_device' }, caps)).toEqual({})
    expect(validMaterialsByRole(undefined, caps)).toEqual({})
  })
})

describe('validMaterialsByRole against the real catalog', () => {
  type Def = { id: string; kind?: unknown; enables?: unknown; composition?: unknown }
  const dir = 'fixtures/valid'
  const defs: Def[] = []
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.yaml'))) {
    const data = parseYAML(readFileSync(join(dir, file), 'utf-8')) as Record<string, unknown>
    if (typeof data.id === 'string' && 'kind' in data) defs.push(data as Def)
  }
  const byId = new Map(defs.map((d) => [d.id, d]))
  const caps = materialCapabilities(defs)

  test('an LED n_side lists only n-type direct-bandgap semiconductors', () => {
    const n = validMaterialsByRole(byId.get('led'), caps).n_side
    expect(n).toContain('aluminum_gallium_indium_phosphide_n_type')
    expect(n).toContain('indium_gallium_nitride_n_type')
    expect(n).not.toContain('copper')
    expect(n).not.toContain('silicon_n_type') // indirect bandgap
    expect(n).not.toContain('solder_sac305')
  })
  test('a resistor body lists conductive metals/alloys — no semiconductors, no insulators', () => {
    const r = validMaterialsByRole(byId.get('resistor'), caps).resistive_material
    expect(r).toContain('nichrome')
    expect(r).toContain('copper')
    expect(r).not.toContain('indium_gallium_nitride_n_type') // semiconductor
    expect(r).not.toContain('silicon_n_type')
    expect(r).not.toContain('fr4') // insulator
    expect(r).not.toContain('air')
  })
  test('a switch contact lists metals/alloys, not semiconductors', () => {
    const c = validMaterialsByRole(byId.get('switch_spst_toggle'), caps).contact_material
    expect(c).toContain('copper')
    expect(c).not.toContain('gallium_arsenide_n_type')
  })
})

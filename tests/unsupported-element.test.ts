/**
 * Honesty contract: the DC solver must SURFACE a device definition it doesn't model rather than
 * silently treating it as an open circuit and reporting 'solved' (OBJECT-MODEL anti-placeholder
 * rule). It still solves the supported part of the circuit, but the status flags that an element was
 * skipped, and a warning names it. The companion test confirms a fully-supported circuit is NOT
 * flagged — guarding the supported-definition set against over-flagging real parts.
 */

import { describe, expect, test } from 'vitest'
import type { World } from '../src/cross-fk-validator.ts'
import { solveDC } from '../src/dc-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

function seriesWorld(secondPartDefinition: string): World {
  const world: World = {
    definitions: new Map(),
    instances: new Map(),
    behaviors: new Map(),
    activeVariables: new Map(),
    nets: new Map(),
  }
  world.nets.set('n1', {
    id: 'n1',
    kind: 'net',
    members: [
      { instance: 'src', terminal: 'terminal_positive' },
      { instance: 'part', terminal: 'terminal_a' },
    ],
  })
  world.nets.set('gnd', {
    id: 'gnd',
    kind: 'net',
    type: 'ground',
    members: [
      { instance: 'src', terminal: 'terminal_negative' },
      { instance: 'part', terminal: 'terminal_b' },
    ],
  })
  world.instances.set('src', {
    id: 'src',
    kind_ref: 'primitive_device',
    definition: 'power_source',
    parameters: { nominal_voltage: scalar(5, 'volt') },
    connects: [
      { net: 'n1', terminal: 'terminal_positive', of: 'src' },
      { net: 'gnd', terminal: 'terminal_negative', of: 'src' },
    ],
  })
  world.instances.set('part', {
    id: 'part',
    kind_ref: 'primitive_device',
    definition: secondPartDefinition,
    parameters: { resistance: scalar(1000, 'ohm') },
    connects: [
      { net: 'n1', terminal: 'terminal_a', of: 'part' },
      { net: 'gnd', terminal: 'terminal_b', of: 'part' },
    ],
  })
  return world
}

describe("solveDC — 'unsupported-element' honesty", () => {
  test('an unmodeled definition is surfaced (status + a warning naming it), not silently solved', () => {
    const result = solveDC(seriesWorld('flux_capacitor'))
    expect(result.status).toBe('unsupported-element')
    expect(result.warnings.some((w) => w.includes('flux_capacitor'))).toBe(true)
  })
  test('a fully-supported circuit still solves cleanly (the set does not over-flag real parts)', () => {
    const result = solveDC(seriesWorld('resistor'))
    expect(result.status).toBe('solved')
    expect(result.warnings.some((w) => w.includes('Unsupported'))).toBe(false)
  })
})

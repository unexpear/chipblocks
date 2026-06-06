/**
 * edge-currents tests (S19-v3-4).
 *
 * Verifies the canvas arrow direction + magnitude against the REAL solved
 * anchor circuit — not a hand-fed expectation. We run the actual DC solver on
 * the fixtures and confirm edgeFlow recovers the physical current direction
 * (battery out its +, around the loop, back to its −) and the ~69.4 mA loop
 * current, and that the ground tap carries nothing.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { parse as parseYAML } from 'yaml'
import type {
  ActiveVariableEntry,
  BehaviorEntry,
  Definition,
  Instance,
  Net,
  World,
} from '../src/cross-fk-validator.ts'
import { solveDC } from '../src/dc-solver.ts'
import { edgeFlow, formatCurrent, wireFlow } from '../src/renderer/edge-currents.ts'

function loadWorld(dir: string): World {
  const definitions = new Map<string, Definition>()
  const instances = new Map<string, Instance>()
  const behaviors = new Map<string, BehaviorEntry>()
  const activeVariables = new Map<string, ActiveVariableEntry>()
  const nets = new Map<string, Net>()
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.yaml'))) {
    const data = parseYAML(readFileSync(join(dir, file), 'utf-8')) as Record<string, unknown>
    const id = typeof data.id === 'string' ? data.id : undefined
    if (id === undefined) continue
    if (data.kind === 'behavior') behaviors.set(id, data as unknown as BehaviorEntry)
    else if (data.kind === 'active_variable')
      activeVariables.set(id, data as unknown as ActiveVariableEntry)
    else if (data.kind === 'net') nets.set(id, data as unknown as Net)
    else if ('kind' in data) definitions.set(id, data as unknown as Definition)
    else if ('kind_ref' in data) instances.set(id, data as unknown as Instance)
  }
  return { definitions, instances, behaviors, activeVariables, nets }
}

describe('edgeFlow — arrows driven by the real solver', () => {
  const world = loadWorld('fixtures/valid')
  const solution = solveDC(world)
  const LOOP_AMPS = 0.069357

  test('the solver actually solved the anchor circuit', () => {
    expect(solution.status).toBe('solved')
  })

  test('current leaves the battery at its + terminal (battery → wire_001)', () => {
    const f = edgeFlow(world, solution, 'net_battery_pos', 'battery_9v_001', 'wire_001')
    expect(f.carries).toBe(true)
    expect(f.sourceToTarget).toBe(true)
    expect(f.amps).toBeCloseTo(LOOP_AMPS, 6)
  })

  test('direction is orientation-aware: the same wire read backwards reverses', () => {
    const f = edgeFlow(world, solution, 'net_battery_pos', 'wire_001', 'battery_9v_001')
    expect(f.carries).toBe(true)
    expect(f.sourceToTarget).toBe(false) // current still flows battery → wire_001
    expect(f.amps).toBeCloseTo(LOOP_AMPS, 6)
  })

  test('current flows through the limiting resistor into the LED (resistor → led)', () => {
    const f = edgeFlow(world, solution, 'net_resistor_led', 'resistor_001', 'led_001')
    expect(f.sourceToTarget).toBe(true)
    expect(f.amps).toBeCloseTo(LOOP_AMPS, 6)
  })

  test('return current closes the loop back to the battery (wire_002 → battery)', () => {
    const f = edgeFlow(world, solution, 'net_battery_neg', 'wire_002', 'battery_9v_001')
    expect(f.sourceToTarget).toBe(true)
    expect(f.amps).toBeCloseTo(LOOP_AMPS, 6)
  })

  test('the ground tap carries no series current (no arrow)', () => {
    const f = edgeFlow(world, solution, 'net_battery_neg', 'wire_002', 'ground_001')
    expect(f.carries).toBe(false)
    expect(f.amps).toBe(0)
  })
})

describe('wireFlow — a collapsed wire-edge reads its own branch current', () => {
  const world = loadWorld('fixtures/valid')
  const solution = solveDC(world)
  const LOOP_AMPS = 0.069357

  test('current runs source→target when the source is on the positive side', () => {
    const f = wireFlow(solution, 'wire_001', true)
    expect(f.carries).toBe(true)
    expect(f.sourceToTarget).toBe(true)
    expect(f.amps).toBeCloseTo(LOOP_AMPS, 6)
  })
  test('reverses when the source is on the negative side', () => {
    expect(wireFlow(solution, 'wire_001', false).sourceToTarget).toBe(false)
  })
  test('an unknown wire carries nothing', () => {
    const f = wireFlow(solution, 'not_a_wire', true)
    expect(f.carries).toBe(false)
    expect(f.amps).toBe(0)
  })
})

describe('formatCurrent', () => {
  test('scales the unit to the magnitude', () => {
    expect(formatCurrent(0.069357)).toBe('69.4 mA')
    expect(formatCurrent(1.5)).toBe('1.50 A')
    expect(formatCurrent(0.0000123)).toBe('12.3 µA')
    expect(formatCurrent(0)).toBe('0 A')
  })
})

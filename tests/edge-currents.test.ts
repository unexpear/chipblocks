/**
 * edge-currents tests (S19-v3-4).
 *
 * Verifies the canvas arrow direction + magnitude against the REAL solved
 * anchor circuit — not a hand-fed expectation. We run the actual DC solver on
 * the fixtures and confirm wireFlow recovers each wire's own physical current
 * direction and the ~14.9 mA loop current, and that an unknown wire carries
 * nothing.
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
import { wireFlow } from '../src/renderer/edge-currents.ts'

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

describe('wireFlow — a collapsed wire-edge reads its own branch current', () => {
  const world = loadWorld('fixtures/valid')
  const solution = solveDC(world)
  const LOOP_AMPS = 0.0148944 // anchor loop current (9 V, 470 Ω, ~2 V LED, 1 Ω internal R)

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

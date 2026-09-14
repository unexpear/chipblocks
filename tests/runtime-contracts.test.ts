import { describe, expect, test } from 'vitest'
import type { World } from '../src/cross-fk-validator.ts'
import { solveDC } from '../src/dc-solver.ts'
import {
  asBlockId,
  asNetId,
  asTerminalId,
  endpointId,
  runtimeAnalysisFor,
  runtimePortOf,
} from '../src/runtime-contracts.ts'
import { solveTransient } from '../src/transient-solver.ts'

const emptyWorld = (): World => ({
  definitions: new Map(),
  instances: new Map(),
  behaviors: new Map(),
  activeVariables: new Map(),
  nets: new Map(),
})

describe('runtime contracts', () => {
  test('stable identifiers preserve the source identity and namespace endpoints', () => {
    const block = asBlockId('u1')
    const terminal = asTerminalId('out')
    expect(asNetId('n1')).toBe('n1')
    expect(endpointId(block, terminal)).toBe('u1/out')
  })

  test('port normalization supplies a shared role, direction, domain, and unit', () => {
    expect(runtimePortOf({ id: 'out', label: 'OUT', drive: 'push_pull' })).toMatchObject({
      id: 'out',
      label: 'OUT',
      name: 'OUT',
      domain: 'electrical',
      role: 'source',
      direction: 'output',
      unit: 'unknown',
    })
    expect(
      runtimePortOf({ id: 'in', drive: 'input', domain: 'digital', unit: 'boolean' }),
    ).toMatchObject({
      role: 'load',
      direction: 'input',
      domain: 'digital',
      unit: 'boolean',
    })
  })

  test('solver statuses become actionable shared analysis states', () => {
    expect(runtimeAnalysisFor('dc', 'solved')).toMatchObject({
      engine: 'dc',
      state: 'complete',
      diagnostics: [],
    })
    expect(runtimeAnalysisFor('transient', 'over-budget', ['stopped at step 4'])).toMatchObject({
      engine: 'transient',
      state: 'blocked',
    })
    expect(
      runtimeAnalysisFor('transient', 'over-budget', ['stopped at step 4']).diagnostics,
    ).toHaveLength(2)
  })

  test('DC and transient results carry the shared analysis projection', () => {
    const world = emptyWorld()
    expect(solveDC(world).analysis).toMatchObject({
      engine: 'dc',
      status: 'no-ground',
      state: 'blocked',
    })
    expect(solveDC(world).analysis?.why?.state).toBe('blocked')
    expect(solveTransient(world, { timeStep: 0, duration: 1 }).analysis).toMatchObject({
      engine: 'transient',
      status: 'bad-options',
      state: 'failed',
    })
    expect(solveTransient(world, { timeStep: 0, duration: 1 }).analysis?.why?.state).toBe('failed')
  })
})

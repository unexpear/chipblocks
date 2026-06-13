/**
 * Fuse tests (S21-v3-4) — the overcurrent part. Intact, it is a near-ideal link
 * carrying its small cold element resistance (read as the aux branch current);
 * blown, it is an open circuit, exactly like an open switch. The blow itself is
 * driven by overcurrentFuseIds: an INTACT fuse whose solved current exceeds its
 * rating is the fuse the canvas flips to 'blown' and re-solves open. A blown
 * fuse carries nothing and is never re-listed; an under-rating fuse holds.
 */

import { describe, expect, test } from 'vitest'
import type { Instance } from '../src/cross-fk-validator.ts'
import { fuseIsIntact, type Solution, solveDC } from '../src/dc-solver.ts'
import { overcurrentFuseIds } from '../src/failure-detector.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { solveTransient } from '../src/transient-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

/** A bare fuse instance for the pure state-helper tests. */
function fuse(state?: 'intact' | 'blown'): Instance {
  const parameters: Record<string, unknown> = { rated_current: scalar(0.5, 'ampere') }
  if (state !== undefined) parameters.state = { value: state }
  return { id: 'f', definition: 'fuse', parameters } as unknown as Instance
}

describe('the fuse state (intact conducts, blown is open)', () => {
  test('a fresh fuse (absent state) is intact', () => {
    expect(fuseIsIntact(fuse())).toBe(true)
  })
  test('an explicitly intact fuse is intact', () => {
    expect(fuseIsIntact(fuse('intact'))).toBe(true)
  })
  test('a blown fuse is not intact', () => {
    expect(fuseIsIntact(fuse('blown'))).toBe(false)
  })
})

/**
 * 9 V (ideal source) → fuse → R → back to the source's ground return. The fuse's
 * rating, element resistance, and the load resistance are the knobs.
 */
function fuseLoop(opts: {
  state?: 'intact' | 'blown'
  loadOhms: number
  ratedAmps?: number
  elementOhms?: number
}) {
  const params: Record<string, { value?: unknown; ref?: string }> = {
    rated_current: scalar(opts.ratedAmps ?? 0.5, 'ampere'),
    element_resistance: scalar(opts.elementOhms ?? 0.9, 'ohm'),
  }
  if (opts.state !== undefined) params.state = { value: opts.state }
  const nodes: CanvasNode[] = [
    {
      id: 'src',
      definition: 'power_source',
      parameters: { nominal_voltage: scalar(9, 'volt'), internal_resistance: scalar(0, 'ohm') },
    },
    { id: 'f', definition: 'fuse', parameters: params },
    { id: 'r', definition: 'resistor', parameters: { resistance: scalar(opts.loadOhms, 'ohm') } },
    { id: 'gnd', definition: 'ground' },
  ]
  const edges = [
    { source: 'src', sourceHandle: 'terminal_positive', target: 'f', targetHandle: 'terminal_a' },
    { source: 'f', sourceHandle: 'terminal_b', target: 'r', targetHandle: 'terminal_a' },
    { source: 'r', sourceHandle: 'terminal_b', target: 'src', targetHandle: 'terminal_negative' },
    {
      source: 'gnd',
      sourceHandle: 'reference_terminal',
      target: 'src',
      targetHandle: 'terminal_negative',
    },
  ]
  return canvasToWorld(nodes, edges)
}

const terminalVolts = (
  world: ReturnType<typeof canvasToWorld>,
  solution: Solution,
  terminal: string,
) => {
  const net = world.instances.get('f')?.connects?.find((c) => c.terminal === terminal)?.net
  return net === undefined ? undefined : solution.nodes.get(net)
}

describe('an intact fuse conducts', () => {
  test('it carries the loop current at its small element resistance: I = 9 / (R + R_element)', () => {
    const world = fuseLoop({ loadOhms: 100 }) // 0.9 Ω element + 100 Ω load
    const solution = solveDC(world)
    expect(solution.status).toBe('solved')
    expect(Math.abs(solution.branches.get('f') ?? 0)).toBeCloseTo(9 / 100.9, 6)
    expect(Math.abs(solution.branches.get('r') ?? 0)).toBeCloseTo(9 / 100.9, 6)
  })

  test('its element drops a real I·R — it is not a perfect short', () => {
    const world = fuseLoop({ loadOhms: 100 })
    const solution = solveDC(world)
    const vA = terminalVolts(world, solution, 'terminal_a') ?? Number.NaN
    const vB = terminalVolts(world, solution, 'terminal_b') ?? Number.NaN
    // V across the fuse = I · R_element.
    expect(vA - vB).toBeCloseTo((9 / 100.9) * 0.9, 6)
  })
})

describe('a blown fuse is an open circuit', () => {
  test('no current flows through a blown fuse — the loop is dead', () => {
    const world = fuseLoop({ state: 'blown', loadOhms: 100 })
    const solution = solveDC(world)
    expect(solution.status).toBe('solved')
    expect(Math.abs(solution.branches.get('r') ?? 0)).toBeLessThan(1e-9)
  })
})

describe('overcurrentFuseIds drives the blow', () => {
  test('an intact fuse over its rating is listed (it should blow)', () => {
    // 9 V / (10 + 0.9) Ω = 0.826 A through a 0.5 A fuse.
    const world = fuseLoop({ loadOhms: 10, ratedAmps: 0.5 })
    const solution = solveDC(world)
    expect(Math.abs(solution.branches.get('f') ?? 0)).toBeGreaterThan(0.5)
    expect(overcurrentFuseIds(world, solution)).toEqual(['f'])
  })

  test('an intact fuse under its rating is not listed (it holds)', () => {
    // 9 V / 100.9 Ω = 0.089 A, well under 0.5 A.
    const world = fuseLoop({ loadOhms: 100, ratedAmps: 0.5 })
    expect(overcurrentFuseIds(world, solveDC(world))).toEqual([])
  })

  test('a blown fuse is never listed (it already carries nothing)', () => {
    const world = fuseLoop({ state: 'blown', loadOhms: 10, ratedAmps: 0.5 })
    expect(overcurrentFuseIds(world, solveDC(world))).toEqual([])
  })
})

describe('the transient engine agrees', () => {
  test('intact carries the loop, blown carries nothing', () => {
    const intact = solveTransient(fuseLoop({ loadOhms: 100 }), { timeStep: 1e-4, duration: 1e-3 })
    const blown = solveTransient(fuseLoop({ state: 'blown', loadOhms: 100 }), {
      timeStep: 1e-4,
      duration: 1e-3,
    })
    const lastIntact = intact.series[intact.series.length - 1]
    const lastBlown = blown.series[blown.series.length - 1]
    expect(Math.abs(lastIntact?.currents?.get('r/terminal_a') ?? 0)).toBeCloseTo(9 / 100.9, 5)
    expect(Math.abs(lastBlown?.currents?.get('r/terminal_a') ?? 1)).toBeLessThan(1e-9)
  })
})

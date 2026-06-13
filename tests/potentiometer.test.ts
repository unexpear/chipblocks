/**
 * Potentiometer tests (S21-v3-3) — the 3-terminal variable resistor, solved by
 * both engines as two series conductances sharing the wiper net. The wiper
 * splits the track into R_top = R·p (terminal_a→wiper) and R_bottom = R·(1−p)
 * (wiper→terminal_b); an unloaded divider reduces to the textbook ratio, and a
 * loaded one sags exactly as two real resistors would. A two-terminal rheostat
 * (wiper + one end) is the single wired segment, the other end left floating.
 */

import { describe, expect, test } from 'vitest'
import type { Instance } from '../src/cross-fk-validator.ts'
import { POT_END_OHMS, potentiometerSegments, type Solution, solveDC } from '../src/dc-solver.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { solveTransient } from '../src/transient-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

/** A bare pot instance for the pure-function segment tests. */
function pot(resistanceOhms: number | undefined, wiper?: number): Instance {
  const parameters: Record<string, unknown> = {}
  if (resistanceOhms !== undefined) parameters.resistance = scalar(resistanceOhms, 'ohm')
  if (wiper !== undefined) parameters.wiper_position = scalar(wiper, 'dimensionless')
  return { id: 'pot', definition: 'potentiometer', parameters } as unknown as Instance
}

describe('the segment split (R_top = R·p, R_bottom = R·(1−p))', () => {
  test('mid-travel halves a 10 kΩ track into two 5 kΩ segments', () => {
    expect(potentiometerSegments(pot(10000, 0.5))).toEqual({ top: 5000, bottom: 5000 })
  })

  test('the two segments always sum to the total (off-centre)', () => {
    const seg = potentiometerSegments(pot(10000, 0.3))
    expect(seg).not.toBeNull()
    expect((seg?.top ?? 0) + (seg?.bottom ?? 0)).toBeCloseTo(10000, 9)
    expect(seg?.top).toBeCloseTo(3000, 9)
  })

  test('a fully-turned wiper floors the short segment at POT_END_OHMS, never 0', () => {
    expect(potentiometerSegments(pot(10000, 0))).toEqual({ top: POT_END_OHMS, bottom: 10000 })
    expect(potentiometerSegments(pot(10000, 1))).toEqual({ top: 10000, bottom: POT_END_OHMS })
  })

  test('an absent wiper position reads as mid-travel (0.5)', () => {
    expect(potentiometerSegments(pot(10000))).toEqual({ top: 5000, bottom: 5000 })
  })

  test('the wiper position is clamped to the real 0..1 travel', () => {
    expect(potentiometerSegments(pot(10000, 1.5))).toEqual({ top: 10000, bottom: POT_END_OHMS })
    expect(potentiometerSegments(pot(10000, -0.4))).toEqual({ top: POT_END_OHMS, bottom: 10000 })
  })

  test('a missing total resistance has no segments', () => {
    expect(potentiometerSegments(pot(undefined, 0.5))).toBeNull()
  })
})

/**
 * 12 V → pot terminal_a; terminal_b → ground; wiper → a load resistor → ground.
 * A large load is effectively unloaded (the textbook ratio); a small one sags.
 */
function dividerRig(wiper: number, loadOhms: number) {
  const nodes: CanvasNode[] = [
    {
      id: 'src',
      definition: 'power_source',
      parameters: { nominal_voltage: scalar(12, 'volt'), internal_resistance: scalar(0, 'ohm') },
    },
    {
      id: 'pot',
      definition: 'potentiometer',
      parameters: {
        resistance: scalar(10000, 'ohm'),
        wiper_position: scalar(wiper, 'dimensionless'),
      },
    },
    { id: 'load', definition: 'resistor', parameters: { resistance: scalar(loadOhms, 'ohm') } },
    { id: 'gnd', definition: 'ground' },
  ]
  const edges = [
    { source: 'src', sourceHandle: 'terminal_positive', target: 'pot', targetHandle: 'terminal_a' },
    { source: 'pot', sourceHandle: 'terminal_b', target: 'src', targetHandle: 'terminal_negative' },
    { source: 'pot', sourceHandle: 'wiper', target: 'load', targetHandle: 'terminal_a' },
    {
      source: 'load',
      sourceHandle: 'terminal_b',
      target: 'src',
      targetHandle: 'terminal_negative',
    },
    {
      source: 'gnd',
      sourceHandle: 'reference_terminal',
      target: 'src',
      targetHandle: 'terminal_negative',
    },
  ]
  return canvasToWorld(nodes, edges)
}

/** The solved voltage at a part's named terminal. */
function terminalVolts(
  world: ReturnType<typeof canvasToWorld>,
  solution: Solution | { nodes: Map<string, number> },
  partId: string,
  terminal: string,
): number | undefined {
  const net = world.instances.get(partId)?.connects?.find((c) => c.terminal === terminal)?.net
  return net === undefined ? undefined : solution.nodes.get(net)
}

describe('the unloaded divider (10 MΩ load ≈ ideal ratio)', () => {
  // V_wiper = V_a·(1−p) + V_b·p; here V_a = 12, V_b = 0 → 12·(1−p).
  for (const [p, expected] of [
    [0, 12],
    [0.25, 9],
    [0.5, 6],
    [0.75, 3],
    [1, 0],
  ] as const) {
    test(`wiper at ${p} → ${expected} V`, () => {
      const world = dividerRig(p, 10e6)
      const solution = solveDC(world)
      expect(solution.status).toBe('solved')
      expect(terminalVolts(world, solution, 'pot', 'wiper')).toBeCloseTo(expected, 2)
    })
  }
})

describe('the loaded divider sags like two real resistors', () => {
  test('a 10 kΩ load on the mid-tap pulls 6 V down to exactly 4.8 V', () => {
    // R_top 5k, R_bottom 5k, load 10k from wiper to ground:
    // (12−Vw)/5000 = Vw/5000 + Vw/10000 → Vw = 4.8 V.
    const world = dividerRig(0.5, 10000)
    const solution = solveDC(world)
    expect(solution.status).toBe('solved')
    expect(terminalVolts(world, solution, 'pot', 'wiper')).toBeCloseTo(4.8, 6)
  })
})

/**
 * 12 V → pot terminal_a; wiper → load → ground; terminal_b LEFT FLOATING. The
 * pot is now a two-terminal rheostat: only the a→wiper segment is in the loop.
 */
function rheostatRig(wiper: number, loadOhms: number) {
  const nodes: CanvasNode[] = [
    {
      id: 'src',
      definition: 'power_source',
      parameters: { nominal_voltage: scalar(12, 'volt'), internal_resistance: scalar(0, 'ohm') },
    },
    {
      id: 'pot',
      definition: 'potentiometer',
      parameters: {
        resistance: scalar(10000, 'ohm'),
        wiper_position: scalar(wiper, 'dimensionless'),
      },
    },
    { id: 'load', definition: 'resistor', parameters: { resistance: scalar(loadOhms, 'ohm') } },
    { id: 'gnd', definition: 'ground' },
  ]
  const edges = [
    { source: 'src', sourceHandle: 'terminal_positive', target: 'pot', targetHandle: 'terminal_a' },
    { source: 'pot', sourceHandle: 'wiper', target: 'load', targetHandle: 'terminal_a' },
    {
      source: 'load',
      sourceHandle: 'terminal_b',
      target: 'src',
      targetHandle: 'terminal_negative',
    },
    {
      source: 'gnd',
      sourceHandle: 'reference_terminal',
      target: 'src',
      targetHandle: 'terminal_negative',
    },
  ]
  return canvasToWorld(nodes, edges)
}

describe('the rheostat (wiper + one end, the other floating)', () => {
  test('the a→wiper segment is in series with the load: I = 12 / (R_top + R_load)', () => {
    // p 0.5 → R_top 5 kΩ; with a 5 kΩ load, I = 12 / 10 kΩ = 1.2 mA.
    const world = rheostatRig(0.5, 5000)
    const solution = solveDC(world)
    expect(solution.status).toBe('solved')
    expect(Math.abs(solution.branches.get('pot') ?? 0)).toBeCloseTo(0.0012, 6)
    expect(Math.abs(solution.branches.get('load') ?? 0)).toBeCloseTo(0.0012, 6)
  })

  test('turning the wiper toward terminal_a (less top resistance) raises the current', () => {
    const lowR = solveDC(rheostatRig(0.1, 5000)).branches.get('pot') ?? 0 // R_top 1 kΩ
    const highR = solveDC(rheostatRig(0.9, 5000)).branches.get('pot') ?? 0 // R_top 9 kΩ
    expect(Math.abs(lowR)).toBeGreaterThan(Math.abs(highR))
    expect(Math.abs(lowR)).toBeCloseTo(12 / 6000, 6) // 1k + 5k
    expect(Math.abs(highR)).toBeCloseTo(12 / 14000, 6) // 9k + 5k
  })
})

describe('both engines agree on the divider', () => {
  test('the transient steady state matches the DC wiper voltage', () => {
    const world = dividerRig(0.3, 10000)
    const dc = solveDC(world)
    const tr = solveTransient(world, { timeStep: 1e-4, duration: 2e-3 })
    const last = tr.series[tr.series.length - 1]
    expect(last).toBeDefined()
    const dcWiper = terminalVolts(world, dc, 'pot', 'wiper') ?? Number.NaN
    const trWiper = last?.nodes
      ? terminalVolts(world, { nodes: last.nodes }, 'pot', 'wiper')
      : undefined
    expect(trWiper).toBeCloseTo(dcWiper, 6)
  })

  test('the transient records the wiper current (load current) at the tap', () => {
    // Loaded divider: the wiper carries the load current it feeds.
    const world = dividerRig(0.5, 10000)
    const tr = solveTransient(world, { timeStep: 1e-4, duration: 2e-3 })
    const last = tr.series[tr.series.length - 1]
    const iWiper = Math.abs(last?.currents?.get('pot/wiper') ?? 0)
    // V_wiper 4.8 V across a 10 kΩ load → 0.48 mA out of the tap.
    expect(iWiper).toBeCloseTo(4.8 / 10000, 5)
  })
})

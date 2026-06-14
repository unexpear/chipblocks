/**
 * Rectifier-diode DC tests (S19-v3-65) — the plain silicon rectifier joins the
 * DC solver's Shockley family (it always worked in the transient solver):
 * forward it conducts at the real Shockley operating point, reversed it
 * blocks, and its two ratings (forward current, peak inverse voltage) fire
 * real failures when exceeded.
 */

import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import {
  checkDiodeForwardOverload,
  checkDiodePeakInverse,
  detectFailures,
} from '../src/failure-detector.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

/** Battery → resistor → diode (forward or reversed) → back, with ground. */
function diodeLoop(options: {
  volts?: number
  ohms?: number
  reversed?: boolean
  maxForwardAmps?: number
  pivVolts?: number
}): ReturnType<typeof canvasToWorld> {
  const { volts = 9, ohms = 100, reversed = false, maxForwardAmps = 1, pivVolts = 1000 } = options
  const nodes: CanvasNode[] = [
    {
      id: 'bat',
      definition: 'power_source',
      parameters: { nominal_voltage: scalar(volts, 'volt'), internal_resistance: scalar(1, 'ohm') },
    },
    { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(ohms, 'ohm') } },
    {
      id: 'd1',
      definition: 'diode_silicon_rectifier',
      parameters: {
        forward_voltage: scalar(1.0, 'volt'), // 1N4007 class: ≤1.0 V at 1 A
        max_forward_current: scalar(maxForwardAmps, 'ampere'),
        peak_inverse_voltage: scalar(pivVolts, 'volt'),
      },
    },
    { id: 'gnd', definition: 'ground' },
  ]
  const edges = [
    { source: 'bat', sourceHandle: 'terminal_positive', target: 'r1', targetHandle: 'terminal_a' },
    {
      source: 'r1',
      sourceHandle: 'terminal_b',
      target: 'd1',
      targetHandle: reversed ? 'cathode' : 'anode',
    },
    {
      source: 'd1',
      sourceHandle: reversed ? 'anode' : 'cathode',
      target: 'bat',
      targetHandle: 'terminal_negative',
    },
    {
      source: 'gnd',
      sourceHandle: 'reference_terminal',
      target: 'bat',
      targetHandle: 'terminal_negative',
    },
  ]
  return canvasToWorld(nodes, edges)
}

describe('rectifier diode in the DC solver', () => {
  test('forward: conducts at the real Shockley operating point (~80 mA here)', () => {
    const solution = solveDC(diodeLoop({}))
    expect(solution.status).toBe('solved')
    const amps = Math.abs(solution.branches.get('d1') ?? 0)
    // Self-consistent check: 9 V = I·(100 + 1) Ω + V_diode(I). With the 1N4007
    // calibration (1.0 V at 1 A, n = 2) the junction sits near 0.87 V at this
    // current, giving I ≈ (9 − 0.87)/101 ≈ 80.5 mA.
    expect(amps).toBeGreaterThan(0.079)
    expect(amps).toBeLessThan(0.082)
    expect(solution.converged).toBe(true)
  })

  test('reversed: blocks — only the Shockley leakage flows (essentially nothing)', () => {
    const solution = solveDC(diodeLoop({ reversed: true }))
    expect(solution.status).toBe('solved')
    const amps = Math.abs(solution.branches.get('d1') ?? 0)
    expect(amps).toBeLessThan(1e-6)
  })

  test('forward overload fires diode-overloaded with the real numbers', () => {
    const world = diodeLoop({ maxForwardAmps: 0.05 }) // rated 50 mA, driven ~80 mA
    const solution = solveDC(world)
    const failures = detectFailures(world, solution)
    const overload = failures.find((f) => f.code === 'diode-overloaded')
    expect(overload).toBeDefined()
    expect(overload?.source).toBe('d1')
    // Note: the rating IS the Shockley calibration current, so re-rating to
    // 50 mA also shifts the curve slightly — the loop lands near 79 mA.
    expect(overload?.measured).toBeGreaterThan(0.075)
    expect(overload?.rated).toBeCloseTo(0.05, 9)
    // The exported single check agrees with the dispatcher.
    const direct = checkDiodeForwardOverload(
      [...world.instances.values()].find((i) => i.id === 'd1') ?? ({} as never),
      solution,
    )
    expect(direct?.code).toBe('diode-overloaded')
  })

  test('exceeding the peak inverse voltage fires diode-reverse-breakdown', () => {
    // Reversed diode blocks → nearly the full 12 V sits across it; PIV 10 V.
    const world = diodeLoop({ volts: 12, reversed: true, pivVolts: 10 })
    const solution = solveDC(world)
    const failures = detectFailures(world, solution)
    const breakdown = failures.find((f) => f.code === 'diode-reverse-breakdown')
    expect(breakdown).toBeDefined()
    expect(breakdown?.kind).toBe('peak_inverse_voltage')
    expect(breakdown?.measured).toBeGreaterThan(11.9)
    expect(breakdown?.rated).toBeCloseTo(10, 9)
    const direct = checkDiodePeakInverse(
      [...world.instances.values()].find((i) => i.id === 'd1') ?? ({} as never),
      solution,
    )
    expect(direct?.code).toBe('diode-reverse-breakdown')
  })

  test('within ratings nothing fires — the rating is honored, not assumed', () => {
    const world = diodeLoop({})
    const failures = detectFailures(world, solveDC(world))
    expect(failures.filter((f) => f.source === 'd1')).toEqual([])
  })

  // A 9 V source through 100 Ω into a reverse-biased zener (current enters its
  // cathode) — the classic shunt regulator. `zenerParams` lets a test omit V_Z.
  const zenerRegulator = (
    zenerParams: Record<string, { value?: unknown; ref?: string }>,
  ): CanvasNode[] => [
    {
      id: 'bat',
      definition: 'power_source',
      parameters: { nominal_voltage: scalar(9, 'volt'), internal_resistance: scalar(1, 'ohm') },
    },
    { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(100, 'ohm') } },
    { id: 'z1', definition: 'diode_zener_silicon', parameters: zenerParams },
    { id: 'gnd', definition: 'ground' },
  ]
  const regulatorEdges = [
    { source: 'bat', sourceHandle: 'terminal_positive', target: 'r1', targetHandle: 'terminal_a' },
    { source: 'r1', sourceHandle: 'terminal_b', target: 'z1', targetHandle: 'cathode' },
    { source: 'z1', sourceHandle: 'anode', target: 'bat', targetHandle: 'terminal_negative' },
    {
      source: 'gnd',
      sourceHandle: 'reference_terminal',
      target: 'bat',
      targetHandle: 'terminal_negative',
    },
  ]

  test('a zener regulates — the reverse voltage clamps at its V_Z', () => {
    const world = canvasToWorld(
      zenerRegulator({
        zener_voltage: scalar(5.1, 'volt'),
        forward_voltage: scalar(0.7, 'volt'),
        knee_current: scalar(0.005, 'ampere'),
      }),
      regulatorEdges,
    )
    const solution = solveDC(world)
    expect(solution.status).toBe('solved')
    const z = world.instances.get('z1')
    const cathodeNet = z?.connects?.find((c) => c.terminal === 'cathode')?.net ?? ''
    const anodeNet = z?.connects?.find((c) => c.terminal === 'anode')?.net ?? ''
    const reverseVolts = (solution.nodes.get(cathodeNet) ?? 0) - (solution.nodes.get(anodeNet) ?? 0)
    expect(reverseVolts).toBeGreaterThan(5) // clamped near V_Z…
    expect(reverseVolts).toBeLessThan(5.6) // …not the ~9 V it would block to unregulated
    // Reverse breakdown conducts cathode→anode, so the anode→cathode branch is negative.
    expect(solution.branches.get('z1') ?? 0).toBeLessThan(0)
  })

  test('a zener without its V_Z is skipped with a warning, not faked', () => {
    const world = canvasToWorld(zenerRegulator({}), regulatorEdges)
    const solution = solveDC(world)
    expect(solution.warnings.join(' ')).toContain('zener')
    expect(solution.branches.get('z1')).toBeUndefined()
  })
})

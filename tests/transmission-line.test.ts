/**
 * Transmission line — finite propagation + characteristic impedance (Branin's method).
 * The "when does the bulb light?" physics: close a switch and the far end stays DARK until
 * the wave arrives (after τ = length/v), the first gulp of current is set by Z₀ (not the
 * load), and it settles to the plain DC answer once the wave has run the line. The lumped
 * solver is that settled limit.
 */

import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import { SPEED_OF_LIGHT_M_S } from '../src/field-energy.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { solveTransient } from '../src/transient-solver.ts'
import {
  propagationDelayS,
  reflectionCoefficient,
  twoWireImpedanceOhms,
} from '../src/transmission-line-model.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const g = (s: string, sh: string, t: string, th: string) => ({
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
})

// 10 V source (matched, R_src = Z₀) → 300 Ω/300 m/0.95c line → a load. τ ≈ 1.05 µs.
function lineCircuit(loadOhms: number) {
  const nodes: CanvasNode[] = [
    {
      id: 'src',
      definition: 'power_source',
      parameters: { nominal_voltage: scalar(10, 'volt'), internal_resistance: scalar(300, 'ohm') },
    },
    {
      id: 'line',
      definition: 'transmission_line',
      parameters: {
        characteristic_impedance: scalar(300, 'ohm'),
        length: scalar(300, 'meter'),
        velocity_factor: scalar(0.95, 'dimensionless'),
      },
    },
    { id: 'load', definition: 'resistor', parameters: { resistance: scalar(loadOhms, 'ohm') } },
    { id: 'gnd', definition: 'ground' },
  ]
  const edges = [
    g('src', 'terminal_positive', 'line', 'near_a'),
    g('line', 'near_b', 'src', 'terminal_negative'),
    g('line', 'far_a', 'load', 'terminal_a'),
    g('load', 'terminal_b', 'line', 'far_b'),
    g('gnd', 'reference_terminal', 'src', 'terminal_negative'),
  ]
  const world = canvasToWorld(nodes, edges)
  const lineInst = world.instances.get('line')
  const net = (terminal: string) =>
    lineInst?.connects?.find((c) => c.terminal === terminal)?.net ?? ''
  return { world, farA: net('far_a'), farB: net('far_b') }
}

const TAU = propagationDelayS(300, 0.95)

describe('transmission line — the line physics', () => {
  test('propagation delay τ = length / (c·velocity_factor)', () => {
    expect(TAU).toBeCloseTo(300 / (SPEED_OF_LIGHT_M_S * 0.95), 12)
    expect(TAU).toBeGreaterThan(1e-6) // ~1.05 µs for the 300 m line
    expect(TAU).toBeLessThan(1.1e-6)
    expect(propagationDelayS(600, 0.95)).toBeCloseTo(2 * TAU, 12) // twice the length → twice the delay
  })

  test('two-wire characteristic impedance Z₀ = (η₀/π)·acosh(D/d) — a few hundred ohms', () => {
    const z = twoWireImpedanceOhms(0.01, 0.001) // 10 mm spacing, 1 mm wire
    expect(z).toBeGreaterThan(300)
    expect(z).toBeLessThan(420)
    expect(twoWireImpedanceOhms(0.005, 0.005)).toBe(0) // touching conductors → guarded
  })

  test('reflection coefficient Γ = (Z_L − Z₀)/(Z_L + Z₀)', () => {
    expect(reflectionCoefficient(300, 300)).toBe(0) // matched — no reflection
    expect(reflectionCoefficient(900, 300)).toBeCloseTo(0.5, 9) // mismatch
    expect(reflectionCoefficient(0, 300)).toBe(-1) // short
    expect(reflectionCoefficient(1e12, 300)).toBeCloseTo(1, 6) // open
  })

  test('the far end stays DARK until the wave arrives (τ), then turns on', () => {
    const { world, farA, farB } = lineCircuit(300) // matched load
    const result = solveTransient(world, { timeStep: 5e-8, duration: 3e-6 })
    expect(result.status).toBe('solved')
    const vFar = result.series.map((p) => (p.nodes.get(farA) ?? 0) - (p.nodes.get(farB) ?? 0))
    const times = result.series.map((p) => p.time)
    // well before the wave lands, the load is dark
    const earlyIdx = times.findIndex((t) => t >= 0.5 * TAU)
    expect(Math.abs(vFar[earlyIdx] ?? 99)).toBeLessThan(0.3)
    // well after, it sits at its DC value (10 V across the 300+300 divider = 5 V)
    expect(vFar[vFar.length - 1] ?? 0).toBeCloseTo(5, 1)
    // and it was still dark just before τ but lit just after
    const before = times.findIndex((t) => t >= 0.8 * TAU)
    const after = times.findIndex((t) => t >= 1.5 * TAU)
    expect(Math.abs(vFar[before] ?? 9)).toBeLessThan(0.5)
    expect(vFar[after] ?? 0).toBeGreaterThan(4)
  })

  test('the source first sees Z₀, not the load — a big initial gulp into a near-open line', () => {
    const { world } = lineCircuit(1e6) // ~open far end
    const result = solveTransient(world, { timeStep: 5e-8, duration: 6e-6 })
    expect(result.status).toBe('solved')
    const iSrc = result.series.map((p) => Math.abs(p.currents?.get('src/terminal_positive') ?? 0))
    // at switch-on the source pushes V/(R_src+Z₀) = 10/600 ≈ 16.7 mA into the LINE's Z₀,
    // even though the open load will eventually draw almost nothing
    expect(iSrc[0] ?? 0).toBeCloseTo(10 / 600, 3)
    // …and it settles toward the tiny DC current of the open load
    expect(iSrc[iSrc.length - 1] ?? 1).toBeLessThan((iSrc[0] ?? 1) / 10)
  })

  test('the transient settles to exactly the lumped DC answer', () => {
    const { world, farA, farB } = lineCircuit(300)
    const dc = solveDC(world)
    expect(dc.status).toBe('solved')
    const vFarDc = (dc.nodes.get(farA) ?? 0) - (dc.nodes.get(farB) ?? 0)
    const result = solveTransient(world, { timeStep: 5e-8, duration: 4e-6 })
    const vFarLate =
      (result.series[result.series.length - 1]?.nodes.get(farA) ?? 0) -
      (result.series[result.series.length - 1]?.nodes.get(farB) ?? 0)
    expect(vFarLate).toBeCloseTo(vFarDc, 1) // the field/line picture lands on the lumped answer
  })
})

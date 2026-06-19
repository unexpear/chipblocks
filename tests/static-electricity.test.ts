/**
 * Static electricity — the PHYSICS, not a placeable part. The triboelectric_charging
 * behavior is the catalog phenomenon (V = Q/C, energy ½CV², the triboelectric series);
 * its standard quantitative model is the Human Body Model — a small body capacitance
 * pre-charged to kilovolts discharging through a series resistance. This test confirms
 * that math is reproducible from real parts (a pre-charged capacitor + resistor, via the
 * capacitor's initial_voltage), so the static-shock discharge is honest, not scripted.
 */

import { describe, expect, test } from 'vitest'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { solveTransient } from '../src/transient-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

/** Build the Human Body Model by hand — a 100 pF body pre-charged to 2 kV, through a
 *  1.5 kΩ series resistance into a load — and return the transient discharge at the tip. */
function humanBodyModel(loadOhms: number, timeStep: number, duration: number) {
  const nodes: CanvasNode[] = [
    {
      id: 'body',
      definition: 'capacitor',
      parameters: { capacitance: scalar(100e-12, 'farad'), initial_voltage: scalar(2000, 'volt') },
    },
    { id: 'rs', definition: 'resistor', parameters: { resistance: scalar(1500, 'ohm') } },
    { id: 'ld', definition: 'resistor', parameters: { resistance: scalar(loadOhms, 'ohm') } },
    { id: 'gnd', definition: 'ground' },
  ]
  const edges = [
    { source: 'body', sourceHandle: 'terminal_b', target: 'rs', targetHandle: 'terminal_a' },
    { source: 'rs', sourceHandle: 'terminal_b', target: 'ld', targetHandle: 'terminal_a' },
    { source: 'ld', sourceHandle: 'terminal_b', target: 'gnd', targetHandle: 'reference_terminal' },
    {
      source: 'body',
      sourceHandle: 'terminal_a',
      target: 'gnd',
      targetHandle: 'reference_terminal',
    },
  ]
  const world = canvasToWorld(nodes, edges)
  const result = solveTransient(world, { timeStep, duration })
  const tipNet = world.instances.get('ld')?.connects?.find((c) => c.terminal === 'terminal_a')?.net
  return { result, tipNet }
}

describe('the static-charge math: high voltage, tiny energy', () => {
  test('V = Q/C — a few nC on a small body reaches kilovolts', () => {
    // 200 nC separated onto a 100 pF body: V = Q/C = 2e-7 / 1e-10 = 2 kV.
    const charge = 200e-9
    const selfCapacitance = 100e-12
    expect(charge / selfCapacitance).toBeCloseTo(2000, 6)
    // ...but the stored energy ½CV² is minute — a fraction of a millijoule.
    const energy = 0.5 * selfCapacitance * (charge / selfCapacitance) ** 2
    expect(energy).toBeLessThan(1e-3) // < 1 mJ: it stings, it can't light a bulb
  })
})

describe('the Human Body Model discharge (the static shock), from real parts', () => {
  test('the body starts at kilovolts and bleeds off as a real RC pulse', () => {
    // 10 kΩ victim + 1.5 kΩ series + 100 pF → τ = 11.5 kΩ · 100 pF ≈ 1.15 µs.
    const { result, tipNet } = humanBodyModel(1e4, 1e-8, 4e-6)
    expect(result.status).toBe('solved')
    const first = Math.abs(result.series[0]?.nodes.get(tipNet ?? '') ?? 0)
    const last = Math.abs(result.series.at(-1)?.nodes.get(tipNet ?? '') ?? 0)
    expect(first).toBeGreaterThan(1000) // the initial zap (≈1.7 kV across the divider)
    expect(last).toBeLessThan(200) // ~3.5 time constants later it has bled off
    expect(last).toBeLessThan(first / 5) // a genuine one-shot discharge, not a steady source
  })

  test('into a high-impedance victim (a gate) it holds the high voltage — the oxide killer', () => {
    // A 10 MΩ gate-like load barely loads the body, so it stays near full voltage over a
    // window that fully discharges the 10 kΩ case: high V, almost no current.
    const { result, tipNet } = humanBodyModel(1e7, 5e-8, 4e-6)
    const last = Math.abs(result.series.at(-1)?.nodes.get(tipNet ?? '') ?? 0)
    expect(last).toBeGreaterThan(1500)
  })
})

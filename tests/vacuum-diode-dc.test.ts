/**
 * Vacuum diode (Fleming valve) — DC solver. A B+ supply drives a load resistor into
 * the plate; the hot cathode returns to ground. Forward (plate positive) the tube
 * conducts by the Child-Langmuir 3/2 law; reverse (plate negative) it blocks — the
 * one-way conduction Fleming's valve was built for, the first electronic component.
 */

import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import { detectFailures } from '../src/failure-detector.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { childLangmuirCurrent, perveanceFromOperatingPoint } from '../src/vacuum-tube-model.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

const REF_V = 10
const REF_I = 0.01
const PERVEANCE = perveanceFromOperatingPoint(REF_I, REF_V) // I_ref / V_ref^1.5

const diodeParams = () => ({
  reference_plate_voltage: scalar(REF_V, 'volt'),
  plate_current_at_reference: scalar(REF_I, 'ampere'),
  max_plate_dissipation: scalar(2, 'watt'),
  max_plate_voltage: scalar(330, 'volt'),
})

/** B+(sourceVolts) → load → plate; cathode → ground. */
function rig(sourceVolts: number, loadOhms = 10000) {
  const nodes: CanvasNode[] = [
    {
      id: 'src',
      definition: 'power_source',
      parameters: {
        nominal_voltage: scalar(sourceVolts, 'volt'),
        internal_resistance: scalar(0, 'ohm'),
      },
    },
    { id: 'rload', definition: 'resistor', parameters: { resistance: scalar(loadOhms, 'ohm') } },
    { id: 'v1', definition: 'vacuum_diode', parameters: diodeParams() },
    { id: 'gnd', definition: 'ground' },
  ]
  const edges = [
    {
      source: 'src',
      sourceHandle: 'terminal_positive',
      target: 'rload',
      targetHandle: 'terminal_a',
    },
    { source: 'rload', sourceHandle: 'terminal_b', target: 'v1', targetHandle: 'plate' },
    { source: 'v1', sourceHandle: 'cathode', target: 'src', targetHandle: 'terminal_negative' },
    {
      source: 'gnd',
      sourceHandle: 'reference_terminal',
      target: 'src',
      targetHandle: 'terminal_negative',
    },
  ]
  return canvasToWorld(nodes, edges)
}

function plateCathodeVolts(
  world: ReturnType<typeof canvasToWorld>,
  sol: ReturnType<typeof solveDC>,
) {
  const connects = world.instances.get('v1')?.connects
  const plate = connects?.find((c) => c.terminal === 'plate')?.net
  const cathode = connects?.find((c) => c.terminal === 'cathode')?.net
  return (sol.nodes.get(plate ?? '') ?? 0) - (sol.nodes.get(cathode ?? '') ?? 0)
}

describe('vacuum diode — DC', () => {
  test('forward: it conducts by the Child-Langmuir 3/2 law', () => {
    const world = rig(100)
    const sol = solveDC(world)
    expect(sol.status).toBe('solved')
    const i = Math.abs(sol.branches.get('v1') ?? 0)
    expect(i).toBeGreaterThan(0.008)
    expect(i).toBeLessThan(0.01) // ~9 mA operating point on a 100 V / 10 kΩ load
    // the reported current IS I = perveance·V_pk^1.5 at the solved plate-cathode voltage
    expect(i).toBeCloseTo(childLangmuirCurrent(plateCathodeVolts(world, sol), PERVEANCE), 9)
  })

  test('reverse: it blocks — a cold plate cannot pull electrons backward', () => {
    const world = rig(-100)
    const sol = solveDC(world)
    expect(sol.status).toBe('solved')
    expect(Math.abs(sol.branches.get('v1') ?? 0)).toBeLessThan(1e-6) // rectification
    expect(plateCathodeVolts(world, sol)).toBeLessThan(0) // the plate sits reverse-biased
  })

  test('a soft rectifier: a modest forward drop, and more supply → more current', () => {
    const world = rig(100)
    const sol = solveDC(world)
    const vDrop = plateCathodeVolts(world, sol)
    expect(vDrop).toBeGreaterThan(0)
    expect(vDrop).toBeLessThan(20) // the tube drops only ~9 V of the 100 V supply
    const i100 = Math.abs(sol.branches.get('v1') ?? 0)
    const i200 = Math.abs(solveDC(rig(200)).branches.get('v1') ?? 0)
    expect(i200).toBeGreaterThan(i100) // a stiffer B+ pushes more plate current
  })

  test('over-dissipation: too much plate power fires the red-plate failure', () => {
    // High B+ into a low load → large plate current AND voltage → the plate dissipates
    // far past its ~2 W rating (the cherry-red plate that kills a tube).
    const world = rig(200, 1000)
    const sol = solveDC(world)
    expect(sol.status).toBe('solved')
    const failure = detectFailures(world, sol).find(
      (f) => f.source === 'v1' && f.code === 'tube-plate-overdissipation',
    )
    expect(failure).toBeDefined()
    // and at the rated 100 V / 10 kΩ operating point it does NOT fail
    expect(
      detectFailures(rig(100), solveDC(rig(100))).find((f) => f.source === 'v1'),
    ).toBeUndefined()
  })
})

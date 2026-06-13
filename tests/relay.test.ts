/**
 * Relay tests (S21-v3-6) — the coil-driven SPDT. The coil is a resistor whose
 * solved voltage is checked against the pull-in / drop-out thresholds (with
 * hysteresis); the contacts short common to normally_open when energized and to
 * normally_closed at rest. The coil circuit and the contact circuit are
 * isolated — the coil's voltage decides the contact state, the reversible cousin
 * of the fuse's blow.
 */

import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import { relayCoilTargets } from '../src/failure-detector.ts'
import { solveWithRelays } from '../src/relay.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { solveTransient } from '../src/transient-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

/**
 * A 5 V control coil + a 9 V contact circuit (NO → 100 Ω, NC → 200 Ω), isolated
 * but sharing the ground reference. `coilState` is set directly (the canvas loop
 * sets it from the coil voltage; here we drive both halves independently).
 * `coilVolts` lets a test starve the coil to exercise the release threshold.
 */
function relayRig(coilState: 'energized' | 'de_energized', coilVolts = 5) {
  const nodes: CanvasNode[] = [
    {
      id: 'ctrl',
      definition: 'power_source',
      parameters: {
        nominal_voltage: scalar(coilVolts, 'volt'),
        internal_resistance: scalar(0, 'ohm'),
      },
    },
    {
      id: 'load',
      definition: 'power_source',
      parameters: { nominal_voltage: scalar(9, 'volt'), internal_resistance: scalar(0, 'ohm') },
    },
    {
      id: 'rly',
      definition: 'relay',
      parameters: {
        coil_resistance: scalar(100, 'ohm'),
        pull_in_voltage: scalar(3.75, 'volt'),
        drop_out_voltage: scalar(0.5, 'volt'),
        coil_state: { value: coilState },
      },
    },
    { id: 'rno', definition: 'resistor', parameters: { resistance: scalar(100, 'ohm') } },
    { id: 'rnc', definition: 'resistor', parameters: { resistance: scalar(200, 'ohm') } },
    { id: 'gnd', definition: 'ground' },
  ]
  const edges = [
    // Control side: 5 V across the coil.
    { source: 'ctrl', sourceHandle: 'terminal_positive', target: 'rly', targetHandle: 'coil_a' },
    { source: 'rly', sourceHandle: 'coil_b', target: 'ctrl', targetHandle: 'terminal_negative' },
    // Contact side: 9 V into common; NO → 100 Ω, NC → 200 Ω, both back to load−.
    { source: 'load', sourceHandle: 'terminal_positive', target: 'rly', targetHandle: 'common' },
    { source: 'rly', sourceHandle: 'normally_open', target: 'rno', targetHandle: 'terminal_a' },
    {
      source: 'rno',
      sourceHandle: 'terminal_b',
      target: 'load',
      targetHandle: 'terminal_negative',
    },
    { source: 'rly', sourceHandle: 'normally_closed', target: 'rnc', targetHandle: 'terminal_a' },
    {
      source: 'rnc',
      sourceHandle: 'terminal_b',
      target: 'load',
      targetHandle: 'terminal_negative',
    },
    {
      source: 'gnd',
      sourceHandle: 'reference_terminal',
      target: 'ctrl',
      targetHandle: 'terminal_negative',
    },
  ]
  return canvasToWorld(nodes, edges)
}

describe('the contacts route by the coil state', () => {
  test('energized: common → normally_open (the 100 Ω carries 90 mA, the 200 Ω is dead)', () => {
    const solution = solveDC(relayRig('energized'))
    expect(solution.status).toBe('solved')
    expect(Math.abs(solution.branches.get('rno') ?? 0)).toBeCloseTo(0.09, 6) // 9 V / 100 Ω
    expect(Math.abs(solution.branches.get('rnc') ?? 1)).toBeLessThan(1e-9) // NC open
  })

  test('de-energized: common → normally_closed (the 200 Ω carries 45 mA, the 100 Ω is dead)', () => {
    const solution = solveDC(relayRig('de_energized'))
    expect(solution.status).toBe('solved')
    expect(Math.abs(solution.branches.get('rnc') ?? 0)).toBeCloseTo(0.045, 6) // 9 V / 200 Ω
    expect(Math.abs(solution.branches.get('rno') ?? 1)).toBeLessThan(1e-9) // NO open
  })

  test('the relay’s reported branch current is the coil current (5 V / 100 Ω = 50 mA)', () => {
    const solution = solveDC(relayRig('de_energized'))
    expect(Math.abs(solution.branches.get('rly') ?? 0)).toBeCloseTo(0.05, 6)
  })
})

describe('relayCoilTargets decides energization from the coil voltage', () => {
  test('a de-energized relay with 5 V on its coil should pull in', () => {
    const world = relayRig('de_energized', 5)
    expect(relayCoilTargets(world, solveDC(world)).get('rly')).toBe('energized')
  })

  test('an energized relay holds through the hysteresis band (1 V: below pull-in, above drop-out)', () => {
    // 1 V coil: under the 3.75 V pull-in but over the 0.5 V drop-out → stays put.
    const world = relayRig('energized', 1)
    expect(relayCoilTargets(world, solveDC(world)).has('rly')).toBe(false)
  })

  test('an energized relay releases once the coil falls below drop-out (0.3 V)', () => {
    const world = relayRig('energized', 0.3)
    expect(relayCoilTargets(world, solveDC(world)).get('rly')).toBe('de_energized')
  })

  test('a de-energized relay in the band stays de-energized (no premature pull-in)', () => {
    const world = relayRig('de_energized', 1)
    expect(relayCoilTargets(world, solveDC(world)).has('rly')).toBe(false)
  })
})

describe('solveWithRelays resolves the contacts to a self-consistent state', () => {
  test('a relay starting at rest with 5 V on its coil settles ENERGIZED and switches the load to NO', () => {
    const result = solveWithRelays(relayRig('de_energized', 5))
    expect(result.relaysSettled).toBe(true)
    expect(result.relayStates.get('rly')).toBe('energized')
    expect(Math.abs(result.solution.branches.get('rno') ?? 0)).toBeCloseTo(0.09, 6)
    expect(Math.abs(result.solution.branches.get('rnc') ?? 1)).toBeLessThan(1e-9)
  })

  test('a relay with too little coil voltage stays at rest (load stays on NC)', () => {
    const result = solveWithRelays(relayRig('de_energized', 2)) // 2 V < 3.75 V pull-in
    expect(result.relaysSettled).toBe(true)
    expect(result.relayStates.get('rly')).toBe('de_energized')
    expect(Math.abs(result.solution.branches.get('rnc') ?? 0)).toBeCloseTo(0.045, 6)
  })
})

/** A relay whose coil is powered THROUGH its own normally-closed contact — the
 *  buzzer: closing the contact energizes it, which opens the contact, which
 *  de-energizes it, forever. No steady state. */
function buzzerRig() {
  const nodes: CanvasNode[] = [
    {
      id: 'src',
      definition: 'power_source',
      parameters: { nominal_voltage: scalar(5, 'volt'), internal_resistance: scalar(0, 'ohm') },
    },
    {
      id: 'rly',
      definition: 'relay',
      parameters: {
        coil_resistance: scalar(100, 'ohm'),
        pull_in_voltage: scalar(3.75, 'volt'),
        drop_out_voltage: scalar(0.5, 'volt'),
        coil_state: { value: 'de_energized' },
      },
    },
    // A 1 Ω link routes the NC contact to the coil (a real wire, not a self-edge).
    { id: 'link', definition: 'resistor', parameters: { resistance: scalar(1, 'ohm') } },
    { id: 'gnd', definition: 'ground' },
  ]
  const edges = [
    { source: 'src', sourceHandle: 'terminal_positive', target: 'rly', targetHandle: 'common' },
    // the NC contact feeds the coil (through the link)
    { source: 'rly', sourceHandle: 'normally_closed', target: 'link', targetHandle: 'terminal_a' },
    { source: 'link', sourceHandle: 'terminal_b', target: 'rly', targetHandle: 'coil_a' },
    { source: 'rly', sourceHandle: 'coil_b', target: 'src', targetHandle: 'terminal_negative' },
    {
      source: 'gnd',
      sourceHandle: 'reference_terminal',
      target: 'src',
      targetHandle: 'terminal_negative',
    },
  ]
  return canvasToWorld(nodes, edges)
}

describe('a coil powered through its own contact cannot settle (buzzer)', () => {
  test('solveWithRelays terminates and reports relaysSettled false', () => {
    const result = solveWithRelays(buzzerRig())
    expect(result.relaysSettled).toBe(false)
  })
})

describe('the transient engine agrees on contact routing', () => {
  const last = (world: ReturnType<typeof canvasToWorld>) => {
    const r = solveTransient(world, { timeStep: 1e-4, duration: 1e-3 })
    return r.series[r.series.length - 1]
  }
  test('energized routes the NO load, de-energized routes the NC load', () => {
    expect(Math.abs(last(relayRig('energized'))?.currents?.get('rno/terminal_a') ?? 0)).toBeCloseTo(
      0.09,
      5,
    )
    expect(
      Math.abs(last(relayRig('de_energized'))?.currents?.get('rnc/terminal_a') ?? 0),
    ).toBeCloseTo(0.045, 5)
  })
})

/**
 * Switch family tests (S21-v3-2) — the momentary push button and the SPDT
 * selector, solved from the same 0 Ω-short machinery as the SPST toggle.
 * The push button is normally open (no current until pressed); the SPDT
 * routes the loop current to whichever throw is selected and leaves the other
 * an open contact.
 */

import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { solveTransient } from '../src/transient-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

/** 9 V (ideal) → push button → 100 Ω → back. */
function buttonLoop(state: 'open' | 'closed') {
  const nodes: CanvasNode[] = [
    {
      id: 'src',
      definition: 'power_source',
      parameters: { nominal_voltage: scalar(9, 'volt'), internal_resistance: scalar(0, 'ohm') },
    },
    {
      id: 'btn',
      definition: 'switch_spst_momentary',
      parameters: { state: { value: state } },
    },
    { id: 'r', definition: 'resistor', parameters: { resistance: scalar(100, 'ohm') } },
    { id: 'gnd', definition: 'ground' },
  ]
  const edges = [
    {
      source: 'src',
      sourceHandle: 'terminal_positive',
      target: 'btn',
      targetHandle: 'terminal_in',
    },
    { source: 'btn', sourceHandle: 'terminal_out', target: 'r', targetHandle: 'terminal_a' },
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

describe('the momentary push button (normally open)', () => {
  test('unpressed (default open) → an open circuit, no current flows', () => {
    const solution = solveDC(buttonLoop('open'))
    expect(solution.status).toBe('solved')
    expect(Math.abs(solution.branches.get('r') ?? 1)).toBeLessThan(1e-9)
  })

  test('pressed (closed) → it conducts like an ideal short: I = 9 V / 100 Ω', () => {
    const solution = solveDC(buttonLoop('closed'))
    expect(solution.status).toBe('solved')
    expect(Math.abs(solution.branches.get('r') ?? 0)).toBeCloseTo(0.09, 6)
  })

  test('the transient engine agrees: open carries nothing, closed carries 90 mA', () => {
    const open = solveTransient(buttonLoop('open'), { timeStep: 1e-4, duration: 1e-3 })
    const closed = solveTransient(buttonLoop('closed'), { timeStep: 1e-4, duration: 1e-3 })
    const lastOpen = open.series[open.series.length - 1]
    const lastClosed = closed.series[closed.series.length - 1]
    expect(Math.abs(lastOpen?.currents?.get('r/terminal_a') ?? 1)).toBeLessThan(1e-9)
    expect(Math.abs(lastClosed?.currents?.get('r/terminal_a') ?? 0)).toBeCloseTo(0.09, 5)
  })
})

/**
 * 9 V → SPDT common; throw_a → 100 Ω → ground, throw_b → 200 Ω → ground;
 * source return on ground. The selected throw carries the whole loop; the
 * other resistor sees nothing.
 */
function spdtRig(position: 'throw_a' | 'throw_b') {
  const nodes: CanvasNode[] = [
    {
      id: 'src',
      definition: 'power_source',
      parameters: { nominal_voltage: scalar(9, 'volt'), internal_resistance: scalar(0, 'ohm') },
    },
    {
      id: 'sw',
      definition: 'switch_spdt',
      parameters: { position: { value: position } },
    },
    { id: 'ra', definition: 'resistor', parameters: { resistance: scalar(100, 'ohm') } },
    { id: 'rb', definition: 'resistor', parameters: { resistance: scalar(200, 'ohm') } },
    { id: 'gnd', definition: 'ground' },
  ]
  const edges = [
    { source: 'src', sourceHandle: 'terminal_positive', target: 'sw', targetHandle: 'common' },
    { source: 'sw', sourceHandle: 'throw_a', target: 'ra', targetHandle: 'terminal_a' },
    { source: 'sw', sourceHandle: 'throw_b', target: 'rb', targetHandle: 'terminal_a' },
    { source: 'ra', sourceHandle: 'terminal_b', target: 'src', targetHandle: 'terminal_negative' },
    { source: 'rb', sourceHandle: 'terminal_b', target: 'src', targetHandle: 'terminal_negative' },
    {
      source: 'gnd',
      sourceHandle: 'reference_terminal',
      target: 'src',
      targetHandle: 'terminal_negative',
    },
  ]
  return canvasToWorld(nodes, edges)
}

describe('the SPDT selector', () => {
  test('throw A: the loop runs through the 100 Ω; the 200 Ω on throw B is dead', () => {
    const solution = solveDC(spdtRig('throw_a'))
    expect(solution.status).toBe('solved')
    expect(Math.abs(solution.branches.get('ra') ?? 0)).toBeCloseTo(0.09, 6) // 9 V / 100 Ω
    expect(Math.abs(solution.branches.get('rb') ?? 1)).toBeLessThan(1e-9) // open throw
  })

  test('throw B: the loop moves to the 200 Ω; the 100 Ω on throw A is now dead', () => {
    const solution = solveDC(spdtRig('throw_b'))
    expect(solution.status).toBe('solved')
    expect(Math.abs(solution.branches.get('rb') ?? 0)).toBeCloseTo(0.045, 6) // 9 V / 200 Ω
    expect(Math.abs(solution.branches.get('ra') ?? 1)).toBeLessThan(1e-9) // open throw
  })

  test('break-before-make: exactly one throw ever carries current', () => {
    for (const position of ['throw_a', 'throw_b'] as const) {
      const solution = solveDC(spdtRig(position))
      const ia = Math.abs(solution.branches.get('ra') ?? 0)
      const ib = Math.abs(solution.branches.get('rb') ?? 0)
      // One carries the loop, the other is open — never both.
      expect(Math.min(ia, ib)).toBeLessThan(1e-9)
      expect(Math.max(ia, ib)).toBeGreaterThan(1e-3)
    }
  })

  // An SPDT is routinely used as a plain on/off: common + ONE throw, the other
  // throw left open (only 2 of its 3 terminals wired). It must still conduct in
  // the position that touches the wired throw — the same independent-stamping
  // the relay's contacts use.
  const twoWireSpdt = (position: 'throw_a' | 'throw_b') =>
    canvasToWorld(
      [
        {
          id: 'src',
          definition: 'power_source',
          parameters: { nominal_voltage: scalar(9, 'volt'), internal_resistance: scalar(0, 'ohm') },
        },
        { id: 'sw', definition: 'switch_spdt', parameters: { position: { value: position } } },
        { id: 'ra', definition: 'resistor', parameters: { resistance: scalar(100, 'ohm') } },
        { id: 'gnd', definition: 'ground' },
      ],
      [
        { source: 'src', sourceHandle: 'terminal_positive', target: 'sw', targetHandle: 'common' },
        // only throw_a is wired; throw_b is left open.
        { source: 'sw', sourceHandle: 'throw_a', target: 'ra', targetHandle: 'terminal_a' },
        {
          source: 'ra',
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
      ],
    )

  test('a 2-wire SPDT (one throw unused) still conducts on its wired throw', () => {
    // Position A touches the wired throw → 9 V / 100 Ω flows.
    expect(Math.abs(solveDC(twoWireSpdt('throw_a')).branches.get('ra') ?? 0)).toBeCloseTo(0.09, 6)
    // Position B selects the UNWIRED throw → open, no current.
    expect(Math.abs(solveDC(twoWireSpdt('throw_b')).branches.get('ra') ?? 1)).toBeLessThan(1e-9)
  })

  test('the default position (absent param) is throw A', () => {
    const world = canvasToWorld(
      [
        {
          id: 'src',
          definition: 'power_source',
          parameters: { nominal_voltage: scalar(9, 'volt'), internal_resistance: scalar(0, 'ohm') },
        },
        { id: 'sw', definition: 'switch_spdt', parameters: {} },
        { id: 'ra', definition: 'resistor', parameters: { resistance: scalar(100, 'ohm') } },
        { id: 'rb', definition: 'resistor', parameters: { resistance: scalar(200, 'ohm') } },
        { id: 'gnd', definition: 'ground' },
      ],
      [
        { source: 'src', sourceHandle: 'terminal_positive', target: 'sw', targetHandle: 'common' },
        { source: 'sw', sourceHandle: 'throw_a', target: 'ra', targetHandle: 'terminal_a' },
        { source: 'sw', sourceHandle: 'throw_b', target: 'rb', targetHandle: 'terminal_a' },
        {
          source: 'ra',
          sourceHandle: 'terminal_b',
          target: 'src',
          targetHandle: 'terminal_negative',
        },
        {
          source: 'rb',
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
      ],
    )
    const solution = solveDC(world)
    expect(Math.abs(solution.branches.get('ra') ?? 0)).toBeCloseTo(0.09, 6)
    expect(Math.abs(solution.branches.get('rb') ?? 1)).toBeLessThan(1e-9)
  })
})

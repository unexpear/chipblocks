/**
 * Scope window heuristic tests (S19-v3-45) — the auto-picked simulated window for
 * the canvas Scope. A display choice, not physics: 3 periods of the slowest AC
 * source; else 5× the largest R·C; else a 1 ms flat default. Always 500 steps.
 */

import { describe, expect, test } from 'vitest'
import type { World } from '../src/cross-fk-validator.ts'
import { scopeWindow } from '../src/renderer/scope.tsx'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

function worldWith(
  instances: Array<{ id: string; definition: string; parameters: object }>,
): World {
  const world: World = {
    definitions: new Map(),
    instances: new Map(),
    behaviors: new Map(),
    activeVariables: new Map(),
    nets: new Map(),
  }
  for (const inst of instances) {
    world.instances.set(inst.id, {
      id: inst.id,
      kind_ref: 'primitive_device',
      definition: inst.definition,
      parameters: inst.parameters,
      // biome-ignore lint/suspicious/noExplicitAny: minimal test fixture
    } as any)
  }
  return world
}

describe('scopeWindow', () => {
  test('an AC source sets the window to 3 periods of the slowest source', () => {
    const world = worldWith([
      {
        id: 'src',
        definition: 'power_source',
        parameters: {
          nominal_voltage: scalar(0, 'volt'),
          ac_amplitude: scalar(5, 'volt'),
          frequency: scalar(1000, 'hertz'),
        },
      },
    ])
    const win = scopeWindow(world)
    expect(win.duration).toBeCloseTo(3 / 1000, 9)
    expect(win.timeStep).toBeCloseTo(win.duration / 500, 12)
  })

  test('an R-C circuit sets the window to 5× the largest R·C (the charge curve fits)', () => {
    const world = worldWith([
      {
        id: 'bat',
        definition: 'power_source',
        parameters: { nominal_voltage: scalar(9, 'volt') },
      },
      { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(470, 'ohm') } },
      { id: 'c1', definition: 'capacitor', parameters: { capacitance: scalar(100e-6, 'farad') } },
    ])
    const win = scopeWindow(world)
    expect(win.duration).toBeCloseTo(5 * 470 * 100e-6, 9) // 235 ms
  })

  test('a purely resistive circuit falls back to a 1 ms window (settles instantly)', () => {
    const world = worldWith([
      { id: 'bat', definition: 'power_source', parameters: { nominal_voltage: scalar(9, 'volt') } },
      { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(470, 'ohm') } },
    ])
    expect(scopeWindow(world).duration).toBeCloseTo(1e-3, 9)
  })

  test('an R-L circuit sets the window to 5× L/R (the current ramp fits)', () => {
    const world = worldWith([
      { id: 'bat', definition: 'power_source', parameters: { nominal_voltage: scalar(5, 'volt') } },
      { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(100, 'ohm') } },
      { id: 'l1', definition: 'inductor', parameters: { inductance: scalar(0.01, 'henry') } },
    ])
    expect(scopeWindow(world).duration).toBeCloseTo(5 * (0.01 / 100), 9) // 0.5 ms
  })

  test('an R-L circuit windows on the SMALLEST resistor — the slow ramp is not truncated', () => {
    // L = 10 mH. The inductor's loop can settle as slowly as τ = L/1 Ω = 10 ms; a large
    // 10 kΩ elsewhere must NOT shrink the window 10000× (5 µs would cut the ramp off
    // mid-rise). The window follows the slowest L/R — erring long is honest, truncating isn't.
    const world = worldWith([
      { id: 'bat', definition: 'power_source', parameters: { nominal_voltage: scalar(5, 'volt') } },
      { id: 'r_small', definition: 'resistor', parameters: { resistance: scalar(1, 'ohm') } },
      { id: 'r_big', definition: 'resistor', parameters: { resistance: scalar(10000, 'ohm') } },
      { id: 'l1', definition: 'inductor', parameters: { inductance: scalar(0.01, 'henry') } },
    ])
    expect(scopeWindow(world).duration).toBeCloseTo(5 * (0.01 / 1), 9) // 50 ms, on the 1 Ω
  })

  test('with both C and L present the slower timescale wins (everything fits)', () => {
    const world = worldWith([
      { id: 'bat', definition: 'power_source', parameters: { nominal_voltage: scalar(9, 'volt') } },
      { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(470, 'ohm') } },
      { id: 'c1', definition: 'capacitor', parameters: { capacitance: scalar(100e-6, 'farad') } },
      { id: 'l1', definition: 'inductor', parameters: { inductance: scalar(0.01, 'henry') } },
    ])
    // τ_RC = 47 ms ≫ τ_RL = 21 µs → the R·C window wins.
    expect(scopeWindow(world).duration).toBeCloseTo(5 * 470 * 100e-6, 9)
  })

  test('AC wins over R·C when both exist (the waveform is the thing to watch)', () => {
    const world = worldWith([
      {
        id: 'src',
        definition: 'power_source',
        parameters: {
          nominal_voltage: scalar(0, 'volt'),
          ac_amplitude: scalar(5, 'volt'),
          frequency: scalar(50, 'hertz'),
        },
      },
      { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(1000, 'ohm') } },
      { id: 'c1', definition: 'capacitor', parameters: { capacitance: scalar(1e-6, 'farad') } },
    ])
    expect(scopeWindow(world).duration).toBeCloseTo(3 / 50, 9)
  })
})

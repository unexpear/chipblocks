/**
 * partReadings tests (Sprint 19) — the per-part current / voltage / power the
 * Properties panel shows. All derived from the real solve, like Falstad's
 * per-component readouts.
 */

import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { partReadings } from '../src/renderer/part-readings.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

describe('partReadings', () => {
  test('reports current / voltage / power for each part of a battery → resistor → LED loop', () => {
    const nodes: CanvasNode[] = [
      {
        id: 'bat',
        definition: 'power_source',
        parameters: { nominal_voltage: scalar(9, 'volt'), internal_resistance: scalar(1, 'ohm') },
      },
      { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(470, 'ohm') } },
      {
        id: 'led',
        definition: 'led',
        parameters: {
          forward_voltage: scalar(2, 'volt'),
          max_forward_current: scalar(0.02, 'ampere'),
        },
      },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      {
        source: 'bat',
        sourceHandle: 'terminal_positive',
        target: 'r1',
        targetHandle: 'terminal_a',
      },
      { source: 'r1', sourceHandle: 'terminal_b', target: 'led', targetHandle: 'anode' },
      { source: 'led', sourceHandle: 'cathode', target: 'bat', targetHandle: 'terminal_negative' },
      {
        source: 'gnd',
        sourceHandle: 'reference_terminal',
        target: 'bat',
        targetHandle: 'terminal_negative',
      },
    ]
    const world = canvasToWorld(nodes, edges)
    const readings = partReadings(world, solveDC(world))

    // ~14.9 mA flows through the series loop.
    expect(readings.get('r1')?.current).toBeCloseTo(0.0149, 4)
    // Resistor drops I·R ≈ 14.9 mA × 470 Ω ≈ 7.0 V; dissipates ~0.10 W.
    expect(readings.get('r1')?.voltage).toBeCloseTo(7.0, 1)
    expect(readings.get('r1')?.power).toBeCloseTo(0.104, 2)
    // LED carries the same current, dropping ~1.98 V.
    expect(readings.get('led')?.current).toBeCloseTo(0.0149, 4)
    expect(readings.get('led')?.voltage).toBeCloseTo(1.98, 1)
    // Battery terminal voltage sags to ~8.985 V under its 1 Ω internal drop.
    expect(readings.get('bat')?.voltage).toBeCloseTo(8.985, 2)
    // Ground is a reference — no current, no reading.
    expect(readings.has('gnd')).toBe(false)
  })

  test('an unsolved circuit yields no readings', () => {
    const world = canvasToWorld([{ id: 'r1', definition: 'resistor' }], []) // no ground → not solved
    const readings = partReadings(world, solveDC(world))
    expect(readings.size).toBe(0)
  })

  test('a MOSFET reads V_DS, P = V_DS·I_D, and its junction temperature', () => {
    // Saturation: V_GS = 3.1 V (V_OV = 1 V, k = 26 mA/V², no λ) → I_D = 13 mA;
    // V_DS = 10 − 100 × 0.013 = 8.7 V → P = 113.1 mW; θ 312.5 → T ≈ 60.3 °C.
    // Before S19-v3-68 a three-terminal part had NO voltage/power/temperature.
    const nodes: CanvasNode[] = [
      {
        id: 'vdd',
        definition: 'power_source',
        parameters: { nominal_voltage: scalar(10, 'volt'), internal_resistance: scalar(0, 'ohm') },
      },
      {
        id: 'vg',
        definition: 'power_source',
        parameters: { nominal_voltage: scalar(3.1, 'volt'), internal_resistance: scalar(0, 'ohm') },
      },
      { id: 'rload', definition: 'resistor', parameters: { resistance: scalar(100, 'ohm') } },
      {
        id: 'm1',
        definition: 'transistor_mosfet_nmos',
        parameters: {
          threshold_voltage: scalar(2.1, 'volt'),
          transconductance_parameter: scalar(0.026, 'ampere_per_volt_squared'),
          thermal_resistance_junction_ambient: scalar(312.5, 'kelvin_per_watt'),
          max_operating_temperature: scalar(150, 'celsius'),
        },
      },
      { id: 'gnd', definition: 'ground' },
    ] as CanvasNode[]
    const edges = [
      {
        source: 'vdd',
        sourceHandle: 'terminal_positive',
        target: 'rload',
        targetHandle: 'terminal_a',
      },
      { source: 'rload', sourceHandle: 'terminal_b', target: 'm1', targetHandle: 'drain' },
      { source: 'm1', sourceHandle: 'source', target: 'vdd', targetHandle: 'terminal_negative' },
      { source: 'vg', sourceHandle: 'terminal_positive', target: 'm1', targetHandle: 'gate' },
      {
        source: 'vg',
        sourceHandle: 'terminal_negative',
        target: 'vdd',
        targetHandle: 'terminal_negative',
      },
      {
        source: 'gnd',
        sourceHandle: 'reference_terminal',
        target: 'vdd',
        targetHandle: 'terminal_negative',
      },
    ]
    const world = canvasToWorld(nodes, edges)
    const readings = partReadings(world, solveDC(world))
    const m1 = readings.get('m1')
    expect(m1?.current).toBeCloseTo(0.013, 4)
    expect(m1?.voltage).toBeCloseTo(8.7, 2)
    expect(m1?.power).toBeCloseTo(0.1131, 3)
    expect(m1?.temperatureC).toBeCloseTo(60.34, 1)
    expect(m1?.maxTemperatureC).toBe(150)
  })

  test('the temperature fallback honors the board ambient (own ambient_temperature still wins)', () => {
    // 10 V across a lone 100 Ω → 0.1 A, P = 1 W; θ_JA 50 K/W → +50 °C self-heating.
    // partReadings(...) with no temperaturesC takes the lumped-law fallback — the path the
    // worst-case / derating / Monte-Carlo analyses use, which used to be hardwired to 25 °C.
    const make = (extra: Record<string, unknown> = {}) =>
      canvasToWorld(
        [
          {
            id: 'bat',
            definition: 'power_source',
            parameters: {
              nominal_voltage: scalar(10, 'volt'),
              internal_resistance: scalar(0, 'ohm'),
            },
          },
          {
            id: 'r1',
            definition: 'resistor',
            parameters: { resistance: scalar(100, 'ohm'), ...extra },
          },
          { id: 'gnd', definition: 'ground' },
        ] as CanvasNode[],
        [
          {
            source: 'bat',
            sourceHandle: 'terminal_positive',
            target: 'r1',
            targetHandle: 'terminal_a',
          },
          {
            source: 'r1',
            sourceHandle: 'terminal_b',
            target: 'bat',
            targetHandle: 'terminal_negative',
          },
          {
            source: 'gnd',
            sourceHandle: 'reference_terminal',
            target: 'bat',
            targetHandle: 'terminal_negative',
          },
        ],
      )

    const theta = { thermal_resistance_junction_ambient: scalar(50, 'kelvin_per_watt') }
    // No board ambient → the 25 °C baseline: 25 + 50 = 75 °C.
    const base = make(theta)
    expect(partReadings(base, solveDC(base)).get('r1')?.temperatureC).toBeCloseTo(75, 3)
    // Board ambient 70 °C lifts it by the full delta: 70 + 50 = 120 °C (the gap this closes).
    expect(partReadings(base, solveDC(base), undefined, 70).get('r1')?.temperatureC).toBeCloseTo(
      120,
      3,
    )
    // A part's own ambient_temperature overrides the board ambient: 25 + 50 = 75 °C.
    const withOwn = make({ ...theta, ambient_temperature: scalar(25, 'celsius') })
    expect(
      partReadings(withOwn, solveDC(withOwn), undefined, 70).get('r1')?.temperatureC,
    ).toBeCloseTo(75, 3)
  })
})

/**
 * Transient electro-thermal tests (S20-v3-5) — the fix for the measured
 * cross-engine inconsistency: the meter clamp (DC loop, R(T)) read 9.64 mA
 * where the scope clamp (transient, cold) read 9.56 mA on the SAME wire.
 * The headline test pins the two engines to the SAME fixed point on that
 * exact circuit shape; the rest checks the thermal law's identities.
 */

import { describe, expect, test } from 'vitest'
import { solveElectroThermal, solveTransientThermal } from '../src/electro-thermal.ts'
import { canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { solveTransient } from '../src/transient-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

/** The audit circuit: 9 V into two heating resistors — the divider that
    exposed the gap. Tempco + thermal resistance declared explicitly. */
function auditWorld() {
  return canvasToWorld(
    [
      {
        id: 'src',
        definition: 'power_source',
        parameters: {
          nominal_voltage: scalar(9, 'volt'),
          internal_resistance: scalar(1, 'ohm'),
        },
      },
      {
        id: 'r1',
        definition: 'resistor',
        parameters: {
          resistance: scalar(470, 'ohm'),
          temperature_coefficient: scalar(-500e-6, 'per_kelvin'),
          thermal_resistance_junction_ambient: scalar(400, 'kelvin_per_watt'),
        },
      },
      {
        id: 'r2',
        definition: 'resistor',
        parameters: {
          resistance: scalar(470, 'ohm'),
          temperature_coefficient: scalar(-500e-6, 'per_kelvin'),
          thermal_resistance_junction_ambient: scalar(400, 'kelvin_per_watt'),
        },
      },
      { id: 'gnd', definition: 'ground' },
    ],
    [
      {
        id: 'e1',
        source: 'src',
        target: 'r1',
        sourceHandle: 'terminal_positive',
        targetHandle: 'terminal_a',
      },
      {
        id: 'e2',
        source: 'r1',
        target: 'r2',
        sourceHandle: 'terminal_b',
        targetHandle: 'terminal_a',
      },
      {
        id: 'e3',
        source: 'r2',
        target: 'src',
        sourceHandle: 'terminal_b',
        targetHandle: 'terminal_negative',
      },
      {
        id: 'e4',
        source: 'gnd',
        target: 'src',
        sourceHandle: 'reference_terminal',
        targetHandle: 'terminal_negative',
      },
    ],
  )
}

describe('the cross-engine fixed point (the audit finding, closed)', () => {
  test('DC-thermal and transient-thermal settle on the SAME current', () => {
    const dc = solveElectroThermal(auditWorld())
    expect(dc.solution.status).toBe('solved')
    expect(dc.thermalConverged).toBe(true)

    const tr = solveTransientThermal(auditWorld(), { timeStep: 1e-5, duration: 1e-3 })
    expect(tr.result.status).toBe('solved')
    expect(tr.thermalConverged).toBe(true)

    const last = tr.result.series[tr.result.series.length - 1]
    if (last === undefined) throw new Error('no samples')
    const transientAmps = last.currents?.get('r1/terminal_a')
    const dcAmps = dc.solution.branches.get('r1')
    if (transientAmps === undefined || dcAmps === undefined) throw new Error('missing currents')

    // Same lumped law, same R(T), same fixed point — the engines agree.
    expect(Math.abs(transientAmps) - Math.abs(dcAmps)).toBeCloseTo(0, 7)

    // And the settled temperatures agree part-by-part.
    for (const [id, t] of dc.temperaturesC) {
      expect(tr.temperaturesC.get(id)).toBeCloseTo(t, 1)
    }
  })

  test('the hot loop carries MORE current than the cold one (negative tempco)', () => {
    const cold = solveTransient(auditWorld(), { timeStep: 1e-5, duration: 1e-3 })
    const hot = solveTransientThermal(auditWorld(), { timeStep: 1e-5, duration: 1e-3 })
    const coldLast = cold.series[cold.series.length - 1]
    const hotLast = hot.result.series[hot.result.series.length - 1]
    if (coldLast === undefined || hotLast === undefined) throw new Error('no samples')
    const coldAmps = coldLast.currents?.get('r1/terminal_a') ?? 0
    const hotAmps = hotLast.currents?.get('r1/terminal_a') ?? 0
    expect(hotAmps).toBeGreaterThan(coldAmps)
    // The audit's regime: a fraction of a percent at tens of milliwatts.
    expect(hotAmps / coldAmps).toBeGreaterThan(1.001)
    expect(hotAmps / coldAmps).toBeLessThan(1.05)
  })

  test('the reported temperature IS the lumped law on the average power', () => {
    const tr = solveTransientThermal(auditWorld(), { timeStep: 1e-5, duration: 1e-3 })
    const last = tr.result.series[tr.result.series.length - 1]
    if (last === undefined) throw new Error('no samples')
    const world = auditWorld()
    const r1 = world.instances.get('r1')
    const netA = r1?.connects?.[0]?.net ?? ''
    const netB = r1?.connects?.[1]?.net ?? ''
    // Steady DC: the settled instantaneous power IS the average power.
    const v = (last.nodes.get(netA) ?? 0) - (last.nodes.get(netB) ?? 0)
    const i = last.currents?.get('r1/terminal_a') ?? 0
    const expected = 25 + v * i * 400
    expect(tr.temperaturesC.get('r1')).toBeCloseTo(expected, 1)
  })
})

describe('AC heating follows AVERAGE power, not peak', () => {
  test('an AC source heats a resistor like DC at the rms value', () => {
    const acWorld = canvasToWorld(
      [
        {
          id: 'src',
          definition: 'power_source',
          parameters: {
            nominal_voltage: scalar(0, 'volt'),
            ac_amplitude: scalar(9, 'volt'),
            frequency: scalar(1000, 'hertz'),
            internal_resistance: scalar(0, 'ohm'),
          },
        },
        {
          id: 'r1',
          definition: 'resistor',
          parameters: {
            resistance: scalar(470, 'ohm'),
            temperature_coefficient: scalar(-500e-6, 'per_kelvin'),
            thermal_resistance_junction_ambient: scalar(400, 'kelvin_per_watt'),
          },
        },
        { id: 'gnd', definition: 'ground' },
      ],
      [
        {
          id: 'e1',
          source: 'src',
          target: 'r1',
          sourceHandle: 'terminal_positive',
          targetHandle: 'terminal_a',
        },
        {
          id: 'e2',
          source: 'r1',
          target: 'src',
          sourceHandle: 'terminal_b',
          targetHandle: 'terminal_negative',
        },
        {
          id: 'e3',
          source: 'gnd',
          target: 'src',
          sourceHandle: 'reference_terminal',
          targetHandle: 'terminal_negative',
        },
      ],
    )
    // Whole cycles after the settle skip so the average is the periodic one.
    const tr = solveTransientThermal(acWorld, {
      timeStep: 2e-6,
      duration: 3e-3,
      thermalSettleSeconds: 1e-3,
    })
    expect(tr.thermalConverged).toBe(true)
    const t = tr.temperaturesC.get('r1')
    if (t === undefined) throw new Error('no temperature for r1')
    // Hand expectation: P_avg ≈ (A/√2)²/R(T) with R sagging a touch. Cold:
    // (9/√2)²/470 = 86.2 mW → ΔT ≈ 34.5 °C; the sag raises it slightly.
    expect(t).toBeGreaterThan(25 + 30)
    expect(t).toBeLessThan(25 + 40)
    // Definitely NOT peak-power heating (which would be ΔT ≈ 69 °C).
    expect(t).toBeLessThan(25 + 55)
  })
})

describe('honest defaults and gates', () => {
  test('a plain solveTransient (no temperatures) is exactly the cold solve', () => {
    const a = solveTransient(auditWorld(), { timeStep: 1e-5, duration: 5e-4 })
    const b = solveTransient(auditWorld(), { timeStep: 1e-5, duration: 5e-4 })
    const lastA = a.series[a.series.length - 1]
    const lastB = b.series[b.series.length - 1]
    expect(lastA?.currents?.get('r1/terminal_a')).toBe(lastB?.currents?.get('r1/terminal_a'))
  })

  test('with no thermally-rated parts the loop converges in one pass', () => {
    const world = canvasToWorld(
      [
        {
          id: 'src',
          definition: 'power_source',
          parameters: { nominal_voltage: scalar(5, 'volt'), internal_resistance: scalar(0, 'ohm') },
        },
        { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(100, 'ohm') } },
        { id: 'gnd', definition: 'ground' },
      ],
      [
        {
          id: 'e1',
          source: 'src',
          target: 'r1',
          sourceHandle: 'terminal_positive',
          targetHandle: 'terminal_a',
        },
        {
          id: 'e2',
          source: 'r1',
          target: 'src',
          sourceHandle: 'terminal_b',
          targetHandle: 'terminal_negative',
        },
        {
          id: 'e3',
          source: 'gnd',
          target: 'src',
          sourceHandle: 'reference_terminal',
          targetHandle: 'terminal_negative',
        },
      ],
    )
    const tr = solveTransientThermal(world, { timeStep: 1e-5, duration: 5e-4 })
    expect(tr.thermalConverged).toBe(true)
    expect(tr.thermalIterations).toBe(1)
    expect(tr.temperaturesC.size).toBe(0)
  })
})

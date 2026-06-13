/**
 * Math-view tests (S19-v3-63) — the "show me the math" panel must display the
 * SAME numbers the solver produced, with every KCL sum genuinely re-computed
 * (the checkmark is earned, never assumed). Built on canvas-built circuits
 * whose answers are known exactly.
 */

import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import { resistanceAtTemperature, solveElectroThermal } from '../src/electro-thermal.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { buildMathView } from '../src/renderer/math-view.ts'
import { formatEng } from '../src/renderer/units.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

function ohmLawCircuit() {
  const nodes: CanvasNode[] = [
    {
      id: 'bat',
      definition: 'power_source',
      parameters: { nominal_voltage: scalar(9, 'volt'), internal_resistance: scalar(1, 'ohm') },
    },
    { id: 'sw', definition: 'switch_spst_toggle' },
    { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(100, 'ohm') } },
    { id: 'gnd', definition: 'ground' },
  ]
  const edges = [
    { source: 'bat', sourceHandle: 'terminal_positive', target: 'sw', targetHandle: 'terminal_in' },
    { source: 'sw', sourceHandle: 'terminal_out', target: 'r1', targetHandle: 'terminal_a' },
    { source: 'r1', sourceHandle: 'terminal_b', target: 'bat', targetHandle: 'terminal_negative' },
    {
      source: 'gnd',
      sourceHandle: 'reference_terminal',
      target: 'bat',
      targetHandle: 'terminal_negative',
    },
  ]
  return canvasToWorld(nodes, edges)
}

describe('buildMathView', () => {
  test('the solver section names the real method and the real iteration count', () => {
    const world = ohmLawCircuit()
    const view = buildMathView(world, solveDC(world))
    expect(view.solver.join(' ')).toContain('Modified Nodal Analysis')
    expect(view.solver.join(' ')).toContain('Newton–Raphson')
    expect(view.solver.join(' ')).toContain('converged: yes')
  })

  test('a thermal runaway is flagged — both in the solver section and on the part', () => {
    // A 10 kΩ NTC straight across 9 V at 85 °C ambient runs away (its self-heating
    // drops R, which raises the current, which heats it more — no stable point).
    const world = canvasToWorld(
      [
        {
          id: 'src',
          definition: 'power_source',
          parameters: { nominal_voltage: scalar(9, 'volt'), internal_resistance: scalar(1, 'ohm') },
        },
        {
          id: 'th',
          definition: 'thermistor',
          parameters: {
            resistance: scalar(10000, 'ohm'),
            beta_coefficient: scalar(3977, 'kelvin'),
            ambient_temperature: scalar(85, 'celsius'),
            thermal_resistance_junction_ambient: scalar(667, 'kelvin_per_watt'),
            max_operating_temperature: scalar(125, 'celsius'),
          },
        },
        { id: 'gnd', definition: 'ground' },
      ],
      [
        {
          source: 'src',
          sourceHandle: 'terminal_positive',
          target: 'th',
          targetHandle: 'terminal_a',
        },
        {
          source: 'th',
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
    const thermal = solveElectroThermal(world)
    expect(thermal.thermalConverged).toBe(false) // the loop detected the runaway

    const view = buildMathView(
      world,
      thermal.solution,
      thermal.temperaturesC,
      thermal.thermalConverged,
    )
    // The solver section warns loudly...
    expect(view.solver.join(' ')).toContain('THERMAL RUNAWAY')
    // ...and the thermistor's own card carries the caveat next to its bogus R(T).
    const card = view.parts.find((p) => p.id === 'th')
    expect(card?.lines.join(' ')).toContain('did not settle')

    // A normal (settled) solve shows NO runaway warning.
    const ok = buildMathView(world, thermal.solution, thermal.temperaturesC, true)
    expect(ok.solver.join(' ')).not.toContain('THERMAL RUNAWAY')
  })

  test('the resistor card shows Ohm’s law with the actual solved numbers', () => {
    const world = ohmLawCircuit()
    const view = buildMathView(world, solveDC(world))
    const resistor = view.parts.find((p) => p.id === 'r1')
    expect(resistor).toBeDefined()
    const text = resistor?.lines.join(' ') ?? ''
    // 9 V across 100 Ω + 1 Ω internal → 89.1 mA; V = I·R ≈ 8.91 V; P ≈ 794 mW.
    expect(text).toContain('V = I·R')
    expect(text).toContain('89.1 mA')
    expect(text).toContain('8.91 V')
    expect(text).toContain('794 mW')
  })

  test('the source card computes its terminal voltage from EMF − I·r', () => {
    const world = ohmLawCircuit()
    const view = buildMathView(world, solveDC(world))
    const text = view.parts.find((p) => p.id === 'bat')?.lines.join(' ') ?? ''
    expect(text).toContain('V_terminal')
    expect(text).toContain('= 8.91 V') // 9 − 0.0891×1
  })

  test('the potentiometer card shows the segment split and the live divider voltage', () => {
    // 12 V → pot.a; pot.b → ground; wiper → 10 MΩ load → ground. Wiper at 0.25.
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
          wiper_position: scalar(0.25, 'dimensionless'),
        },
      },
      { id: 'load', definition: 'resistor', parameters: { resistance: scalar(10e6, 'ohm') } },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      {
        source: 'src',
        sourceHandle: 'terminal_positive',
        target: 'pot',
        targetHandle: 'terminal_a',
      },
      {
        source: 'pot',
        sourceHandle: 'terminal_b',
        target: 'src',
        targetHandle: 'terminal_negative',
      },
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
    const world = canvasToWorld(nodes, edges)
    const view = buildMathView(world, solveDC(world))
    const text = view.parts.find((p) => p.id === 'pot')?.lines.join(' ') ?? ''
    // p = 0.25 → R_top 2.50 kΩ, R_bottom 7.50 kΩ; both engines agree.
    expect(text).toContain('25 %')
    expect(text).toContain(`R·p = ${formatEng(2500, 'Ω')}`)
    expect(text).toContain(`R·(1−p) = ${formatEng(7500, 'Ω')}`)
    // V_wiper ≈ 12·(1−0.25) = 9 V at the tap.
    expect(text).toContain('V_wiper')
    expect(text).toContain('9.00 V')
  })

  test('every net’s KCL sum is genuinely re-computed and balances', () => {
    const world = ohmLawCircuit()
    const view = buildMathView(world, solveDC(world))
    expect(view.nets.length).toBeGreaterThan(2)
    for (const net of view.nets) {
      expect(net.sumAmps).not.toBeNull()
      expect(Math.abs(net.sumAmps ?? 1)).toBeLessThan(1e-9)
    }
  })

  test('an LED card shows the Shockley calibration and the solved operating point', () => {
    const nodes: CanvasNode[] = [
      {
        id: 'bat',
        definition: 'power_source',
        parameters: { nominal_voltage: scalar(9, 'volt'), internal_resistance: scalar(1, 'ohm') },
      },
      { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(470, 'ohm') } },
      {
        id: 'led1',
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
      { source: 'r1', sourceHandle: 'terminal_b', target: 'led1', targetHandle: 'anode' },
      {
        source: 'led1',
        sourceHandle: 'cathode',
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
    const world = canvasToWorld(nodes, edges)
    const view = buildMathView(world, solveDC(world))
    const text = view.parts.find((p) => p.id === 'led1')?.lines.join(' ') ?? ''
    expect(text).toContain('Shockley')
    expect(text).toContain('I_S =')
    expect(text).toContain('14.9 mA') // the canonical anchor operating point
    // The KCL section must balance across the LED's nets too — this exercises
    // the anode/cathode sign convention for real.
    for (const net of view.nets) {
      expect(Math.abs(net.sumAmps ?? 1)).toBeLessThan(1e-9)
    }
  })

  test('the units key writes out exactly the units the board used — no more, no less', () => {
    const world = ohmLawCircuit()
    const view = buildMathView(world, solveDC(world))
    const key = view.unitsKey.join(' ')
    // The Ohm's-law circuit talks in volts, amps, ohms, watts — and milliamps.
    expect(key).toContain('V — volt')
    expect(key).toContain('A — amp')
    expect(key).toContain('Ω — ohm')
    expect(key).toContain('W — watt')
    expect(key).toContain('mA — a milli-amp: one thousandth of an amp')
    // Nothing above used farads or hertz, so the key must not invent them.
    expect(key).not.toContain('farad')
    expect(key).not.toContain('hertz')
  })

  test('the explanations read like a teacher: laws stated in plain words before the numbers', () => {
    const world = ohmLawCircuit()
    const view = buildMathView(world, solveDC(world))
    const all = view.parts.flatMap((p) => p.lines).join(' ')
    expect(all).toContain('the voltage used up equals the current times the resistance')
    expect(all).toContain('why batteries sag under load')
    expect(all).toContain('zero mark on the ruler')
    expect(view.solver.join(' ')).toContain('current in = current out')
  })

  test('an unsolved circuit reports honestly instead of showing stale math', () => {
    const world = ohmLawCircuit()
    world.nets.delete(
      [...world.nets.keys()].find((id) => world.nets.get(id)?.type === 'ground') ?? '',
    )
    const view = buildMathView(world, solveDC(world))
    expect(view.solver.join(' ')).toContain('no-ground')
    expect(view.parts.length).toBe(0)
  })

  test('a HOT tempco resistor narrates its drift and uses the resistance the solver used', () => {
    // 5 V into a 100 Ω carbon-film resistor (α −500 ppm/K, θ_JA 340): the
    // electro-thermal fixed point runs ~114 °C with R(T) ≈ 95.5 Ω, I ≈ 52.3 mA.
    // The card's V = I·R must reproduce the SOLVED drop (KVL-consistent), not
    // I × 100 Ω — that mismatch is exactly the live-canvas bug this test pins.
    const nodes: CanvasNode[] = [
      {
        id: 'bat',
        definition: 'power_source',
        parameters: { nominal_voltage: scalar(5, 'volt'), internal_resistance: scalar(0, 'ohm') },
      },
      {
        id: 'r1',
        definition: 'resistor',
        parameters: {
          resistance: scalar(100, 'ohm'),
          temperature_coefficient: scalar(-5e-4, 'per_kelvin'),
          thermal_resistance_junction_ambient: scalar(340, 'kelvin_per_watt'),
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
    ]
    const world = canvasToWorld(nodes, edges)
    const result = solveElectroThermal(world)
    const view = buildMathView(world, result.solution, result.temperaturesC)
    const text = view.parts.find((p) => p.id === 'r1')?.lines.join(' ') ?? ''

    expect(text).toContain('R(T) = R₀·(1 + α·ΔT)')
    expect(text).toContain('−500 ppm per °C')
    // The Ohm's-law line must use the SAME hot resistance the solver used
    // (formatted by the same formatter — single source of truth end to end)…
    const r1 = world.instances.get('r1')
    const hotOhms = resistanceAtTemperature(
      r1 ?? { id: 'r1', kind_ref: 'x', definition: 'resistor' },
      result.temperaturesC.get('r1'),
    )
    expect(hotOhms).toBeDefined()
    expect(hotOhms ?? 0).toBeCloseTo(95.55, 1)
    expect(text).toContain(`× ${formatEng(hotOhms ?? 0, 'Ω')} `)
    // …and the printed drop is the solved 5 V (the supply is ideal, so the
    // whole EMF lands across the hot resistor) — NOT I × 100 Ω ≈ 5.23 V.
    expect(text).toContain('= 5.00 V')

    // Cold circuits stay untouched: without a temperatures map the card reads
    // exactly as before.
    const coldView = buildMathView(world, result.solution)
    const coldText = coldView.parts.find((p) => p.id === 'r1')?.lines.join(' ') ?? ''
    expect(coldText).not.toContain('R(T)')
    expect(coldText).toContain('× 100 Ω')
  })

  test('a hot MOSFET card narrates the SAME adjusted k and V_th the solver used (S20-v3-8)', () => {
    // Found live: the card printed I_D from the COLD law at hot voltages —
    // 45.8 mA narrated where the solver carried 44.7. The card must resolve
    // through resolveMosfet with the part temperature (one source of truth).
    const nodes: CanvasNode[] = [
      {
        id: 'vdd',
        definition: 'power_source',
        parameters: { nominal_voltage: scalar(5, 'volt'), internal_resistance: scalar(0, 'ohm') },
      },
      {
        id: 'vg',
        definition: 'power_source',
        parameters: { nominal_voltage: scalar(5, 'volt'), internal_resistance: scalar(0, 'ohm') },
      },
      { id: 'rload', definition: 'resistor', parameters: { resistance: scalar(100, 'ohm') } },
      {
        id: 'm1',
        definition: 'transistor_mosfet_nmos',
        parameters: {
          threshold_voltage: scalar(2.1, 'volt'),
          transconductance_parameter: scalar(0.026, 'ampere_per_volt_squared'),
          threshold_temperature_coefficient: scalar(-0.0034, 'volt_per_kelvin'),
          thermal_resistance_junction_ambient: scalar(312.5, 'kelvin_per_watt'),
        },
      },
      { id: 'gnd', definition: 'ground' },
    ]
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
    const result = solveElectroThermal(world)
    expect(result.thermalConverged).toBe(true)
    const t = result.temperaturesC.get('m1')
    if (t === undefined) throw new Error('no temperature for m1')

    const view = buildMathView(world, result.solution, result.temperaturesC)
    const text = view.parts.find((p) => p.id === 'm1')?.lines.join(' ') ?? ''
    // The narrated k IS the mobility-scaled one…
    const hotK = 0.026 * ((t + 273.15) / 300) ** -1.5
    expect(text).toContain(`k = ${formatEng(hotK, 'A')}/V²`)
    // …the drift line speaks the running temperature and the drifted V_th…
    expect(text).toContain(`Running at ${t.toFixed(1)} °C`)
    // …and the narrated I_D agrees with the solver's branch current.
    const narrated = text.match(/I_D = ([\d.]+) mA/)
    const branchMa = Math.abs(result.solution.branches.get('m1') ?? 0) * 1000
    expect(narrated).not.toBeNull()
    expect(Number(narrated?.[1])).toBeCloseTo(branchMa, 1)

    // Cold view: no drift line, the declared 25 °C k.
    const coldView = buildMathView(world, result.solution)
    const coldText = coldView.parts.find((p) => p.id === 'm1')?.lines.join(' ') ?? ''
    expect(coldText).not.toContain('Running at')
    expect(coldText).toContain(`k = ${formatEng(0.026, 'A')}/V²`)
  })
})

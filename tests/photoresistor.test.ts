/**
 * Photoresistor (LDR) tests (S21-v3-7) — the first rung of the illumination axis.
 * A resistor whose resistance is set by the LIGHT on it, the datasheet power law
 *   R(E) = R₀·(E/E₀)^(−γ)
 * capped at its dark resistance as the light goes to zero. incident_illuminance
 * (lux) is a per-part input — the optical cousin of the thermistor's ambient
 * temperature — so dialing the light drives the resistance, and the circuit.
 */

import { describe, expect, test } from 'vitest'
import type { Instance } from '../src/cross-fk-validator.ts'
import { solveDC } from '../src/dc-solver.ts'
import { ldrResistance } from '../src/light.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { buildMathView } from '../src/renderer/math-view.ts'
import { formatEng } from '../src/renderer/units.ts'
import { solveTransient } from '../src/transient-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

// GL5528 CdS cell defaults: ~12 kΩ at 10 lux, γ ≈ 0.6, ~1 MΩ dark.
const R0 = 12000
const E0 = 10
const GAMMA = 0.6
const DARK = 1e6
/** The power law written out independently, for cross-checking the implementation. */
const lawAt = (e: number) => Math.min(R0 * (e / E0) ** -GAMMA, DARK)

/** A bare LDR instance at a chosen incident illuminance (lux). */
function ldr(lux: number): Instance {
  return {
    id: 'ldr',
    definition: 'photoresistor',
    parameters: {
      reference_resistance: scalar(R0, 'ohm'),
      reference_illuminance: scalar(E0, 'lux'),
      gamma: scalar(GAMMA, 'dimensionless'),
      dark_resistance: scalar(DARK, 'ohm'),
      ambient_illuminance: scalar(lux, 'lux'),
    },
  } as unknown as Instance
}

describe('the LDR power law R(E) = R₀·(E/E₀)^(−γ)', () => {
  test('at the reference illuminance the resistance is exactly R₀', () => {
    expect(ldrResistance(ldr(E0))).toBeCloseTo(R0, 6)
  })

  test('a non-positive γ is rejected — not a valid LDR power law (returns undefined)', () => {
    const ldrG = (g: number): Instance =>
      ({
        id: 'ldr',
        definition: 'photoresistor',
        parameters: {
          reference_resistance: scalar(R0, 'ohm'),
          reference_illuminance: scalar(E0, 'lux'),
          gamma: scalar(g, 'dimensionless'),
          ambient_illuminance: scalar(10, 'lux'),
        },
      }) as unknown as Instance
    expect(ldrResistance(ldrG(0.6))).not.toBeUndefined() // a real LDR resolves
    expect(ldrResistance(ldrG(0))).toBeUndefined() // γ = 0 flattens the response
    expect(ldrResistance(ldrG(-0.5))).toBeUndefined() // γ < 0 inverts it
  })

  test('brighter → lower resistance, matching the law', () => {
    const bright = ldrResistance(ldr(100)) ?? Number.NaN
    expect(bright).toBeCloseTo(lawAt(100), 6)
    expect(bright).toBeLessThan(R0)
    // 12 kΩ·10^−0.6 ≈ 3.01 kΩ at 100 lux (typical indoor light).
    expect(bright).toBeGreaterThan(2900)
    expect(bright).toBeLessThan(3100)
  })

  test('dimmer → higher resistance', () => {
    expect(ldrResistance(ldr(1)) ?? 0).toBeGreaterThan(R0)
  })

  test('in total darkness (0 lux) it sits at its dark resistance', () => {
    expect(ldrResistance(ldr(0))).toBeCloseTo(DARK, 6)
  })

  test('negative/garbage illuminance is treated as dark, not a negative resistance', () => {
    expect(ldrResistance(ldr(-5))).toBeCloseTo(DARK, 6)
  })

  test('the law is capped at the dark resistance as the light approaches zero', () => {
    // 0.0001 lux would give ~1.2e7 Ω by the bare law — clamped to the 1 MΩ dark value.
    expect(ldrResistance(ldr(0.0001))).toBeCloseTo(DARK, 6)
  })

  test('an LDR missing R₀ or γ has no resistance law', () => {
    const bare = { id: 'ldr', definition: 'photoresistor', parameters: {} } as unknown as Instance
    expect(ldrResistance(bare)).toBeUndefined()
  })
})

/** 9 V → LDR → 1 kΩ → ground: a light-sensing divider. The LDR's resistance,
 *  and so the loop current, is set by the light on it. */
function dividerRig(lux: number) {
  const nodes: CanvasNode[] = [
    {
      id: 'src',
      definition: 'power_source',
      parameters: { nominal_voltage: scalar(9, 'volt'), internal_resistance: scalar(0, 'ohm') },
    },
    {
      id: 'ldr',
      definition: 'photoresistor',
      parameters: {
        reference_resistance: scalar(R0, 'ohm'),
        reference_illuminance: scalar(E0, 'lux'),
        gamma: scalar(GAMMA, 'dimensionless'),
        dark_resistance: scalar(DARK, 'ohm'),
        ambient_illuminance: scalar(lux, 'lux'),
      },
    },
    { id: 'rb', definition: 'resistor', parameters: { resistance: scalar(1000, 'ohm') } },
    { id: 'gnd', definition: 'ground' },
  ]
  const edges = [
    { source: 'src', sourceHandle: 'terminal_positive', target: 'ldr', targetHandle: 'terminal_a' },
    { source: 'ldr', sourceHandle: 'terminal_b', target: 'rb', targetHandle: 'terminal_a' },
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

describe('the light on the LDR controls the circuit', () => {
  test('at 100 lux the loop current is 9 V / (R(100) + 1 kΩ)', () => {
    const world = dividerRig(100)
    const solution = solveDC(world)
    expect(solution.status).toBe('solved')
    const expected = 9 / (lawAt(100) + 1000)
    expect(Math.abs(solution.branches.get('ldr') ?? 0)).toBeCloseTo(expected, 6)
  })

  test('brighter light drops the resistance and raises the current; darkness nearly stops it', () => {
    const bright = Math.abs(solveDC(dividerRig(1000)).branches.get('ldr') ?? 0)
    const indoor = Math.abs(solveDC(dividerRig(100)).branches.get('ldr') ?? 0)
    const dark = Math.abs(solveDC(dividerRig(0)).branches.get('ldr') ?? 0)
    expect(bright).toBeGreaterThan(indoor)
    expect(indoor).toBeGreaterThan(dark)
    // Bright (~757 Ω) carries milliamps; dark (1 MΩ) only microamps — a ~500× swing.
    expect(bright).toBeGreaterThan(4e-3)
    expect(dark).toBeLessThan(1e-5)
  })

  test('the default-illuminance (absent param) LDR reads its dark resistance', () => {
    // No ambient or incident light on the instance → the law reads 0 lux → dark.
    const world = canvasToWorld(
      [
        {
          id: 'src',
          definition: 'power_source',
          parameters: { nominal_voltage: scalar(9, 'volt'), internal_resistance: scalar(0, 'ohm') },
        },
        {
          id: 'ldr',
          definition: 'photoresistor',
          parameters: {
            reference_resistance: scalar(R0, 'ohm'),
            gamma: scalar(GAMMA, 'dimensionless'),
            dark_resistance: scalar(DARK, 'ohm'),
          },
        },
        { id: 'rb', definition: 'resistor', parameters: { resistance: scalar(1000, 'ohm') } },
        { id: 'gnd', definition: 'ground' },
      ],
      [
        {
          source: 'src',
          sourceHandle: 'terminal_positive',
          target: 'ldr',
          targetHandle: 'terminal_a',
        },
        { source: 'ldr', sourceHandle: 'terminal_b', target: 'rb', targetHandle: 'terminal_a' },
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
    expect(Math.abs(solveDC(world).branches.get('ldr') ?? 0)).toBeCloseTo(9 / (DARK + 1000), 9)
  })
})

describe('both engines agree on the light-sensing divider', () => {
  test('the transient steady-state current matches the DC solve at 100 lux', () => {
    const world = dividerRig(100)
    const dc = Math.abs(solveDC(world).branches.get('ldr') ?? 0)
    const tr = solveTransient(world, { timeStep: 1e-4, duration: 1e-3 })
    const last = tr.series[tr.series.length - 1]
    expect(Math.abs(last?.currents?.get('ldr/terminal_a') ?? 0)).toBeCloseTo(dc, 6)
  })
})

describe('the Math panel explains the LDR with the real numbers', () => {
  test('the card states the light law and the resistance the solver used', () => {
    const world = dividerRig(100)
    const view = buildMathView(world, solveDC(world))
    const text = view.parts.find((p) => p.id === 'ldr')?.lines.join(' ') ?? ''
    expect(text).toContain('R(E)')
    expect(text).toContain('lx') // the incident illuminance is named
    // The resistance quoted is exactly the one the law produced (≈ 3.0 kΩ at 100 lux).
    expect(text).toContain(formatEng(lawAt(100), 'Ω'))
  })
})

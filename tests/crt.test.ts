/**
 * CRT (cathode-ray tube) tests — the electron gun + electrostatic deflection. The grid bias sets the
 * brightness (full at 0 V, dark at cutoff); the deflection voltage moves the spot in proportion to
 * itself and inversely to the accelerating anode voltage (a stiffer beam deflects less). These cover
 * the brightness law, the deflection law (and its 1/V_anode stiffness + screen-edge clamp), and the
 * live readings from a solve (EHT, beam current, brightness, spot X/Y).
 */

import { describe, expect, test } from 'vitest'
import { deflectionFraction, gridBrightness } from '../src/crt-model.ts'
import { solveDC } from '../src/dc-solver.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { crtSpotTrace, partReadings } from '../src/renderer/part-readings.ts'
import { solveTransient } from '../src/transient-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const g = (s: string, sh: string, t: string, th: string) => ({
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
})

describe('CRT — electron gun brightness + electrostatic deflection', () => {
  test('grid brightness: full at 0 V, dark at cutoff, linear between', () => {
    expect(gridBrightness(0, -50)).toBeCloseTo(1, 6) // 0 V → full beam
    expect(gridBrightness(-50, -50)).toBeCloseTo(0, 6) // at cutoff → blanked
    expect(gridBrightness(-10, -50)).toBeCloseTo(0.8, 6) // partway → 80%
    expect(gridBrightness(-60, -50)).toBe(0) // past cutoff → still dark (clamped)
    expect(gridBrightness(10, -50)).toBe(1) // above 0 → still full (clamped)
  })

  test('deflection is proportional to V, inverse to the anode voltage, clamped at the edge', () => {
    expect(deflectionFraction(50, 0.02, 2000, 2000)).toBeCloseTo(1, 6) // 50 V at the rated 2 kV → edge
    expect(deflectionFraction(25, 0.02, 2000, 2000)).toBeCloseTo(0.5, 6) // half the voltage → half
    expect(deflectionFraction(50, 0.02, 4000, 2000)).toBeCloseTo(0.5, 6) // double the EHT → half the throw
    expect(deflectionFraction(50, 0.02, 0, 2000)).toBe(0) // no accelerating voltage → no beam
    expect(deflectionFraction(1000, 0.02, 2000, 2000)).toBe(1) // way over → clamped at the screen edge
    expect(deflectionFraction(-25, 0.02, 2000, 2000)).toBeCloseTo(-0.5, 6) // the other way
  })
})

describe('CRT — DC solve + live readings', () => {
  test('a powered CRT reports its EHT, beam current, brightness, and the spot position', () => {
    const crtParams = {
      beam_current: scalar(0.0001, 'ampere'),
      grid_bias: scalar(-10, 'volt'),
      grid_cutoff_voltage: scalar(-50, 'volt'),
      deflection_sensitivity: scalar(0.02, '1/volt'),
      rated_anode_voltage: scalar(2000, 'volt'),
    }
    const nodes: CanvasNode[] = [
      {
        id: 'eht',
        definition: 'power_source',
        parameters: {
          nominal_voltage: scalar(2000, 'volt'),
          internal_resistance: scalar(0, 'ohm'),
        },
      },
      {
        id: 'xsrc',
        definition: 'power_source',
        parameters: { nominal_voltage: scalar(25, 'volt') },
      },
      { id: 'crt1', definition: 'crt', parameters: crtParams },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      g('eht', 'terminal_positive', 'crt1', 'anode'),
      g('eht', 'terminal_negative', 'gnd', 'reference_terminal'),
      g('xsrc', 'terminal_positive', 'crt1', 'x_deflect'),
      g('xsrc', 'terminal_negative', 'gnd', 'reference_terminal'),
      g('crt1', 'cathode', 'gnd', 'reference_terminal'),
    ]
    const world = canvasToWorld(nodes, edges)
    const sol = solveDC(world)
    expect(sol.status).toBe('solved')
    const reading = partReadings(world, sol).get('crt1')
    expect(reading?.voltage ?? 0).toBeCloseTo(2000, 0) // the EHT
    expect(reading?.current ?? 0).toBeCloseTo(0.0001 * 0.8, 6) // beam current × 80% brightness
    expect(reading?.brightnessPercent ?? 0).toBeCloseTo(80, 0)
    expect(reading?.spotXPercent ?? 0).toBeCloseTo(50, 0) // 25 V × 0.02 /V at 2 kV → 50% across
    expect(reading?.spotYPercent ?? 99).toBeCloseTo(0, 1) // y undriven → centred
  })
})

describe('CRT — a live trace sweeping over time (transient)', () => {
  test('AC on X and Y sweeps the spot across the whole screen — a real 2-D trace, not a frozen dot', () => {
    // 2 kV EHT; X ← a 100 Hz sine (±40 V), Y ← a 50 Hz sine (±40 V): the spot draws a Lissajous figure.
    // At the rated 2 kV, 0.02 /V × 40 V = ±0.8 of the screen half-width on each axis.
    const crtParams = {
      beam_current: scalar(0.0001, 'ampere'),
      grid_bias: scalar(-10, 'volt'),
      grid_cutoff_voltage: scalar(-50, 'volt'),
      deflection_sensitivity: scalar(0.02, '1/volt'),
      rated_anode_voltage: scalar(2000, 'volt'),
    }
    const sine = (amp: number, freq: number) => ({
      nominal_voltage: scalar(0, 'volt'),
      ac_amplitude: scalar(amp, 'volt'),
      frequency: scalar(freq, 'hertz'),
      internal_resistance: scalar(0, 'ohm'),
    })
    const nodes: CanvasNode[] = [
      {
        id: 'eht',
        definition: 'power_source',
        parameters: {
          nominal_voltage: scalar(2000, 'volt'),
          internal_resistance: scalar(0, 'ohm'),
        },
      },
      { id: 'xsrc', definition: 'power_source', parameters: sine(40, 100) },
      { id: 'ysrc', definition: 'power_source', parameters: sine(40, 50) },
      { id: 'crt1', definition: 'crt', parameters: crtParams },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      g('eht', 'terminal_positive', 'crt1', 'anode'),
      g('eht', 'terminal_negative', 'gnd', 'reference_terminal'),
      g('xsrc', 'terminal_positive', 'crt1', 'x_deflect'),
      g('xsrc', 'terminal_negative', 'gnd', 'reference_terminal'),
      g('ysrc', 'terminal_positive', 'crt1', 'y_deflect'),
      g('ysrc', 'terminal_negative', 'gnd', 'reference_terminal'),
      g('crt1', 'cathode', 'gnd', 'reference_terminal'),
    ]
    const world = canvasToWorld(nodes, edges)
    const result = solveTransient(world, { timeStep: 1e-4, duration: 2e-2 }) // 2 cycles of the X sine
    expect(result.status).toBe('solved')
    const trace = crtSpotTrace(world, 'crt1', result.series)
    expect(trace.points.length).toBeGreaterThan(50) // a sampled curve, not one point
    const xs = trace.points.map((s) => s.x)
    const ys = trace.points.map((s) => s.y)
    expect(Math.max(...xs)).toBeGreaterThan(0.5) // X swings to the right…
    expect(Math.min(...xs)).toBeLessThan(-0.5) // …and the left
    expect(Math.max(...ys)).toBeGreaterThan(0.5) // Y up…
    expect(Math.min(...ys)).toBeLessThan(-0.5) // …and down
    expect(Math.max(...xs.map(Math.abs))).toBeLessThanOrEqual(1) // never off the screen
    expect(trace.brightness).toBeCloseTo(0.8, 2) // (−10 − −50)/50, set by the grid bias
  })
})

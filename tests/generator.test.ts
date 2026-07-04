/**
 * DC generator (dynamo) — the motor's machine run backwards: a prime mover spins it and it
 * makes electricity. Checks the Thevenin behaviour (open-circuit EMF E = k·ω, the terminal
 * voltage drooping under load, the short-circuit current E/R_a), the mechanical power balance +
 * efficiency, the live readings from a DC solve, and that the transient (a fixed-speed dynamo is
 * a constant source) drives a capacitor-charging transient to completion.
 */

import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import { type GeneratorParams, generatorEmf, generatorOperatingPoint } from '../src/motor-model.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { partReadings } from '../src/renderer/part-readings.ts'
import { solveTransient } from '../src/transient-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

const OMEGA = (3000 * 2 * Math.PI) / 60 // 3000 RPM in rad/s
const EMF = 0.04 * OMEGA // E = k·ω ≈ 12.566 V

// The shipped small-dynamo defaults: k 0.04 V·s/rad, R_a 1.5 Ω, 3000 RPM, B 1e-5.
const genParams = (): GeneratorParams => ({
  machineConstant: 0.04,
  armatureResistance: 1.5,
  driveSpeed: OMEGA,
  viscousFriction: 1e-5,
})

const genNode = () => ({
  machine_constant: scalar(0.04, 'V*s/rad'),
  armature_resistance: scalar(1.5, 'ohm'),
  drive_speed: scalar(3000, 'rpm'),
  viscous_friction: scalar(1e-5, 'N*m*s/rad'),
})

const g = (s: string, sh: string, t: string, th: string) => ({
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
})

describe('DC generator — Thevenin model (E = k·ω behind R_a)', () => {
  test('the open-circuit terminal voltage is the generated EMF E = k·ω', () => {
    expect(generatorEmf(genParams())).toBeCloseTo(12.566, 2)
    expect(generatorOperatingPoint(EMF, genParams()).current).toBeCloseTo(0, 6) // no load → no current
  })

  test('the terminal voltage droops under load; the short-circuit current is E/R_a', () => {
    // a 10 Ω load: I = E/(R_a + R_L) = 12.566 / 11.5 ≈ 1.093 A
    const loaded = generatorOperatingPoint((EMF * 10) / 11.5, genParams())
    expect(loaded.current).toBeCloseTo(EMF / 11.5, 4)
    // shorted (V = 0): I = E/R_a = 12.566 / 1.5 ≈ 8.38 A
    expect(generatorOperatingPoint(0, genParams()).current).toBeCloseTo(EMF / 1.5, 4)
  })

  test('power balance: mechanical in = electrical out + copper loss + friction loss', () => {
    const v = (EMF * 10) / 11.5 // terminal voltage with a 10 Ω load
    const op = generatorOperatingPoint(v, genParams())
    const copperLoss = op.current * op.current * 1.5
    const frictionLoss = 1e-5 * OMEGA * OMEGA
    expect(op.mechanicalPowerW).toBeCloseTo(op.electricalPowerW + copperLoss + frictionLoss, 6)
    expect(op.efficiency).toBeGreaterThan(0.78)
    expect(op.efficiency).toBeLessThan(0.85)
  })
})

describe('DC generator — DC solve + live readings', () => {
  const solveLoaded = (loadOhms: number) => {
    const nodes: CanvasNode[] = [
      { id: 'gen1', definition: 'generator', parameters: genNode() },
      { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(loadOhms, 'ohm') } },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      g('gen1', 'terminal_positive', 'r1', 'terminal_a'),
      g('r1', 'terminal_b', 'gnd', 'reference_terminal'),
      g('gen1', 'terminal_negative', 'gnd', 'reference_terminal'),
    ]
    const world = canvasToWorld(nodes, edges)
    const sol = solveDC(world)
    expect(sol.status).toBe('solved')
    return partReadings(world, sol)
  }

  test('a loaded dynamo reports its EMF, delivered current, drooped terminal voltage, speed', () => {
    const reading = solveLoaded(10).get('gen1')
    expect(reading?.generatedEmfV ?? 0).toBeCloseTo(EMF, 3)
    expect(reading?.current ?? 0).toBeCloseTo(EMF / 11.5, 3) // ~1.093 A delivered
    expect(reading?.voltage ?? 0).toBeCloseTo((EMF * 10) / 11.5, 2) // ~10.93 V terminal (drooped below E)
    expect(Math.round(reading?.speedRpm ?? 0)).toBe(3000)
    expect(reading?.efficiencyPercent ?? 0).toBeGreaterThan(78)
    expect(reading?.efficiencyPercent ?? 0).toBeLessThan(85)
  })

  test('a heavier load droops the terminal voltage further and draws more current', () => {
    const light = solveLoaded(100).get('gen1')
    const heavy = solveLoaded(5).get('gen1')
    expect((heavy?.current ?? 0) > (light?.current ?? 0)).toBe(true)
    expect((heavy?.voltage ?? 1e9) < (light?.voltage ?? 0)).toBe(true)
    expect(light?.voltage ?? 0).toBeGreaterThan(12) // 100 Ω » R_a → terminal near the full 12.566 V EMF
  })

  test('spin it BACKWARD and everything reverses — EMF, current, and the fields with them', () => {
    // The dynamo demo: mechanical spin direction IS the electrical direction. E = k·ω is signed,
    // so a shaft driven the other way pushes the same current the other way around the loop —
    // which is what flips the flow dashes and the field lens's dot-and-cross marks on screen.
    const solveAtRpm = (rpm: number) => {
      const nodes: CanvasNode[] = [
        {
          id: 'gen1',
          definition: 'generator',
          parameters: { ...genNode(), drive_speed: scalar(rpm, 'rpm') },
        },
        { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(10, 'ohm') } },
        { id: 'gnd', definition: 'ground' },
      ]
      const edges = [
        g('gen1', 'terminal_positive', 'r1', 'terminal_a'),
        g('r1', 'terminal_b', 'gnd', 'reference_terminal'),
        g('gen1', 'terminal_negative', 'gnd', 'reference_terminal'),
      ]
      const world = canvasToWorld(nodes, edges)
      const sol = solveDC(world)
      expect(sol.status).toBe('solved')
      return { current: sol.branches.get('r1') ?? 0, reading: partReadings(world, sol).get('gen1') }
    }
    const fwd = solveAtRpm(3000)
    const rev = solveAtRpm(-3000)
    expect(fwd.current).toBeCloseTo(EMF / 11.5, 4) // ~1.093 A one way…
    expect(rev.current).toBeCloseTo(-fwd.current, 6) // …exactly the same the other way
    expect(rev.reading?.generatedEmfV ?? 0).toBeCloseTo(-EMF, 3) // the EMF itself reversed
  })
})

describe('DC generator — transient (a fixed-speed dynamo is a constant source)', () => {
  test('it charges a capacitor through a resistor, the current decaying to zero', () => {
    const nodes: CanvasNode[] = [
      { id: 'gen1', definition: 'generator', parameters: genNode() },
      { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(100, 'ohm') } },
      { id: 'c1', definition: 'capacitor', parameters: { capacitance: scalar(1e-6, 'farad') } },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      g('gen1', 'terminal_positive', 'r1', 'terminal_a'),
      g('r1', 'terminal_b', 'c1', 'terminal_a'),
      g('c1', 'terminal_b', 'gnd', 'reference_terminal'),
      g('gen1', 'terminal_negative', 'gnd', 'reference_terminal'),
    ]
    const world = canvasToWorld(nodes, edges)
    const result = solveTransient(world, { timeStep: 1e-5, duration: 2e-3 })
    expect(result.status).toBe('solved')
    const current = result.series.map((p) =>
      Math.abs(p.currents?.get('gen1/terminal_positive') ?? 0),
    )
    expect(current[0] ?? 0).toBeGreaterThan(0.1) // E/(R_a+R) ≈ 0.124 A at switch-on (cap empty)
    expect(current[current.length - 1] ?? 1).toBeLessThan(0.005) // decays as the cap charges to E
  })
})

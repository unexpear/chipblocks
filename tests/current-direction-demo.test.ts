/**
 * The classroom current-direction demos, through the REAL solvers — the lead's physics claims,
 * double-checked end to end:
 *
 *  - An LED passes current ONE way (it's a diode). The classic AC demo: two LEDs anti-parallel on a
 *    sine — each lights on its own half-cycle, showing the current's direction alternating. On DC
 *    only the forward-oriented one conducts; flip the source and they swap.
 *  - The PHASE tie: the two LEDs' current pulses sit half a period apart — the scope's new phase
 *    measurement reads ±180° between them, the number form of "opposite half-cycles".
 *  - Magnets & motors: a brushed DC motor's torque is k·i from the permanent-magnet field, so the
 *    spin DIRECTION follows the current direction — reverse the supply, the motor spins backward.
 *    On AC the current (hence torque) flips every half-cycle and the rotor gets no net push — the
 *    "AC and DC have different rules" demo in one part.
 */
import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { partReadings } from '../src/renderer/part-readings.ts'
import { phaseBetweenDeg, type WaveSample } from '../src/renderer/waveform-measure.ts'
import { solveTransient } from '../src/transient-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

const led = () => ({
  forward_voltage: scalar(2, 'volt'),
  max_forward_current: scalar(0.02, 'ampere'),
  ideality_factor: scalar(2, 'dimensionless'),
})

const g = (s: string, sh: string, t: string, th: string) => ({
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
})

/** AC source → resistor → a PAIR of anti-parallel LEDs → back. The classic direction demo. */
function antiParallelWorld(acVolts: number, dcVolts = 0, frequency = 1000) {
  const nodes: CanvasNode[] = [
    {
      id: 'src',
      definition: 'power_source',
      parameters: {
        nominal_voltage: scalar(dcVolts, 'volt'),
        ac_amplitude: scalar(acVolts, 'volt'),
        frequency: scalar(frequency, 'hertz'),
        internal_resistance: scalar(0, 'ohm'),
      },
    },
    { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(470, 'ohm') } },
    { id: 'led_fwd', definition: 'led', parameters: led() },
    { id: 'led_rev', definition: 'led', parameters: led() },
    { id: 'gnd', definition: 'ground' },
  ]
  const edges = [
    g('src', 'terminal_positive', 'r1', 'terminal_a'),
    // led_fwd conducts when the source swings positive…
    g('r1', 'terminal_b', 'led_fwd', 'anode'),
    g('led_fwd', 'cathode', 'src', 'terminal_negative'),
    // …led_rev is the SAME two nets the other way round, and conducts on the negative swing.
    g('r1', 'terminal_b', 'led_rev', 'cathode'),
    g('led_rev', 'anode', 'src', 'terminal_negative'),
    g('gnd', 'reference_terminal', 'src', 'terminal_negative'),
  ]
  return canvasToWorld(nodes, edges)
}

describe('the anti-parallel LED demo — sine waves show the current direction', () => {
  const world = antiParallelWorld(5)
  const result = solveTransient(world, { timeStep: 1e-6, duration: 3e-3 })
  const fwd = result.series.map((p) => p.currents?.get('led_fwd/anode') ?? 0)
  const rev = result.series.map((p) => p.currents?.get('led_rev/anode') ?? 0)

  test('each LED conducts on ITS half-cycle only — real milliamps, opposite halves', () => {
    expect(result.status).toBe('solved')
    expect(Math.max(...fwd)).toBeGreaterThan(4e-3) // forward LED lights on the positive swing
    expect(Math.max(...rev)).toBeGreaterThan(4e-3) // reverse LED lights on the negative swing
    // neither ever conducts backwards beyond junction leakage
    expect(Math.min(...fwd)).toBeGreaterThan(-1e-6)
    expect(Math.min(...rev)).toBeGreaterThan(-1e-6)
  })

  test('they NEVER conduct together — the current has one direction at a time', () => {
    for (let i = 0; i < fwd.length; i++) {
      const both = Math.min(fwd[i] ?? 0, rev[i] ?? 0)
      expect(both).toBeLessThan(1e-6) // at most one of the pair carries real current
    }
  })

  test('the phase tie: the two LEDs’ current pulses sit ±180° apart', () => {
    const t = (i: number) => result.series[i]?.time ?? 0
    const a: WaveSample[] = fwd.map((v, i) => ({ t: t(i), v }))
    const b: WaveSample[] = rev.map((v, i) => ({ t: t(i), v }))
    const phi = phaseBetweenDeg(a, b)
    expect(phi).not.toBeNull()
    expect(Math.abs(phi ?? 0)).toBeGreaterThan(175) // opposite half-cycles = half a period apart
  })
})

describe('on DC, direction is everything', () => {
  test('only the forward-oriented LED conducts; flip the source and they swap roles', () => {
    const forward = solveTransient(antiParallelWorld(0, 5), { timeStep: 1e-5, duration: 1e-3 })
    const last = forward.series[forward.series.length - 1]
    expect(last?.currents?.get('led_fwd/anode') ?? 0).toBeGreaterThan(4e-3)
    expect(Math.abs(last?.currents?.get('led_rev/anode') ?? 0)).toBeLessThan(1e-6)

    const reversed = solveTransient(antiParallelWorld(0, -5), { timeStep: 1e-5, duration: 1e-3 })
    const rLast = reversed.series[reversed.series.length - 1]
    expect(rLast?.currents?.get('led_rev/anode') ?? 0).toBeGreaterThan(4e-3)
    expect(Math.abs(rLast?.currents?.get('led_fwd/anode') ?? 0)).toBeLessThan(1e-6)
  })
})

// ---------------------------------------------------------------------------
// Magnets & motors: the spin direction IS the current direction.
// ---------------------------------------------------------------------------

const motorNode = () => ({
  armature_resistance: scalar(2, 'ohm'),
  motor_constant: scalar(0.02, 'V*s/rad'),
  viscous_friction: scalar(5e-6, 'N*m*s/rad'),
  armature_inductance: scalar(1e-3, 'henry'),
  rotor_inertia: scalar(1e-5, 'kg*m^2'),
  load_torque: scalar(0, 'N*m'),
})

function motorWorld(dcVolts: number, ac?: { amplitude: number; frequency: number }) {
  const nodes: CanvasNode[] = [
    {
      id: 'v1',
      definition: 'power_source',
      parameters: {
        nominal_voltage: scalar(dcVolts, 'volt'),
        internal_resistance: scalar(0, 'ohm'),
        ...(ac
          ? {
              ac_amplitude: scalar(ac.amplitude, 'volt'),
              frequency: scalar(ac.frequency, 'hertz'),
            }
          : {}),
      },
    },
    { id: 'm1', definition: 'dc_motor', parameters: motorNode() },
    { id: 'gnd', definition: 'ground' },
  ]
  const edges = [
    g('v1', 'terminal_positive', 'm1', 'terminal_positive'),
    g('m1', 'terminal_negative', 'gnd', 'reference_terminal'),
    g('v1', 'terminal_negative', 'gnd', 'reference_terminal'),
  ]
  return canvasToWorld(nodes, edges)
}

describe('magnets & motors — torque k·i follows the current direction', () => {
  test('reverse the supply, the motor spins the OTHER way at the same speed', () => {
    const fwd = solveDC(motorWorld(12))
    const rev = solveDC(motorWorld(-12))
    expect(fwd.status).toBe('solved')
    expect(rev.status).toBe('solved')
    const fwdRpm = partReadings(motorWorld(12), fwd).get('m1')?.speedRpm ?? 0
    const revRpm = partReadings(motorWorld(-12), rev).get('m1')?.speedRpm ?? 0
    expect(fwdRpm).toBeGreaterThan(1000) // spinning hard forward
    expect(revRpm).toBeCloseTo(-fwdRpm, 3) // same speed, opposite direction
  })

  test('on AC the armature current flips every half-cycle — torque averages to nothing', () => {
    // 12 V amplitude at 50 Hz: the same volts that spin the motor up on DC just shake it here.
    const result = solveTransient(motorWorld(0, { amplitude: 12, frequency: 50 }), {
      timeStep: 2e-4,
      duration: 0.2,
    })
    expect(result.status).toBe('solved')
    // skip the first cycle (start-up), then look at whole cycles
    const settled = result.series.filter((p) => p.time >= 0.02)
    const amps = settled.map((p) => p.currents?.get('m1/terminal_positive') ?? 0)
    const peak = Math.max(...amps.map(Math.abs))
    const mean = amps.reduce((s, v) => s + v, 0) / amps.length
    expect(peak).toBeGreaterThan(0.5) // real alternating current flows…
    expect(Math.max(...amps)).toBeGreaterThan(0.5) // …in one direction…
    expect(Math.min(...amps)).toBeLessThan(-0.5) // …and the other, alternating
    expect(Math.abs(mean)).toBeLessThan(0.05 * peak) // no net direction → no net torque → no spin
  })
})

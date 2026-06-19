/**
 * Transmission line in the FREQUENCY domain (AC analysis) — the view where the WAVELENGTH
 * shows up explicitly. A lossless line of electrical length θ = ω·τ = 2π·(length/λ)
 * transforms its load, and at a QUARTER wavelength (θ = π/2) it flips it outright:
 *   Z_in = Z0² / Z_L
 * so a shorted far end looks OPEN at the input and an open far end looks SHORTED. This is
 * the closed-form, wavelength-explicit result the time-domain (Branin) solver gives you
 * only as a scope trace. Checked against the textbook quarter-wave transformer
 * (Pozar, Microwave Engineering).
 *
 * Test rig: a 1 V source through a series resistance R_s into the near end; the far end
 * carries the load. The measured gain at the near node is the divider Z_in / (R_s + Z_in),
 * so it reads the impedance the line PRESENTS — which is the whole point.
 */

import { describe, expect, test } from 'vitest'
import { acResponse } from '../src/ac-analysis.ts'
import type { World } from '../src/cross-fk-validator.ts'
import { propagationDelayS } from '../src/transmission-line-model.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

function makeWorld(): World {
  return {
    definitions: new Map(),
    instances: new Map(),
    behaviors: new Map(),
    activeVariables: new Map(),
    nets: new Map(),
  }
}
function ensureNet(world: World, id: string, ground = false) {
  if (!world.nets.has(id)) {
    world.nets.set(id, {
      id,
      kind: 'net',
      ...(ground ? { type: 'ground' as const } : {}),
      members: [],
    })
  }
}
function addPart(
  world: World,
  id: string,
  definition: string,
  parameters: Record<string, { value: unknown }>,
  pins: { net: string; terminal: string }[],
) {
  world.instances.set(id, {
    id,
    kind_ref: 'primitive_device',
    definition,
    parameters,
    connects: pins.map((p) => ({ net: p.net, terminal: p.terminal, of: id })),
  })
  for (const p of pins) {
    ensureNet(world, p.net)
    world.nets.get(p.net)?.members.push({ instance: id, terminal: p.terminal })
  }
}

const LENGTH_M = 0.075
const VELOCITY_FACTOR = 1
const TAU = propagationDelayS(LENGTH_M, VELOCITY_FACTOR)
/** Frequency at which the line is exactly a quarter wavelength (θ = ω·τ = π/2). */
const F_QUARTER = 1 / (4 * TAU)

// 1 V source — R_s — [near] line [far] — load.  Output = the near node (reads Z_in).
function lineWorld(
  z0: number,
  rsOhm: number,
  far: { loadOhm?: number; shorted?: boolean; open?: boolean },
): World {
  const w = makeWorld()
  ensureNet(w, 'gnd', true)
  addPart(w, 'vin', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
    { net: 'src', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  addPart(w, 'rs', 'resistor', { resistance: scalar(rsOhm, 'ohm') }, [
    { net: 'src', terminal: 'terminal_a' },
    { net: 'mid', terminal: 'terminal_b' },
  ])
  const farNet = far.shorted ? 'gnd' : 'load' // shorted far end = far_a tied to ground
  addPart(
    w,
    'line',
    'transmission_line',
    {
      characteristic_impedance: scalar(z0, 'ohm'),
      length: scalar(LENGTH_M, 'meter'),
      velocity_factor: scalar(VELOCITY_FACTOR, 'dimensionless'),
    },
    [
      { net: 'mid', terminal: 'near_a' },
      { net: 'gnd', terminal: 'near_b' },
      { net: farNet, terminal: 'far_a' },
      { net: 'gnd', terminal: 'far_b' },
    ],
  )
  if (far.loadOhm !== undefined) {
    addPart(w, 'rload', 'resistor', { resistance: scalar(far.loadOhm, 'ohm') }, [
      { net: 'load', terminal: 'terminal_a' },
      { net: 'gnd', terminal: 'terminal_b' },
    ])
  }
  // far.open: nothing at 'load' — the floating far end (the line's connect still creates the net)
  return w
}

const gainAt = (w: World, freqHz: number) =>
  acResponse(w, { inputSource: 'vin', outputNet: 'mid' }, freqHz).gain

describe('transmission line — frequency domain (wavelength explicit)', () => {
  test('a quarter-wave line transforms the load: Z_in = Z0² / Z_L', () => {
    // Z0 = 100, Z_L = 50  ->  Z_in = 100²/50 = 200 Ω at the quarter wave; the R_s = 100
    // divider then reads 200/(100+200).
    const w = lineWorld(100, 100, { loadOhm: 50 })
    expect(gainAt(w, F_QUARTER)).toBeCloseTo(200 / 300, 2) // 0.667 — the 50 Ω load looks like 200 Ω
    // far BELOW the quarter wave the line is electrically short — a plain pass-through, so the
    // load shows through unchanged at 50 Ω (the lumped limit our wires already use)
    expect(gainAt(w, F_QUARTER / 1000)).toBeCloseTo(50 / 150, 2) // 0.333
  })

  test('a quarter-wave line FLIPS open and short', () => {
    // shorted far end -> looks OPEN at the input (it draws no current), V(near) ≈ the source
    expect(gainAt(lineWorld(100, 100, { shorted: true }), F_QUARTER)).toBeGreaterThan(0.99)
    // open far end -> looks SHORTED at the input, V(near) ≈ 0
    expect(gainAt(lineWorld(100, 100, { open: true }), F_QUARTER)).toBeLessThan(0.01)
  })

  test('the behaviour is periodic in electrical length (θ = 2π·length/λ)', () => {
    const w = lineWorld(100, 100, { loadOhm: 50 })
    // 3λ/4 (three times the frequency) is again an odd quarter-wave — the transform repeats
    expect(gainAt(w, 3 * F_QUARTER)).toBeCloseTo(200 / 300, 2) // 0.667 again
    // 5λ/4 too
    expect(gainAt(w, 5 * F_QUARTER)).toBeCloseTo(200 / 300, 2)
  })

  test('Z0 sets how hard the load is transformed', () => {
    // a 200 Ω line on the same 50 Ω load gives Z_in = 200²/50 = 800 Ω -> 800/900 ≈ 0.889
    expect(gainAt(lineWorld(200, 100, { loadOhm: 50 }), F_QUARTER)).toBeCloseTo(800 / 900, 2)
    // a 50 Ω line MATCHED to the 50 Ω load is invisible at the quarter wave: Z_in = 50 -> 0.333
    expect(gainAt(lineWorld(50, 100, { loadOhm: 50 }), F_QUARTER)).toBeCloseTo(50 / 150, 2)
  })
})

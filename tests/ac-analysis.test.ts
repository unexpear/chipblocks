/**
 * AC analysis vs the textbook (Sprint 22) — the new frequency-domain engine, checked
 * against the two first-order responses every engineer knows cold:
 *
 *   • RC low-pass  H = 1/(1+jwRC):  −3 dB and −45° at the corner f_c = 1/(2πRC),
 *     flat (0 dB, 0°) well below, rolling off −20 dB/decade toward −90° above.
 *   • CR high-pass H = jwRC/(1+jwRC): the mirror image — −3 dB and +45° at f_c,
 *     flat above, +90° far below.
 *
 * Exact analytic targets, so the engine has to match to several digits, not roughly.
 */

import { describe, expect, test } from 'vitest'
import { acResponse, acSweep } from '../src/ac-analysis.ts'
import type { World } from '../src/cross-fk-validator.ts'

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
  parameters: Record<string, ReturnType<typeof scalar>>,
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

/** vin -> R -> out -> C -> gnd : the classic low-pass. */
function rcLowPass(rOhm: number, cFarad: number): World {
  const w = makeWorld()
  ensureNet(w, 'gnd', true)
  addPart(w, 'vin', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
    { net: 'in', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  addPart(w, 'r1', 'resistor', { resistance: scalar(rOhm, 'ohm') }, [
    { net: 'in', terminal: 'terminal_a' },
    { net: 'out', terminal: 'terminal_b' },
  ])
  addPart(w, 'c1', 'capacitor', { capacitance: scalar(cFarad, 'farad') }, [
    { net: 'out', terminal: 'terminal_a' },
    { net: 'gnd', terminal: 'terminal_b' },
  ])
  return w
}

/** vin -> C -> out -> R -> gnd : the classic high-pass. */
function crHighPass(rOhm: number, cFarad: number): World {
  const w = makeWorld()
  ensureNet(w, 'gnd', true)
  addPart(w, 'vin', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
    { net: 'in', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  addPart(w, 'c1', 'capacitor', { capacitance: scalar(cFarad, 'farad') }, [
    { net: 'in', terminal: 'terminal_a' },
    { net: 'out', terminal: 'terminal_b' },
  ])
  addPart(w, 'r1', 'resistor', { resistance: scalar(rOhm, 'ohm') }, [
    { net: 'out', terminal: 'terminal_a' },
    { net: 'gnd', terminal: 'terminal_b' },
  ])
  return w
}

const R = 1000
const C = 1e-6
const fc = 1 / (2 * Math.PI * R * C) // 159.155 Hz
const opts = { inputSource: 'vin', outputNet: 'out' }

describe('AC analysis — first-order RC filters vs textbook', () => {
  test('RC low-pass: −3 dB and −45° at the corner, flat below, −20 dB/decade above', () => {
    const w = rcLowPass(R, C)

    const atFc = acResponse(w, opts, fc)
    expect(atFc.gain).toBeCloseTo(Math.SQRT1_2, 4) // 1/√2
    expect(atFc.gainDb).toBeCloseTo(-3.0103, 3)
    expect(atFc.phaseDeg).toBeCloseTo(-45, 3)

    const low = acResponse(w, opts, fc / 1000)
    expect(low.gain).toBeCloseTo(1, 3)
    expect(Math.abs(low.phaseDeg)).toBeLessThan(0.1)

    // A decade of frequency costs ~20 dB once well above the corner.
    const d1 = acResponse(w, opts, fc * 100)
    const d2 = acResponse(w, opts, fc * 1000)
    expect(d1.gainDb - d2.gainDb).toBeCloseTo(20, 1)
    expect(d2.phaseDeg).toBeLessThan(-89) // approaching −90°
  })

  test('CR high-pass: −3 dB and +45° at the corner, flat above, +90° far below', () => {
    const w = crHighPass(R, C)

    const atFc = acResponse(w, opts, fc)
    expect(atFc.gain).toBeCloseTo(Math.SQRT1_2, 4)
    expect(atFc.phaseDeg).toBeCloseTo(45, 3)

    const high = acResponse(w, opts, fc * 1000)
    expect(high.gain).toBeCloseTo(1, 3)
    expect(Math.abs(high.phaseDeg)).toBeLessThan(0.1)

    const low = acResponse(w, opts, fc / 1000)
    expect(low.phaseDeg).toBeGreaterThan(89) // approaching +90°
  })

  test('sweep returns a monotone roll-off across the band', () => {
    const points = acSweep(rcLowPass(R, C), {
      ...opts,
      fStartHz: 1,
      fStopHz: 1e5,
      pointsPerDecade: 10,
    })
    expect(points.length).toBeGreaterThan(40)
    for (let i = 1; i < points.length; i++) {
      expect((points[i]?.gain ?? 0) <= (points[i - 1]?.gain ?? 0) + 1e-9).toBe(true)
    }
    expect(points[0]?.gain ?? 0).toBeCloseTo(1, 2) // 1 Hz << f_c
    expect(points[points.length - 1]?.gainDb ?? 0).toBeLessThan(-40) // 100 kHz >> f_c
  })
})

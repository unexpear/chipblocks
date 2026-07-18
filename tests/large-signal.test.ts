/**
 * LARGE-SIGNAL RF (analog-RF chapter) — the transient+FFT nonlinear metrics: harmonic distortion (THD) and
 * gain compression (P1dB). Checked two ways: (1) a purely LINEAR circuit MUST report no distortion and never
 * compress — the honesty guard that the pipeline isn't inventing harmonics; (2) a real common-emitter BJT
 * amplifier driven hard MUST generate harmonics (THD rises with drive) and MUST compress (its gain falls a
 * dB below small-signal → a real P1dB). The transient solver's full nonlinear device models are what make
 * the amplifier actually saturate.
 */
import { describe, expect, test } from 'vitest'
import type { World } from '../src/cross-fk-validator.ts'
import { gainCompression, largeSignalSpectrum } from '../src/renderer/large-signal.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const makeWorld = (): World => ({
  definitions: new Map(),
  instances: new Map(),
  behaviors: new Map(),
  activeVariables: new Map(),
  nets: new Map(),
})
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

/** A pure resistive divider driven by an AC source — perfectly linear, so no distortion, no compression. */
function divider(r1: number, r2: number): World {
  const w = makeWorld()
  ensureNet(w, 'gnd', true)
  addPart(w, 'vin', 'power_source', { nominal_voltage: scalar(0, 'volt') }, [
    { net: 'in', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  addPart(w, 'r1', 'resistor', { resistance: scalar(r1, 'ohm') }, [
    { net: 'in', terminal: 'terminal_a' },
    { net: 'out', terminal: 'terminal_b' },
  ])
  addPart(w, 'r2', 'resistor', { resistance: scalar(r2, 'ohm') }, [
    { net: 'out', terminal: 'terminal_a' },
    { net: 'gnd', terminal: 'terminal_b' },
  ])
  return w
}

/** A common-emitter NPN amplifier with emitter degeneration (Vcc 9 V, Rc 4.7 kΩ, Re 470 Ω, β 100). The drive
 *  source sits directly on the base carrying the DC bias (~1.2 V) + the AC; Re sets the gain ≈ −Rc/Re ≈ −10
 *  and linearises it, so the stage amplifies cleanly at small drive and clips (compresses) at large drive.
 *  The engine overrides the source's ac_amplitude/frequency each run. */
function commonEmitter(): World {
  const w = makeWorld()
  ensureNet(w, 'gnd', true)
  addPart(w, 'bat', 'power_source', { nominal_voltage: scalar(9, 'volt') }, [
    { net: 'vcc', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  addPart(
    w,
    'vb',
    'power_source',
    {
      nominal_voltage: scalar(1.2, 'volt'),
      ac_amplitude: scalar(0.001, 'volt'),
      frequency: scalar(1000, 'hertz'),
    },
    [
      { net: 'base', terminal: 'terminal_positive' },
      { net: 'gnd', terminal: 'terminal_negative' },
    ],
  )
  addPart(w, 'rc', 'resistor', { resistance: scalar(4700, 'ohm') }, [
    { net: 'vcc', terminal: 'terminal_a' },
    { net: 'coll', terminal: 'terminal_b' },
  ])
  addPart(w, 're', 'resistor', { resistance: scalar(470, 'ohm') }, [
    { net: 'emit', terminal: 'terminal_a' },
    { net: 'gnd', terminal: 'terminal_b' },
  ])
  addPart(
    w,
    'q1',
    'transistor_bjt_npn',
    {
      saturation_current: scalar(1e-14, 'ampere'),
      forward_current_gain: scalar(100, 'dimensionless'),
      reverse_current_gain: scalar(2, 'dimensionless'),
    },
    [
      { net: 'coll', terminal: 'collector' },
      { net: 'base', terminal: 'base' },
      { net: 'emit', terminal: 'emitter' },
    ],
  )
  return w
}

// Smaller capture windows keep the many transient runs fast while staying a power of two + bin-aligned.
const FAST = { fundamentalHz: 1000, samplesPerCycle: 32, settleCycles: 6, captureCycles: 32 }

describe('largeSignalSpectrum — a LINEAR circuit invents no distortion (honesty guard)', () => {
  test('a resistive divider is a pure tone: THD ≈ 0 and the output scales linearly', () => {
    const w = divider(1000, 1000) // ÷2
    const small = largeSignalSpectrum(w, { ...FAST, inputSource: 'vin', outputNet: 'out' }, 0.1)
    const big = largeSignalSpectrum(w, { ...FAST, inputSource: 'vin', outputNet: 'out' }, 3)
    if (small === null || big === null) throw new Error('transient failed')
    expect(small.thd).toBeLessThan(1e-3) // no harmonics from a linear network
    expect(big.thd).toBeLessThan(1e-3)
    expect(small.fundamentalVolts).toBeCloseTo(0.05, 3) // 0.1 V × ½
    expect(big.fundamentalVolts).toBeCloseTo(1.5, 2) // 3 V × ½ — still linear at large drive
  })
})

describe('largeSignalSpectrum — a driven amplifier generates real harmonics', () => {
  test('THD rises with drive as the common-emitter stage clips', () => {
    const opts = { ...FAST, inputSource: 'vb', outputNet: 'coll' }
    const w = commonEmitter()
    const soft = largeSignalSpectrum(w, opts, 0.01) // small drive — nearly linear
    const hard = largeSignalSpectrum(w, opts, 0.6) // large drive — clipping
    if (soft === null || hard === null) throw new Error('transient failed')
    expect(hard.thd).toBeGreaterThan(soft.thd) // driving harder distorts more
    expect(hard.thd).toBeGreaterThan(0.02) // a real, measurable amount of harmonic content
    expect(hard.harmonics[1] ?? 0).toBeGreaterThan(0) // a nonzero 3rd harmonic exists
  })
})

describe('gainCompression — a real P1dB from a saturating amplifier', () => {
  test('the common-emitter amp amplifies, then compresses ≥ 1 dB → a found P1dB', () => {
    const amps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.4, 0.7, 1.0]
    const r = gainCompression(
      commonEmitter(),
      { ...FAST, inputSource: 'vb', outputNet: 'coll' },
      amps,
    )
    expect(r.sweep.length).toBeGreaterThan(4)
    expect(r.smallSignalGainDb).toBeGreaterThan(10) // it is an amplifier (|gain| ≫ 1)
    // the gain must fall at least 1 dB below small-signal within the sweep → a real compression point
    expect(r.p1dbInputVolts).not.toBeNull()
    const p1db = r.p1dbInputVolts as number
    expect(p1db).toBeGreaterThan(amps[0] as number)
    expect(p1db).toBeLessThanOrEqual(amps[amps.length - 1] as number)
    // gain at the hardest drive is below small-signal (it compressed, didn't grow)
    expect((r.sweep.at(-1) as { gainDb: number }).gainDb).toBeLessThan(r.smallSignalGainDb - 1)
  })
})

describe('bin alignment is enforced regardless of samplesPerCycle (review fix)', () => {
  test('a non-power-of-two samplesPerCycle still reads the fundamental exactly (no scalloping error)', () => {
    // 48 is coerced to a power of two, so the fundamental stays bin-aligned — without that it would land on
    // a fractional bin and read several % low from Hann scalloping.
    const s = largeSignalSpectrum(
      divider(1000, 1000),
      {
        fundamentalHz: 1000,
        samplesPerCycle: 48,
        settleCycles: 6,
        captureCycles: 32,
        inputSource: 'vin',
        outputNet: 'out',
      },
      2,
    )
    if (s === null) throw new Error('transient failed')
    expect(s.fundamentalVolts).toBeCloseTo(1.0, 2) // 2 V × ½, exact — not ~0.93 from an off-bin read
    expect(s.thd).toBeLessThan(1e-3)
  })

  test('a coerced samplesPerCycle gives the same answer as its power-of-two target', () => {
    const base = {
      fundamentalHz: 1000,
      settleCycles: 6,
      captureCycles: 32,
      inputSource: 'vb',
      outputNet: 'coll',
    }
    const at50 = largeSignalSpectrum(commonEmitter(), { ...base, samplesPerCycle: 50 }, 0.4)
    const at64 = largeSignalSpectrum(commonEmitter(), { ...base, samplesPerCycle: 64 }, 0.4)
    if (at50 === null || at64 === null) throw new Error('transient failed')
    expect(at50.thd).toBeCloseTo(at64.thd, 6) // 50 → 64, identical run
  })
})

describe('largeSignalSpectrum — degenerate inputs', () => {
  test('a non-positive drive or frequency yields null', () => {
    const w = divider(1000, 1000)
    expect(largeSignalSpectrum(w, { ...FAST, inputSource: 'vin', outputNet: 'out' }, 0)).toBeNull()
    expect(
      largeSignalSpectrum(
        w,
        { ...FAST, fundamentalHz: 0, inputSource: 'vin', outputNet: 'out' },
        1,
      ),
    ).toBeNull()
  })
})

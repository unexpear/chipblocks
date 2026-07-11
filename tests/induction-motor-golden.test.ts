/**
 * The single-cage dq march, locked BIT-FOR-BIT against golden samples captured from the model
 * as it shipped BEFORE the double-cage refactor (commit 0d18f09, this machine, this exact
 * drive). The double cage is opt-in, and the hard requirement is that a machine without the
 * cage-2 parameters marches through the ORIGINAL 4-state arithmetic — same expressions, same
 * operation order — so these assert exact equality (toBe), not closeness. If a future
 * legitimate change to the single-cage model moves these numbers, re-capture the goldens in
 * the same commit and say so in its message; if they move unexpectedly, the single-cage
 * arithmetic was perturbed — that is the bug this file exists to catch. (Exact-equality caveat:
 * the baselines embed this machine's Math.cos/hypot roundings, so a JS-engine change could in
 * principle shift low-order bits — that too should be a conscious re-baseline, never a
 * tolerance.)
 */
import { describe, expect, test } from 'vitest'
import {
  createDqMotor,
  createDqMotor3,
  dq3CommitMotor,
  dq3InitMotor,
  dq3StampMotor,
  dqCommitMotor,
  dqInductancesFromParams,
  dqInitMotor,
  dqStampMotor,
} from '../src/induction-motor-dq.ts'
import type { InductionMotorParams } from '../src/induction-motor-model.ts'

const P: InductionMotorParams = {
  supplyVoltage: 230,
  frequency: 50,
  poles: 4,
  statorResistance: 2,
  statorReactance: 4,
  rotorResistance: 2,
  rotorReactance: 4,
  magnetizingReactance: 80,
  loadTorque: 20,
  viscousFriction: 0.002,
}
const MECH = { rotorInertia: 0.0152, viscousFriction: 0.002, loadTorque: 20 }

describe('golden check', () => {
  test('1-port march samples bit-identical to pre-refactor', () => {
    const L = dqInductancesFromParams(P)
    if (L === null) throw new Error('bad params')
    const T = 1 / 50
    const h = T / 200
    const core = createDqMotor(L, MECH, 0, T)
    const v = (t: number) => 230 * Math.SQRT2 * Math.cos(2 * Math.PI * 50 * t)
    dqInitMotor(core, v(0))
    const got = new Map<number, number>()
    for (let k = 1; k <= 3200; k++) {
      const t = k * h
      dqStampMotor(core, t, h)
      const i = dqCommitMotor(core, v(t), h)
      got.set(k, i)
    }
    expect(got.get(50)).toBe(33.74068851761342)
    expect(got.get(100)).toBe(-17.865369856477706)
    expect(got.get(200)).toBe(12.77496176202441)
    expect(got.get(400)).toBe(16.30439076052691)
    expect(got.get(800)).toBe(16.93527381160046)
    expect(got.get(1600)).toBe(18.522312582972937)
    expect(got.get(3200)).toBe(7.0326082339009846)
    expect(core.omega).toBe(149.18829292728776)
    expect(core.torque).toBe(20.4434730769625)
  })

  test('3-port march samples bit-identical to pre-refactor', () => {
    const L = dqInductancesFromParams(P)
    if (L === null) throw new Error('bad params')
    const T = 1 / 50
    const h = T / 200
    const core = createDqMotor3(L, MECH, 0, [true, true, true, true], T)
    const Vp = 230 * Math.SQRT2
    const w = 2 * Math.PI * 50
    const volts = (t: number) => [
      Vp * Math.cos(w * t),
      Vp * Math.cos(w * t - (2 * Math.PI) / 3),
      Vp * Math.cos(w * t + (2 * Math.PI) / 3),
      0,
    ]
    dq3InitMotor(core, volts(0))
    const got = new Map<number, number>()
    for (let k = 1; k <= 3200; k++) {
      const t = k * h
      dq3StampMotor(core, h)
      const currents = dq3CommitMotor(core, volts(t), h)
      got.set(k, currents[0] ?? Number.NaN)
    }
    expect(got.get(50)).toBe(26.09085728844696)
    expect(got.get(100)).toBe(-19.522230787110793)
    expect(got.get(200)).toBe(19.640330289823158)
    expect(got.get(400)).toBe(19.762887552967648)
    expect(got.get(800)).toBe(16.576380456029725)
    expect(got.get(1600)).toBe(19.823657582679584)
    expect(got.get(3200)).toBe(7.002193087083251)
    expect(core.omega).toBe(149.2459813640311)
    expect(core.torque).toBe(20.361982234860783)
  })
})

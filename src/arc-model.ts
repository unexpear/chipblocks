/**
 * The carbon arc's Ayrton characteristic — the burning voltage FALLS as the current rises.
 *
 * Hertha Ayrton measured the arc between solid carbons in air (The Electric Arc, 1902) and fitted
 *   V = a + b·L + (c + d·L)/I        (L = arc length mm, I = current A, V = volts)
 * For a fixed arc length this is V = V_min + B/I: an asymptotic minimum V_min = a + b·L at high
 * current, plus an Ayrton coefficient B = c + d·L (units V·A) that lifts the voltage at low current.
 * The slope dV/dI = −B/I² is NEGATIVE — the arc's defining negative resistance. That is why an arc
 * needs a series ballast to burn steadily: the operating point is stable only where the ballast line
 * is steeper than the arc curve, R_ballast > B/I²; with too little ballast the arc is genuinely
 * unstable (it runs to a short or snuffs out).
 *
 * We never stamp that negative resistance into the MNA matrix (a negative conductance makes the
 * system indefinite and Newton diverge). Instead the arc burns at a FIXED voltage within each solve,
 * and the discrete-state fixed point (solveWithRelays) relaxes that voltage from the solved current —
 * V ← V_min + B/I — re-solving until it settles, the same loop that flips the strike/hold latch. A
 * genuinely-unstable (under-ballasted) arc never converges and is reported unsettled, exactly the
 * honest "could not settle" a relay buzzer gives, rather than a faked operating point.
 *
 * The transient solver applies the same V_min + B/I per step from the previous step's current (the
 * time step itself is the relaxation). An arc with no ayrton_coefficient (B = 0) burns at the flat
 * arc_voltage — the earlier constant-drop model, unchanged.
 *
 * Source: Hertha Ayrton, "The Electric Arc" (1902), the arc-characteristic constants.
 */

import type { Instance, World } from './cross-fk-validator.ts'
import type { Solution } from './dc-solver.ts'
import { readEnumParam, readScalarParam } from './instance-params.ts'

/** Definitions that fall on the Ayrton curve (the carbon arc). The neon/gas-discharge lamp does not. */
const AYRTON_DEFINITIONS = new Set(['arc_lamp'])

/** The relaxed burning voltage is settled to within this (volts). */
export const ARC_VOLTAGE_TOLERANCE = 0.05

/**
 * V = V_min + B/I, with the current floored at the holding current (the arc never burns below it) so
 * the 1/I term stays finite. |current| because the branch sign is direction-dependent.
 */
export function ayrtonArcVoltage(
  vMin: number,
  ayrtonCoefficient: number,
  current: number,
  floorCurrent: number,
): number {
  const i = Math.max(Math.abs(current), Math.max(floorCurrent, 1e-9))
  return vMin + ayrtonCoefficient / i
}

/**
 * The base V_min (the arc_voltage parameter, read as the high-current asymptote) for every arc that
 * actually falls — one with a positive ayrton_coefficient. Read from the ORIGINAL world, before any
 * relaxed override, so the fixed point always relaxes from the true minimum.
 */
export function ayrtonArcBaseVoltages(world: World): Map<string, number> {
  const out = new Map<string, number>()
  for (const inst of world.instances.values()) {
    if (!AYRTON_DEFINITIONS.has(inst.definition)) continue
    const b = readScalarParam(inst, 'ayrton_coefficient')
    const vMin = readScalarParam(inst, 'arc_voltage')
    if (b !== undefined && b > 0 && vMin !== undefined) out.set(inst.id, vMin)
  }
  return out
}

/** A world with each falling arc's arc_voltage overridden to its current relaxed burning voltage. */
export function worldWithArcVoltages(world: World, voltages: Map<string, number>): World {
  if (voltages.size === 0) return world
  const instances = new Map<string, Instance>()
  for (const [id, inst] of world.instances) {
    const v = voltages.get(id)
    if (v === undefined) {
      instances.set(id, inst)
      continue
    }
    instances.set(id, {
      ...inst,
      parameters: {
        ...inst.parameters,
        arc_voltage: { value: { kind: 'scalar', amount: v, unit: 'volt' } },
      },
    })
  }
  return { ...world, instances }
}

/**
 * The new relaxed burning voltage for each falling arc that is CONDUCTING and whose voltage has moved
 * more than the tolerance — V_min + B/I off the solved current. Arcs already settled (or blocking, or
 * not on the Ayrton curve) are omitted, so the fixed-point loop converges. `effective` is the current
 * relaxed voltage per arc; `baseVoltages` carries the true V_min from the unoverridden world.
 */
export function arcVoltageTargets(
  world: World,
  solution: Solution,
  baseVoltages: Map<string, number>,
  effective: Map<string, number>,
): Map<string, number> {
  const targets = new Map<string, number>()
  if (solution.status !== 'solved') return targets
  for (const inst of world.instances.values()) {
    const vMin = baseVoltages.get(inst.id)
    if (vMin === undefined) continue
    if (readEnumParam(inst, 'device_state') !== 'conducting') continue
    const b = readScalarParam(inst, 'ayrton_coefficient')
    const holding = readScalarParam(inst, 'holding_current')
    if (b === undefined || holding === undefined) continue
    const current = solution.branches.get(inst.id) ?? 0
    const next = ayrtonArcVoltage(vMin, b, current, holding)
    if (Math.abs(next - (effective.get(inst.id) ?? vMin)) > ARC_VOLTAGE_TOLERANCE) {
      targets.set(inst.id, next)
    }
  }
  return targets
}

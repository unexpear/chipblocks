/**
 * Electro-thermal coupling (stage 7, rung 2) — temperature feeds BACK into the
 * electrical solve, the way real circuits behave:
 *  - a resistor with a declared temperature coefficient drifts: R(T) = R₀(1 + α·ΔT)
 *  - a silicon diode or transistor junction warms and its forward voltage falls
 *    the real ≈2 mV/°C (V_T = kT/q + the SPICE I_S(T) law, applied per-element
 *    by the DC solver via SolveOptions); an LED's computed drift is much
 *    smaller — see resolveShockleyLed's honest model note (Varshni is future)
 *
 * The loop: solve electrically → compute every rated part's temperature from its
 * real dissipated power (T = 25 °C + P·θ_JA) → re-solve with temperature-adjusted
 * parts → repeat until temperatures settle (< 0.1 °C) or the iteration cap hits.
 * Non-convergence is reported honestly (thermal runaway is real physics — a part
 * whose heating increases its own dissipation may have no stable point), and a
 * linear tempco pushed past R ≤ 0 marks the model out-of-range instead of
 * inventing a negative resistance.
 */

import type { Instance, World } from './cross-fk-validator.ts'
import { type Solution, type SolveOptions, solveDC } from './dc-solver.ts'
import { readScalarParam } from './instance-params.ts'
import { acrossVolts, junctionTemperature, STANDARD_AMBIENT_C } from './thermal-model.ts'
import { solveTransient, type TransientOptions, type TransientResult } from './transient-solver.ts'

export type ElectroThermalResult = {
  /** The electrically-converged solution at the final temperatures. */
  solution: Solution
  /** Instance id → settled part temperature (°C), for parts with a θ_JA. */
  temperaturesC: Map<string, number>
  /** Electro-thermal outer iterations performed. */
  thermalIterations: number
  /** Did the temperatures settle (and the model stay in range)? */
  thermalConverged: boolean
  warnings: string[]
}

const MAX_THERMAL_ITERATIONS = 25
const TEMPERATURE_TOLERANCE_C = 0.1
/** Linear-tempco floor: an adjusted resistance at/below this is out of range. */
const RESISTANCE_FLOOR_OHMS = 1e-9
/** °C → K. */
const CELSIUS_TO_KELVIN = 273.15

/**
 * An NTC thermistor's resistance at temperature, the two-parameter Beta law:
 *   R(T) = R₀·exp(B·(1/T − 1/T₀))     [T, T₀ in kelvin]
 * R₀ is `resistance` (the value at the reference temperature T₀), B is
 * `beta_coefficient`, T₀ is `reference_temperature` (default 25 °C). Undefined
 * when R₀ or B is missing. For an NTC (B > 0) the resistance falls as the part
 * warms; this is the exponential branch beside the resistor's linear tempco.
 */
export function thermistorResistance(inst: Instance, temperatureC: number): number | undefined {
  const r0 = readScalarParam(inst, 'resistance')
  const beta = readScalarParam(inst, 'beta_coefficient')
  if (r0 === undefined || beta === undefined || r0 <= 0) return undefined
  const t0K =
    (readScalarParam(inst, 'reference_temperature') ?? STANDARD_AMBIENT_C) + CELSIUS_TO_KELVIN
  const tK = temperatureC + CELSIUS_TO_KELVIN
  if (tK <= 0) return undefined
  return r0 * Math.exp(beta * (1 / tK - 1 / t0K))
}

/**
 * A temperature-dependent part's resistance at temperature. The ONE place these
 * laws live — the solve loop and every display (Math panel) call it, so what the
 * user reads is what the solver used. A thermistor follows the exponential Beta
 * law; a plain resistor with a tempco follows the linear R₀·(1 + α·ΔT). Undefined
 * when the part has no such law/resistance or no temperature is known for it.
 */
export function resistanceAtTemperature(
  inst: Instance,
  temperatureC: number | undefined,
): number | undefined {
  if (temperatureC === undefined) return undefined
  if (inst.definition === 'thermistor') return thermistorResistance(inst, temperatureC)
  const alpha = readScalarParam(inst, 'temperature_coefficient')
  const baseResistance = readScalarParam(inst, 'resistance')
  if (alpha === undefined || baseResistance === undefined) return undefined
  return baseResistance * (1 + alpha * (temperatureC - STANDARD_AMBIENT_C))
}

/** A part's local ambient (°C): its own `ambient_temperature`, else the 25 °C baseline. */
function ambientOf(inst: Instance): number {
  return readScalarParam(inst, 'ambient_temperature') ?? STANDARD_AMBIENT_C
}

/** A world with each tempco resistor's resistance adjusted to its temperature. */
function worldAtTemperatures(
  world: World,
  temperaturesC: Map<string, number>,
  warnings: string[],
): { world: World; outOfRange: boolean } {
  let outOfRange = false
  const instances = new Map<string, Instance>()
  for (const [id, inst] of world.instances) {
    let adjusted = resistanceAtTemperature(inst, temperaturesC.get(id))
    if (adjusted === undefined) {
      instances.set(id, inst)
      continue
    }
    if (adjusted <= RESISTANCE_FLOOR_OHMS) {
      outOfRange = true
      warnings.push(
        `'${id}': temperature-adjusted resistance fell to ${adjusted.toPrecision(3)} Ω at ` +
          `${(temperaturesC.get(id) ?? STANDARD_AMBIENT_C).toFixed(0)} °C — the linear tempco model is out of range; clamped.`,
      )
      adjusted = RESISTANCE_FLOOR_OHMS
    }
    instances.set(id, {
      ...inst,
      parameters: {
        ...inst.parameters,
        resistance: { value: { kind: 'scalar', amount: adjusted, unit: 'ohm' } },
      },
    })
  }
  return { world: { ...world, instances }, outOfRange }
}

/** Each θ_JA-rated part's temperature from its real dissipated power. */
function computeTemperatures(world: World, solution: Solution): Map<string, number> {
  const temperatures = new Map<string, number>()
  for (const inst of world.instances.values()) {
    // A part's temperature is ambient + P·θ_JA, so a θ_JA is the entry ticket: with none there is no
    // temperature to assign here, and worldAtTemperatures leaves the part at R₀. A thermistor set only
    // through ambient_temperature (no θ_JA) therefore keeps R₀ — its shipped default carries a θ_JA, so
    // the ambient knob takes effect as the fixture documents. (computeTransientTemperatures gates the same.)
    const thetaJa = readScalarParam(inst, 'thermal_resistance_junction_ambient')
    if (thetaJa === undefined || thetaJa <= 0) continue
    const branch = solution.branches.get(inst.id)
    if (branch === undefined) continue

    const volts = acrossVolts(inst, solution)
    if (volts === undefined) continue

    temperatures.set(
      inst.id,
      junctionTemperature(Math.abs(branch) * volts, thetaJa, ambientOf(inst)),
    )
  }
  return temperatures
}

/**
 * Solve the circuit with temperature feedback: iterate solve → heat → re-solve
 * to the electro-thermal fixed point. With no thermally-rated parts this reduces
 * to a single plain DC solve (plus one confirmation pass).
 */
export function solveElectroThermal(world: World, options?: SolveOptions): ElectroThermalResult {
  const warnings: string[] = []
  let temperaturesC = new Map<string, number>()
  let solution: Solution = solveDC(world, options)
  let thermalConverged = false
  let iteration = 0

  for (iteration = 1; iteration <= MAX_THERMAL_ITERATIONS; iteration++) {
    if (solution.status !== 'solved') break

    const next = computeTemperatures(world, solution)
    let maxDelta = 0
    for (const [id, t] of next) {
      const previous = temperaturesC.get(id) ?? STANDARD_AMBIENT_C
      maxDelta = Math.max(maxDelta, Math.abs(t - previous))
    }
    temperaturesC = next

    if (maxDelta < TEMPERATURE_TOLERANCE_C) {
      thermalConverged = true
      break
    }

    const adjusted = worldAtTemperatures(world, temperaturesC, warnings)
    solution = solveDC(adjusted.world, { ...options, temperaturesC })
    if (adjusted.outOfRange) break // model out of validity — report, don't fake
  }

  if (iteration > MAX_THERMAL_ITERATIONS) {
    warnings.push(
      `Electro-thermal loop did not settle in ${MAX_THERMAL_ITERATIONS} iterations — ` +
        'the circuit may be thermally unstable (runaway).',
    )
  }

  return {
    solution,
    temperaturesC,
    thermalIterations: Math.min(iteration, MAX_THERMAL_ITERATIONS),
    thermalConverged,
    warnings,
  }
}

export type TransientThermalOptions = TransientOptions & {
  /**
   * Power-averaging starts here (default duration/3 — the settle convention
   * the multimeter and the FFT share), so a power-on transient doesn't bias
   * the steady temperature.
   */
  thermalSettleSeconds?: number
}

export type TransientThermalResult = {
  /** The time-domain result at the final temperatures. */
  result: TransientResult
  /** Instance id → settled part temperature (°C), for parts with a θ_JA. */
  temperaturesC: Map<string, number>
  thermalIterations: number
  thermalConverged: boolean
  warnings: string[]
}

/**
 * Each θ_JA-rated part's temperature from its AVERAGE absorbed power over the
 * settled record — the exact per-terminal ledger Σ v·i_into the solver
 * records (the same numbers Tellegen's theorem balances), time-averaged.
 *
 * Quasi-static thermal model: electrical periods (µs–ms) are far shorter
 * than a part's thermal settling (seconds), so the part sits at the
 * temperature its average dissipation sustains — the same steady lumped law
 * the DC loop uses, T = 25 °C + P·θ. Thermal MASS (warm-up curves within a
 * record) needs cited heat capacities and is a documented future increment.
 */
function computeTransientTemperatures(
  world: World,
  result: TransientResult,
  settleSeconds: number,
): Map<string, number> {
  const temperatures = new Map<string, number>()
  for (const inst of world.instances.values()) {
    const thetaJa = readScalarParam(inst, 'thermal_resistance_junction_ambient')
    if (thetaJa === undefined || thetaJa <= 0) continue
    const connects = inst.connects ?? []
    if (connects.length === 0) continue

    let sum = 0
    let samples = 0
    for (const point of result.series) {
      if (point.time < settleSeconds || point.currents === undefined) continue
      let power = 0
      for (const c of connects) {
        power +=
          (point.nodes.get(c.net) ?? 0) * (point.currents.get(`${inst.id}/${c.terminal}`) ?? 0)
      }
      sum += power
      samples++
    }
    if (samples === 0) continue
    // A passive part's average absorbed power can't be negative; clamp the
    // float dust so a reactive part reads ambient, not below it.
    temperatures.set(
      inst.id,
      junctionTemperature(Math.max(0, sum / samples), thetaJa, ambientOf(inst)),
    )
  }
  return temperatures
}

/**
 * The transient solve with temperature feedback (S20-v3-5) — the same
 * fixed-point loop as solveElectroThermal, run on the time-domain engine:
 * solve → average each rated part's real dissipation → re-solve with R(T)
 * and per-junction I_S(T)/V_T(T) → repeat until temperatures settle. Closes
 * the measured cross-engine gap: the meter (DC loop) and the scope (this)
 * now heat the same parts by the same law.
 */
export function solveTransientThermal(
  world: World,
  options: TransientThermalOptions,
): TransientThermalResult {
  const warnings: string[] = []
  const settleSeconds = options.thermalSettleSeconds ?? options.duration / 3
  let temperaturesC = new Map<string, number>()
  let result: TransientResult = solveTransient(world, options)
  let thermalConverged = false
  let iteration = 0

  for (iteration = 1; iteration <= MAX_THERMAL_ITERATIONS; iteration++) {
    if (result.status !== 'solved') break

    const next = computeTransientTemperatures(world, result, settleSeconds)
    let maxDelta = 0
    for (const [id, t] of next) {
      const previous = temperaturesC.get(id) ?? STANDARD_AMBIENT_C
      maxDelta = Math.max(maxDelta, Math.abs(t - previous))
    }
    temperaturesC = next

    if (maxDelta < TEMPERATURE_TOLERANCE_C) {
      thermalConverged = true
      break
    }

    const adjusted = worldAtTemperatures(world, temperaturesC, warnings)
    result = solveTransient(adjusted.world, { ...options, temperaturesC })
    if (adjusted.outOfRange) break // model out of validity — report, don't fake
  }

  if (iteration > MAX_THERMAL_ITERATIONS) {
    warnings.push(
      `Electro-thermal loop did not settle in ${MAX_THERMAL_ITERATIONS} iterations — ` +
        'the circuit may be thermally unstable (runaway).',
    )
  }

  return {
    result,
    temperaturesC,
    thermalIterations: Math.min(iteration, MAX_THERMAL_ITERATIONS),
    thermalConverged,
    warnings,
  }
}

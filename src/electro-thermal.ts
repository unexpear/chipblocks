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
 * linear tempco pushed past R ≤ 0 means the element has been destroyed: the part
 * FAILS OPEN (the film burns through — the standard resistor failure mode under
 * sustained overload), never a near-zero short that would collapse the rest of
 * the circuit's voltages.
 */

import type { Instance, World } from './cross-fk-validator.ts'
import { type Solution, type SolveOptions, solveDC } from './dc-solver.ts'
import { readScalarParam } from './instance-params.ts'
import {
  acrossVolts,
  bulbFilamentTemperatureC,
  junctionTemperature,
  STANDARD_AMBIENT_C,
} from './thermal-model.ts'
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
/** Linear-tempco validity floor: an adjusted resistance at/below this means the model has left its
 *  range — physically, the element has been destroyed by the temperature that got it here. */
const RESISTANCE_FLOOR_OHMS = 1e-9
/** What a destroyed resistor becomes: OPEN. A film/carbon element overloaded to destruction burns
 *  through and breaks the circuit — it does not fuse into a short. 1 GΩ stands in for the burned
 *  gap: effectively open to the circuit (100× the meter's own 10 MΩ input), finite so the matrix
 *  stays conditioned and a probe across the gap still reads the source EMF, like the real bench. */
const FAILED_OPEN_RESISTANCE_OHMS = 1e9
/** °C → K. */
const CELSIUS_TO_KELVIN = 273.15
/**
 * Tungsten filament resistance exponent n in R(T) = R_op·(T/T_op)^n. Tungsten's
 * resistivity climbs steeply and nonlinearly with temperature; over the lamp range
 * (≈300 K cold to ≈2700 K incandescent) the power law with n ≈ 1.2 is the standard
 * engineering fit to the tabulated tungsten resistivity ratios (Jones & Langmuir,
 * GE Review 1927; CRC Handbook) — medium confidence, the honest first rung beside
 * the full tabulated curve, as the thermistor's Beta is beside Steinhart–Hart.
 */
const TUNGSTEN_RESISTANCE_EXPONENT = 1.2

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
 * A tungsten incandescent filament's resistance at temperature, the power law
 *   R(T) = R_op·(T/T_op)^n        [T, T_op in kelvin, n ≈ 1.2]
 * `resistance` is the HOT value R_op at the operating point `reference_temperature`
 * (R_op = V_rated²/P_rated), so the cold resistance falls out ~14× lower — which is
 * why a bulb pulls a large inrush the instant it is switched on, before the filament
 * has heated. The opposite sign to the NTC thermistor: a filament's resistance RISES
 * with temperature. Undefined when R_op is missing. (The tabulated Jones–Langmuir
 * resistivity curve is the later-rung refinement; the n = 1.2 power law is the
 * standard datasheet-grade fit.)
 */
export function tungstenResistance(inst: Instance, temperatureC: number): number | undefined {
  const rOp = readScalarParam(inst, 'resistance')
  if (rOp === undefined || rOp <= 0) return undefined
  const tOpK =
    (readScalarParam(inst, 'reference_temperature') ?? STANDARD_AMBIENT_C) + CELSIUS_TO_KELVIN
  const tK = temperatureC + CELSIUS_TO_KELVIN
  if (tK <= 0 || tOpK <= 0) return undefined
  return rOp * (tK / tOpK) ** TUNGSTEN_RESISTANCE_EXPONENT
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
  if (inst.definition === 'incandescent_bulb') return tungstenResistance(inst, temperatureC)
  const alpha = readScalarParam(inst, 'temperature_coefficient')
  const baseResistance = readScalarParam(inst, 'resistance')
  if (alpha === undefined || baseResistance === undefined) return undefined
  return baseResistance * (1 + alpha * (temperatureC - STANDARD_AMBIENT_C))
}

/** A part's local ambient (°C): its own `ambient_temperature`, else the project-wide ambient, else
 *  the 25 °C baseline. The part's own value always wins, so one part can sit in a hotter pocket. */
function ambientOf(inst: Instance, projectAmbientC?: number): number {
  return readScalarParam(inst, 'ambient_temperature') ?? projectAmbientC ?? STANDARD_AMBIENT_C
}

/**
 * The temperature to record for a part with no usable θ_JA (no self-heating), or undefined to leave it
 * at the 25 °C baseline. A part with its own ambient_temperature takes that; otherwise a non-baseline
 * project ambient places a part whose resistance follows temperature (thermistor / tempco resistor —
 * exactly the parts resistanceAtTemperature handles). A θ_JA-less junction device isn't placed this
 * way, but junction parts ship a θ_JA and so heat through the self-heating path instead.
 */
function placedAmbient(inst: Instance, projectAmbientC?: number): number | undefined {
  const ambient = ambientOf(inst, projectAmbientC)
  if (readScalarParam(inst, 'ambient_temperature') !== undefined) return ambient
  if (ambient !== STANDARD_AMBIENT_C && resistanceAtTemperature(inst, ambient) !== undefined)
    return ambient
  return undefined
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
        `'${id}' burned OPEN at ${(temperaturesC.get(id) ?? STANDARD_AMBIENT_C).toFixed(0)} °C — ` +
          `the temperature-adjusted resistance fell to ${adjusted.toPrecision(3)} Ω (the linear tempco ` +
          'model is out of range there); a resistor destroyed by overload fails open, so it now stands ' +
          'at 1 GΩ, not a short.',
      )
      adjusted = FAILED_OPEN_RESISTANCE_OHMS
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

/**
 * A world with every temperature-following resistor (thermistor / tempco) set to its resistance at its
 * effective ambient — own ambient_temperature, else the project ambient, else 25 °C — with NO
 * self-heating. The de-energized case a 2-wire ohmmeter measures: a powered-off part sits at the
 * ambient, so the read returns R(ambient), not the 25 °C nominal.
 */
export function worldAtAmbient(world: World, projectAmbientC?: number): World {
  const temperatures = new Map<string, number>()
  for (const inst of world.instances.values()) {
    const ambient = ambientOf(inst, projectAmbientC)
    if (resistanceAtTemperature(inst, ambient) !== undefined) temperatures.set(inst.id, ambient)
  }
  return worldAtTemperatures(world, temperatures, []).world
}

/** Each part's temperature: ambient + P·θ_JA (self-heating), or just its placed ambient (own
 *  ambient_temperature, else the project-wide ambient, else 25 °C). */
function computeTemperatures(
  world: World,
  solution: Solution,
  projectAmbientC?: number,
): Map<string, number> {
  const temperatures = new Map<string, number>()
  for (const inst of world.instances.values()) {
    // An incandescent filament is RADIATION-cooled, not conduction-cooled: its
    // temperature follows the Stefan–Boltzmann T⁴ balance from its real dissipation,
    // not the linear T = ambient + P·θ_JA. (Self-limiting — T grows as P^¼ — which is
    // also what keeps this fixed-point loop convergent for so steep an R(T).)
    if (inst.definition === 'incandescent_bulb') {
      const branch = solution.branches.get(inst.id)
      const volts = acrossVolts(inst, solution)
      if (branch !== undefined && volts !== undefined) {
        const t = bulbFilamentTemperatureC(
          inst,
          Math.abs(branch) * volts,
          ambientOf(inst, projectAmbientC),
        )
        if (t !== undefined) temperatures.set(inst.id, t)
      }
      continue
    }
    // A θ_JA earns the self-heating term P·θ_JA on top of the ambient. A part with no θ_JA still takes
    // its placed ambient (placedAmbient: own ambient_temperature, or a non-baseline project ambient on a
    // temperature-following part); with neither it stays at 25 °C. (computeTransientTemperatures mirrors this.)
    const thetaJa = readScalarParam(inst, 'thermal_resistance_junction_ambient')
    if (thetaJa === undefined || thetaJa <= 0) {
      const placed = placedAmbient(inst, projectAmbientC)
      if (placed !== undefined) temperatures.set(inst.id, placed)
      continue
    }
    const branch = solution.branches.get(inst.id)
    if (branch === undefined) continue

    const volts = acrossVolts(inst, solution)
    if (volts === undefined) continue

    temperatures.set(
      inst.id,
      junctionTemperature(Math.abs(branch) * volts, thetaJa, ambientOf(inst, projectAmbientC)),
    )
  }
  return temperatures
}

export type ElectroThermalOptions = SolveOptions & {
  /** The project-wide ambient (°C) every part falls back to when it sets no ambient_temperature of its
   *  own. Absent ⇒ the 25 °C baseline. A part's own ambient_temperature always overrides it. */
  projectAmbientC?: number
}

/**
 * Solve the circuit with temperature feedback: iterate solve → heat → re-solve
 * to the electro-thermal fixed point. With no thermally-rated parts this reduces
 * to a single plain DC solve (plus one confirmation pass).
 */
export function solveElectroThermal(
  world: World,
  options?: ElectroThermalOptions,
): ElectroThermalResult {
  const warnings: string[] = []
  const projectAmbientC = options?.projectAmbientC
  let temperaturesC = new Map<string, number>()
  let solution: Solution = solveDC(world, options)
  let thermalConverged = false
  let iteration = 0

  for (iteration = 1; iteration <= MAX_THERMAL_ITERATIONS; iteration++) {
    if (solution.status !== 'solved') break

    const next = computeTemperatures(world, solution, projectAmbientC)
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
  /** The project-wide ambient (°C) every part falls back to (see ElectroThermalOptions). */
  projectAmbientC?: number
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
 * A part's AVERAGE absorbed power over the settled record — the per-terminal ledger
 * Σ v·i_into the solver records, time-averaged. Undefined for an unconnected part or
 * a record with no settled samples. (Shared by the θ_JA self-heating and the bulb's
 * radiative balance, so both heat from the same measured dissipation.)
 */
function averageAbsorbedPower(
  inst: Instance,
  result: TransientResult,
  settleSeconds: number,
): number | undefined {
  const connects = inst.connects ?? []
  if (connects.length === 0) return undefined
  let sum = 0
  let samples = 0
  for (const point of result.series) {
    if (point.time < settleSeconds || point.currents === undefined) continue
    let power = 0
    for (const c of connects) {
      power += (point.nodes.get(c.net) ?? 0) * (point.currents.get(`${inst.id}/${c.terminal}`) ?? 0)
    }
    sum += power
    samples++
  }
  return samples === 0 ? undefined : sum / samples
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
  projectAmbientC?: number,
): Map<string, number> {
  const temperatures = new Map<string, number>()
  for (const inst of world.instances.values()) {
    // An incandescent filament heats radiatively from its average dissipation —
    // the time-domain mirror of the DC loop's Stefan–Boltzmann T⁴ balance.
    if (inst.definition === 'incandescent_bulb') {
      const power = averageAbsorbedPower(inst, result, settleSeconds)
      if (power !== undefined) {
        const t = bulbFilamentTemperatureC(
          inst,
          Math.max(0, power),
          ambientOf(inst, projectAmbientC),
        )
        if (t !== undefined) temperatures.set(inst.id, t)
      }
      continue
    }
    const thetaJa = readScalarParam(inst, 'thermal_resistance_junction_ambient')
    if (thetaJa === undefined || thetaJa <= 0) {
      // No self-heating, but a placed ambient still sets the part's temperature (mirrors the DC loop).
      const placed = placedAmbient(inst, projectAmbientC)
      if (placed !== undefined) temperatures.set(inst.id, placed)
      continue
    }
    const power = averageAbsorbedPower(inst, result, settleSeconds)
    if (power === undefined) continue
    // A passive part's average absorbed power can't be negative; clamp the
    // float dust so a reactive part reads ambient, not below it.
    temperatures.set(
      inst.id,
      junctionTemperature(Math.max(0, power), thetaJa, ambientOf(inst, projectAmbientC)),
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
  const projectAmbientC = options.projectAmbientC
  let temperaturesC = new Map<string, number>()
  let result: TransientResult = solveTransient(world, options)
  let thermalConverged = false
  let iteration = 0

  for (iteration = 1; iteration <= MAX_THERMAL_ITERATIONS; iteration++) {
    if (result.status !== 'solved') break

    const next = computeTransientTemperatures(world, result, settleSeconds, projectAmbientC)
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

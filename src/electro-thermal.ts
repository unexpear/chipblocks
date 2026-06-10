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

/**
 * A tempco part's resistance at temperature: R(T) = R₀·(1 + α·ΔT). The ONE
 * place this law lives — the solve loop and every display (Math panel) call
 * it, so what the user reads is what the solver used. Undefined when the part
 * has no tempco/resistance or no temperature is known for it.
 */
export function resistanceAtTemperature(
  inst: Instance,
  temperatureC: number | undefined,
): number | undefined {
  if (temperatureC === undefined) return undefined
  const alpha = readScalarParam(inst, 'temperature_coefficient')
  const baseResistance = readScalarParam(inst, 'resistance')
  if (alpha === undefined || baseResistance === undefined) return undefined
  return baseResistance * (1 + alpha * (temperatureC - STANDARD_AMBIENT_C))
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
    const thetaJa = readScalarParam(inst, 'thermal_resistance_junction_ambient')
    if (thetaJa === undefined || thetaJa <= 0) continue
    const branch = solution.branches.get(inst.id)
    if (branch === undefined) continue

    const volts = acrossVolts(inst, solution)
    if (volts === undefined) continue

    temperatures.set(inst.id, junctionTemperature(Math.abs(branch) * volts, thetaJa))
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

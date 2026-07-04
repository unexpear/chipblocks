import type { World } from '../cross-fk-validator.ts'
import { crtParamsFromInstance, deflectionFraction, gridBrightness } from '../crt-model.ts'
import type { Solution } from '../dc-solver.ts'
import {
  magneticPullForceNewtons,
  magnetomotiveForceAmpereTurns,
  solenoidFluxDensityTesla,
} from '../electromagnet-model.ts'
import {
  inductionMotorOperatingPoint,
  inductionMotorParamsFromInstance,
} from '../induction-motor-model.ts'
import { readEnumParam, readScalarParam } from '../instance-params.ts'
import { laserOpticalPowerW } from '../laser-model.ts'
import { arcLuminousFluxLumens } from '../light.ts'
import {
  generatorOperatingPoint,
  generatorParamsFromInstance,
  motorParamsFromInstance,
  motorSteadyState,
} from '../motor-model.ts'
import { acrossVolts, bulbFilamentTemperatureC, junctionTemperature } from '../thermal-model.ts'
import { junctionCapacitance } from '../varactor-model.ts'

/**
 * Per-part electrical readings from a solved circuit (Sprint 19) — what the
 * Properties panel shows for the selected part: the current THROUGH it, the
 * voltage ACROSS it, and the power it handles. Every simulator (Falstad,
 * EveryCircuit) leads with these; we already solve them, this just collects them.
 *
 *  - current = |branch current| (the solver's per-part branch).
 *  - voltage = |V across the part's terminal pair| (two-terminal parts; a
 *    transistor reads its conducting pair — V_CE for a BJT, V_DS for a MOSFET).
 *  - power   = current × voltage (dissipated for a resistor/LED; delivered for a
 *    source — the sign/direction is implied by the part).
 *  - temperatureC = the part's real temperature from the electro-thermal solve
 *    (its ambient — own or the board's — plus P·θ_JA self-heating), for parts
 *    that declare a thermal resistance, with the declared max alongside so the
 *    panel can show headroom. When no solve temperature is supplied (an analysis
 *    pass) it falls back to the lumped law at the same ambient precedence:
 *    own ambient_temperature, else the board's projectAmbientC, else 25 °C.
 */
export type PartReading = {
  current?: number
  voltage?: number
  power?: number
  opticalOutputW?: number
  junctionCapacitanceF?: number
  magnetomotiveForceA?: number
  magneticFluxDensityT?: number
  magneticForceN?: number
  speedRpm?: number
  torqueNm?: number
  backEmfV?: number
  generatedEmfV?: number
  luminousFluxLm?: number
  slipPercent?: number
  startupCurrentA?: number
  powerFactor?: number
  brightnessPercent?: number
  spotXPercent?: number
  spotYPercent?: number
  mechanicalPowerW?: number
  efficiencyPercent?: number
  temperatureC?: number
  maxTemperatureC?: number
}

export function partReadings(
  world: World,
  solution: Solution,
  temperaturesC?: Map<string, number>,
  projectAmbientC?: number,
): Map<string, PartReading> {
  const readings = new Map<string, PartReading>()
  if (solution.status !== 'solved') return readings

  for (const inst of world.instances.values()) {
    const reading: PartReading = {}

    const branch = solution.branches.get(inst.id)
    if (branch !== undefined) reading.current = Math.abs(branch)

    const volts = acrossVolts(inst, solution)
    if (volts !== undefined) reading.voltage = volts

    if (reading.current !== undefined && reading.voltage !== undefined) {
      reading.power = reading.current * reading.voltage
      // The part's real temperature from the electro-thermal solve. When no solve
      // temperature is supplied (an analysis pass, or a bare solveDC) it falls back to
      // the same law the solve would use, at the SAME ambient precedence: own
      // ambient_temperature, else the board ambient, else the 25 °C default. Most parts
      // self-heat through a θ_JA (conduction); an incandescent filament radiates, so it
      // takes the Stefan–Boltzmann law instead (it has no θ_JA).
      const ambient = readScalarParam(inst, 'ambient_temperature') ?? projectAmbientC
      const thetaJa = readScalarParam(inst, 'thermal_resistance_junction_ambient')
      if (thetaJa !== undefined && thetaJa > 0) {
        reading.temperatureC =
          temperaturesC?.get(inst.id) ?? junctionTemperature(reading.power, thetaJa, ambient)
      } else if (inst.definition === 'incandescent_bulb') {
        const filamentC =
          temperaturesC?.get(inst.id) ?? bulbFilamentTemperatureC(inst, reading.power, ambient)
        if (filamentC !== undefined) reading.temperatureC = filamentC
      }
      if (reading.temperatureC !== undefined) {
        const maxTemperature = readScalarParam(inst, 'max_operating_temperature')
        if (maxTemperature !== undefined) reading.maxTemperatureC = maxTemperature
      }
    }

    // Laser diode: the optical output is the defining, current-dependent reading (zero below the
    // lasing threshold, then a steep rise). threshold_current is the laser-only marker.
    const thresholdCurrent = readScalarParam(inst, 'threshold_current')
    if (thresholdCurrent !== undefined && reading.current !== undefined) {
      const wavelengthNm = readScalarParam(inst, 'peak_wavelength')
      const efficiency = readScalarParam(inst, 'external_quantum_efficiency')
      if (wavelengthNm !== undefined && efficiency !== undefined) {
        reading.opticalOutputW = laserOpticalPowerW(
          reading.current,
          thresholdCurrent,
          efficiency,
          wavelengthNm,
        )
      }
    }

    // Varactor: the voltage-controlled junction capacitance C(V) is the defining reading.
    // junction_capacitance_zero_bias is the varactor-only marker.
    const cj0 = readScalarParam(inst, 'junction_capacitance_zero_bias')
    if (cj0 !== undefined) {
      const vj = readScalarParam(inst, 'junction_potential')
      const m = readScalarParam(inst, 'grading_coefficient')
      const anode = inst.connects?.find((c) => c.terminal === 'anode')?.net
      const cathode = inst.connects?.find((c) => c.terminal === 'cathode')?.net
      if (vj !== undefined && m !== undefined && anode !== undefined && cathode !== undefined) {
        const vJunction = (solution.nodes.get(anode) ?? 0) - (solution.nodes.get(cathode) ?? 0)
        reading.junctionCapacitanceF = junctionCapacitance(vJunction, cj0, vj, m)
      }
    }

    // Electromagnet: a coil's defining output is its magnetic field. The MMF is N·I
    // (ampere-turns); with a core (μ_r), path length and saturation the flux density is
    // B (rolling off at the iron's B_sat); with a pole area, the pull is F = B²·A/2μ₀.
    // `turns` is the electromagnet-only marker.
    const turns = readScalarParam(inst, 'turns')
    if (turns !== undefined && reading.current !== undefined) {
      reading.magnetomotiveForceA = magnetomotiveForceAmpereTurns(turns, reading.current)
      const relativePermeability = readScalarParam(inst, 'relative_permeability')
      const pathLength = readScalarParam(inst, 'magnetic_path_length')
      if (relativePermeability !== undefined && pathLength !== undefined) {
        const fluxDensity = solenoidFluxDensityTesla(
          turns,
          reading.current,
          relativePermeability,
          pathLength,
          readScalarParam(inst, 'saturation_flux_density'),
        )
        reading.magneticFluxDensityT = fluxDensity
        const coreArea = readScalarParam(inst, 'core_area')
        if (coreArea !== undefined) {
          reading.magneticForceN = magneticPullForceNewtons(fluxDensity, coreArea)
        }
      }
    }

    // DC motor: behind its electrical R_eff is a spinning rotor — surface the mechanical
    // operating point (speed, torque, back-EMF, shaft power, efficiency) from the solved
    // terminal voltage. Keyed on the definition so it works in both depths (a design-mode
    // motor has no direct motor_constant — it derives one).
    if (inst.definition === 'dc_motor') {
      const motorParams = motorParamsFromInstance(inst)
      const posNet = inst.connects?.find((c) => c.terminal === 'terminal_positive')?.net
      const negNet = inst.connects?.find((c) => c.terminal === 'terminal_negative')?.net
      if (motorParams !== undefined && posNet !== undefined && negNet !== undefined) {
        const vAcross = (solution.nodes.get(posNet) ?? 0) - (solution.nodes.get(negNet) ?? 0)
        const op = motorSteadyState(vAcross, motorParams)
        reading.speedRpm = (op.speed * 60) / (2 * Math.PI)
        reading.torqueNm = op.torque
        reading.backEmfV = op.backEmf
        reading.mechanicalPowerW = op.mechanicalPowerW
        const electricalPowerW = Math.abs(vAcross * op.current)
        reading.efficiencyPercent =
          electricalPowerW > 0 ? (Math.abs(op.mechanicalPowerW) / electricalPowerW) * 100 : 0
      }
    }

    // Generator (dynamo): the same machine spun the other way — surface the generated EMF,
    // drive speed/torque, mechanical power in and efficiency from the solved terminal voltage.
    if (inst.definition === 'generator') {
      const genParams = generatorParamsFromInstance(inst)
      const posNet = inst.connects?.find((c) => c.terminal === 'terminal_positive')?.net
      const negNet = inst.connects?.find((c) => c.terminal === 'terminal_negative')?.net
      if (genParams !== undefined && posNet !== undefined && negNet !== undefined) {
        const vAcross = (solution.nodes.get(posNet) ?? 0) - (solution.nodes.get(negNet) ?? 0)
        const op = generatorOperatingPoint(vAcross, genParams)
        reading.generatedEmfV = op.emf
        reading.speedRpm = (genParams.driveSpeed * 60) / (2 * Math.PI)
        reading.torqueNm = op.driveTorque
        reading.mechanicalPowerW = op.mechanicalPowerW
        reading.efficiencyPercent = op.efficiency * 100
      }
    }

    // Arc / neon discharge lamp: once struck (the latch is conducting) it burns at its discharge
    // (arc / maintaining) voltage; report the light = efficacy × power. Extinguished → no light.
    if (
      (inst.definition === 'arc_lamp' || inst.definition === 'neon_lamp') &&
      readEnumParam(inst, 'device_state') === 'conducting'
    ) {
      const efficacy = readScalarParam(inst, 'luminous_efficacy') ?? 0
      // Light tracks the REAL burning power (the solved V × I): for a falling carbon arc the burning
      // voltage is the relaxed V_min + B/I, the solved drop already in reading.power — not the flat
      // parameter. For a constant-drop arc/neon the solved drop equals the parameter, so this is the
      // same number as before.
      reading.luminousFluxLm = arcLuminousFluxLumens(reading.power ?? 0, efficacy)
    }

    // Induction motor: its per-phase steady-state operating point — slip, speed, torque, running +
    // locked-rotor current, power, efficiency, power factor — computed at its nameplate supply.
    // Gated on the motor actually being IN the solved circuit (its nets present in the solution):
    // the numbers come from nameplate parameters, so without this gate a floating motor in a pruned
    // sub-circuit would still read as if it were spinning, while every other unsolved part goes
    // honestly blank.
    if (inst.definition === 'induction_motor') {
      const inSolvedCircuit = (inst.connects ?? []).some((c) => solution.nodes.has(c.net))
      const imParams = inSolvedCircuit ? inductionMotorParamsFromInstance(inst) : undefined
      if (imParams !== undefined) {
        const op = inductionMotorOperatingPoint(imParams)
        reading.current = op.statorCurrentRms
        reading.speedRpm = op.rotorRpm
        reading.torqueNm = op.torque
        reading.mechanicalPowerW = op.mechanicalPowerW
        reading.efficiencyPercent = op.efficiency * 100
        reading.slipPercent = op.slip * 100
        reading.startupCurrentA = op.startupCurrentRms
        reading.powerFactor = op.powerFactor
      }
    }

    // CRT: the electron gun's beam (the EHT load + brightness) and where the X/Y deflection lands the
    // spot on the screen, from the solved anode + deflection voltages.
    if (inst.definition === 'crt') {
      const crtParams = crtParamsFromInstance(inst)
      const net = (t: string) => inst.connects?.find((c) => c.terminal === t)?.net
      const cathode = net('cathode')
      const anode = net('anode')
      if (crtParams !== undefined && cathode !== undefined && anode !== undefined) {
        const vCathode = solution.nodes.get(cathode) ?? 0
        const ehtVoltage = (solution.nodes.get(anode) ?? 0) - vCathode
        const brightness = gridBrightness(crtParams.gridBias, crtParams.gridCutoffVoltage)
        reading.voltage = ehtVoltage
        reading.current = crtParams.beamCurrent * brightness
        reading.brightnessPercent = brightness * 100
        const xNet = net('x_deflect')
        const yNet = net('y_deflect')
        const vX = xNet !== undefined ? (solution.nodes.get(xNet) ?? 0) - vCathode : 0
        const vY = yNet !== undefined ? (solution.nodes.get(yNet) ?? 0) - vCathode : 0
        const sens = crtParams.deflectionSensitivity
        reading.spotXPercent =
          deflectionFraction(vX, sens, ehtVoltage, crtParams.ratedAnodeVoltage) * 100
        reading.spotYPercent =
          deflectionFraction(vY, sens, ehtVoltage, crtParams.ratedAnodeVoltage) * 100
      }
    }

    if (reading.current !== undefined || reading.voltage !== undefined) {
      readings.set(inst.id, reading)
    }
  }
  return readings
}

export type CrtSpot = { x: number; y: number; i: number }

/**
 * The CRT spot's locus over a transient run — the live trace (the next rung past the single DC spot).
 * For each solved instant it reads the X/Y deflection-plate voltages and the anode (EHT) from that
 * frame's node voltages and turns them into a screen position with the SAME deflection law the DC spot
 * uses (deflectionFraction). So an X-ramp + a Y-signal draws the waveform, and two sines draw a
 * Lissajous figure — exactly what a real scope tube does. Each point also carries i = the beam
 * INTENSITY 0..1 at that instant: if a VIDEO signal is wired to the grid it is that grid voltage's
 * brightness (the Z-axis that paints a raster TV point by point), else the constant grid-bias level.
 * Points are screen fractions (−1..1 across / up). Empty when the id isn't a resolvable CRT.
 */
export function crtSpotTrace(
  world: World,
  instanceId: string,
  series: readonly { nodes: Map<string, number> }[],
): { points: CrtSpot[]; brightness: number } {
  const inst = world.instances.get(instanceId)
  const p = inst === undefined ? undefined : crtParamsFromInstance(inst)
  if (inst === undefined || p === undefined) return { points: [], brightness: 0 }
  const net = (t: string) => inst.connects?.find((c) => c.terminal === t)?.net
  const anodeNet = net('anode')
  const cathodeNet = net('cathode')
  if (anodeNet === undefined || cathodeNet === undefined) return { points: [], brightness: 0 }
  const xNet = net('x_deflect')
  const yNet = net('y_deflect')
  const gridNet = net('grid')
  // brightness = the static grid-bias level — the DC spot, and the fallback when no video is wired.
  const brightness = gridBrightness(p.gridBias, p.gridCutoffVoltage)
  const points = series.map(({ nodes }) => {
    const at = (n: string | undefined) => (n === undefined ? 0 : (nodes.get(n) ?? 0))
    const vCathode = at(cathodeNet)
    const vAnode = at(anodeNet) - vCathode
    const vX = xNet === undefined ? 0 : at(xNet) - vCathode
    const vY = yNet === undefined ? 0 : at(yNet) - vCathode
    // INTENSITY at this instant: a video wired to the grid sets the brightness point-by-point (the
    // way a TV paints each spot); with nothing wired it is the constant grid-bias level.
    const i =
      gridNet === undefined
        ? brightness
        : gridBrightness(at(gridNet) - vCathode, p.gridCutoffVoltage)
    return {
      x: deflectionFraction(vX, p.deflectionSensitivity, vAnode, p.ratedAnodeVoltage),
      y: deflectionFraction(vY, p.deflectionSensitivity, vAnode, p.ratedAnodeVoltage),
      i,
    }
  })
  return { points, brightness }
}

/** Every CRT in a world → its live beam trace over a transient run. One place the scope, the CRT-TV
 *  raster demo, the timeline scrub, and the mixed-signal co-sim all share (one trace per tube). */
export function buildCrtTraces(
  world: World,
  series: readonly { nodes: Map<string, number> }[],
): Map<string, { points: CrtSpot[]; brightness: number }> {
  const traces = new Map<string, { points: CrtSpot[]; brightness: number }>()
  for (const [id, inst] of world.instances)
    if (inst.definition === 'crt') traces.set(id, crtSpotTrace(world, id, series))
  return traces
}

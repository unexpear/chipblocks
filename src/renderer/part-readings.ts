import type { World } from '../cross-fk-validator.ts'
import type { Solution } from '../dc-solver.ts'
import { readScalarParam } from '../instance-params.ts'
import { laserOpticalPowerW } from '../laser-model.ts'
import { acrossVolts, junctionTemperature } from '../thermal-model.ts'
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
      const thetaJa = readScalarParam(inst, 'thermal_resistance_junction_ambient')
      if (thetaJa !== undefined && thetaJa > 0) {
        // The part's real temperature from the electro-thermal solve — its ambient (own or the
        // board's) plus self-heating. When no solve temperature is supplied (an analysis pass, or
        // a bare solveDC) it falls back to the lumped law at the SAME ambient the solve would use:
        // own ambient_temperature, else the board ambient, else junctionTemperature's 25 °C default.
        reading.temperatureC =
          temperaturesC?.get(inst.id) ??
          junctionTemperature(
            reading.power,
            thetaJa,
            readScalarParam(inst, 'ambient_temperature') ?? projectAmbientC,
          )
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

    if (reading.current !== undefined || reading.voltage !== undefined) {
      readings.set(inst.id, reading)
    }
  }
  return readings
}

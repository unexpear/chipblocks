import type { World } from '../cross-fk-validator.ts'
import type { Solution } from '../dc-solver.ts'
import { readScalarParam } from '../instance-params.ts'
import { acrossVolts, junctionTemperature } from '../thermal-model.ts'

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
 *  - temperatureC = the lumped thermal model (stage 7): 25 °C ambient + P·θ_JA,
 *    for parts that declare a thermal resistance (with the declared max alongside
 *    so the panel can show headroom).
 */
export type PartReading = {
  current?: number
  voltage?: number
  power?: number
  temperatureC?: number
  maxTemperatureC?: number
}

export function partReadings(world: World, solution: Solution): Map<string, PartReading> {
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
        reading.temperatureC = junctionTemperature(reading.power, thetaJa)
        const maxTemperature = readScalarParam(inst, 'max_operating_temperature')
        if (maxTemperature !== undefined) reading.maxTemperatureC = maxTemperature
      }
    }

    if (reading.current !== undefined || reading.voltage !== undefined) {
      readings.set(inst.id, reading)
    }
  }
  return readings
}

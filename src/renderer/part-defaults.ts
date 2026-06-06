import type { Instance } from '../cross-fk-validator.ts'
import { readScalarParam } from '../instance-params.ts'

/**
 * Part parameter defaults + display (Sprint 19 S19-v3-20).
 *
 * A part dragged from the palette is a real catalog *definition* but starts with
 * no parameter values. This gives a freshly-dropped part a real, cited default
 * set (the anti-placeholder rule: defaults must be useful, cited, typed, and
 * unit-valid — the user edits them, the solver reads them), and a headline value
 * to show on the part so it reads as real.
 *
 * Values match the catalog's real instances (resistor 100 Ω fixture, 9 V 6LR61
 * battery, 5 mm red LED). Defaults pick common standard values, cited inline.
 */

export type Parameters = NonNullable<Instance['parameters']>

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

const DEFAULTS: Record<string, Parameters> = {
  resistor: {
    // 220 Ω — E12 standard value, the classic LED current-limiting resistor.
    resistance: scalar(220, 'ohm'),
    tolerance_percent: scalar(5, 'percent'),
    power_rating: scalar(0.25, 'watt'),
  },
  power_source: {
    // 9 V alkaline (6LR61), per ANSI/IEC 60086-2 — same family as the anchor battery.
    nominal_voltage: scalar(9, 'volt'),
    internal_resistance: scalar(1, 'ohm'),
  },
  led: {
    // Typical 5 mm red LED (Kingbright WP7113SRD-D class): 2.0 V at 20 mA max.
    forward_voltage: scalar(2.0, 'volt'),
    max_forward_current: scalar(0.02, 'ampere'),
  },
  led_uv_algan: {
    // AlGaN UV LED: higher forward voltage (~3.4 V) at 20 mA.
    forward_voltage: scalar(3.4, 'volt'),
    max_forward_current: scalar(0.02, 'ampere'),
  },
}

/** A real, cited default parameter set for a freshly-dropped part (a fresh copy; editable). */
export function defaultParameters(definition: string): Parameters {
  const preset = DEFAULTS[definition]
  return preset ? (JSON.parse(JSON.stringify(preset)) as Parameters) : {}
}

// readScalarParam reads off an Instance; a dropped part has only its parameters,
// so wrap them — readScalarParam only touches `.parameters`.
const amountOf = (parameters: Parameters | undefined, name: string): number | undefined =>
  parameters ? readScalarParam({ parameters } as unknown as Instance, name) : undefined

/** Component resistance formatted Ω / kΩ / MΩ (distinct from a wire's mΩ scale). */
export function formatComponentOhms(ohms: number): string {
  if (ohms >= 1e6) return `${(ohms / 1e6).toFixed(2)} MΩ`
  if (ohms >= 1e3) return `${(ohms / 1e3).toFixed(2)} kΩ`
  return `${ohms} Ω`
}

/** The headline value to show on a part (resistance / supply voltage / forward voltage). */
export function primaryValue(
  definition: string,
  parameters: Parameters | undefined,
): string | null {
  if (definition === 'resistor') {
    const r = amountOf(parameters, 'resistance')
    return r === undefined ? null : formatComponentOhms(r)
  }
  if (definition === 'power_source') {
    const v = amountOf(parameters, 'nominal_voltage')
    return v === undefined ? null : `${v} V`
  }
  if (definition === 'led' || definition === 'led_uv_algan') {
    const v = amountOf(parameters, 'forward_voltage')
    return v === undefined ? null : `${v} V`
  }
  return null
}

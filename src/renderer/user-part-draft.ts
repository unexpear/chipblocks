import type { Parameters } from './part-defaults.ts'
import {
  isReservedBuiltinId,
  isUserPart,
  type PinElectrical,
  type PinSide,
  type UserPart,
} from './user-parts.ts'

/**
 * The PURE half of the user-part authoring form: turn the raw form fields into a validated UserPart
 * (or a plain-language error). No React here, so the validation + id generation is trivially testable.
 * The editor component (user-part-editor.tsx) owns the inputs + preview and calls this on Save.
 */

export type PinInput = { name: string; side: PinSide; electrical: PinElectrical }
export type ParamInput = { name: string; amount: string; unit: string }
export type UserPartInput = {
  name: string
  designatorPrefix: string
  pins: PinInput[]
  params: ParamInput[]
  /** The chosen board footprint id (from the editor's picker); empty/absent ⇒ no footprint. */
  footprintId?: string
  /** The real device this part behaves as (slice 4b): the device id + which PIN INDEX each of the
   *  device's terminals maps to. Empty definition ⇒ no behaviour (stays a black box). */
  behavesAs?: { definition: string; terminals: Record<string, number> }
}

/**
 * The built-in devices a custom part can BEHAVE AS — a curated set of solvable primitives with their
 * terminal names. The editor offers these; the draft builder validates against them. (A cross-check test
 * asserts these terminal names match the canvas's terminalsOf, so this list can't silently drift.)
 */
export const BEHAVIOUR_DEVICES: { definition: string; label: string; terminals: string[] }[] = [
  { definition: 'resistor', label: 'Resistor', terminals: ['terminal_a', 'terminal_b'] },
  { definition: 'capacitor', label: 'Capacitor', terminals: ['terminal_a', 'terminal_b'] },
  { definition: 'inductor', label: 'Inductor', terminals: ['terminal_a', 'terminal_b'] },
  { definition: 'thermistor', label: 'Thermistor', terminals: ['terminal_a', 'terminal_b'] },
  { definition: 'diode_silicon_rectifier', label: 'Diode', terminals: ['anode', 'cathode'] },
  { definition: 'led', label: 'LED', terminals: ['anode', 'cathode'] },
]

/** A definition-id / terminal-id slug: lowercase, non-alphanumerics collapse to a single underscore. */
export function slug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/** Generate a unique terminal id per pin — the slug of its name, or pinN, deduped within the part. */
function pinIds(pins: PinInput[]): string[] {
  const used = new Set<string>()
  return pins.map((pin, i) => {
    const base = slug(pin.name) || `pin${i + 1}`
    let id = base
    let n = 2
    while (used.has(id)) id = `${base}_${n++}`
    used.add(id)
    return id
  })
}

export type DraftResult = { ok: true; part: UserPart } | { ok: false; error: string }

/**
 * Validate + assemble a UserPart from the form fields. Fails (with a message the form shows) on: an
 * empty name, a name that slugs to nothing or to a built-in / already-taken id, or zero pins. Default
 * values are optional and typed as scalars; per the object model a user's own values may be rough
 * (typed + unit-valid), so no citation is required here.
 */
export function buildUserPartDraft(input: UserPartInput): DraftResult {
  const name = input.name.trim()
  if (name === '') return { ok: false, error: 'Give the part a name.' }
  const id = slug(name)
  if (id === '') return { ok: false, error: 'The name needs at least one letter or number.' }
  if (isReservedBuiltinId(id))
    return { ok: false, error: `“${name}” is a built-in part’s name — pick another.` }
  if (isUserPart(id)) return { ok: false, error: `You already have a part named “${name}”.` }

  if (input.pins.length === 0) return { ok: false, error: 'Add at least one pin.' }

  const ids = pinIds(input.pins)
  const userPins = input.pins.map((pin, i) => ({
    id: ids[i] as string,
    name: pin.name.trim(),
    side: pin.side,
    electrical: pin.electrical,
  }))

  const parameters: Parameters = {}
  const usedParam = new Set<string>()
  for (const row of input.params) {
    const key = slug(row.name)
    const amount = Number(row.amount)
    if (key === '' || row.amount.trim() === '' || !Number.isFinite(amount)) continue
    if (usedParam.has(key)) continue
    usedParam.add(key)
    parameters[key] = { value: { kind: 'scalar', amount, unit: row.unit.trim() } }
  }

  // The real behaviour (optional): resolve each of the device's terminals to a REAL pin id (the editor
  // maps by pin INDEX; the final ids are known only here). Every terminal must map to a valid pin.
  let behavesAs: UserPart['behavesAs']
  const requested = input.behavesAs
  if (requested !== undefined && requested.definition !== '') {
    const device = BEHAVIOUR_DEVICES.find((d) => d.definition === requested.definition)
    if (device === undefined) return { ok: false, error: 'That behaviour device isn’t supported.' }
    const terminals: Record<string, string> = {}
    const usedPins = new Set<string>()
    for (const terminal of device.terminals) {
      const pinIndex = requested.terminals[terminal]
      const pin = pinIndex === undefined ? undefined : userPins[pinIndex]
      if (pin === undefined) {
        return {
          ok: false,
          error: `Map the ${device.label}’s “${terminal.replace(/_/g, ' ')}” to a pin.`,
        }
      }
      if (usedPins.has(pin.id)) {
        return { ok: false, error: `Each ${device.label} terminal needs a DIFFERENT pin.` }
      }
      usedPins.add(pin.id)
      terminals[terminal] = pin.id
    }
    behavesAs = { definition: device.definition, terminals }
  }

  const designatorPrefix = input.designatorPrefix.trim().toUpperCase() || 'U'
  const footprintId = input.footprintId?.trim()
  const part: UserPart = {
    id,
    name,
    designatorPrefix,
    ...(footprintId ? { footprintId } : {}),
    ...(behavesAs ? { behavesAs } : {}),
    pins: userPins,
    ...(usedParam.size > 0 ? { parameters } : {}),
  }
  return { ok: true, part }
}

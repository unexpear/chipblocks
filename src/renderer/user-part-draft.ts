import { type BlockData, isOutputDrive } from './blocks.ts'
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

export type PinInput = {
  name: string
  side: PinSide
  electrical: PinElectrical
  /** Which footprint pad this pin solders to, as the package labels it. Blank/absent = work it out. */
  pad?: string
}
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

/** The shared name→definition-id rules: non-empty, slugs to something, and no clash with a built-in or
 *  an existing custom part. Both builders (the form and save-block-as-part) enforce the same rules. */
function resolvePartId(
  rawName: string,
): { ok: true; id: string; name: string } | { ok: false; error: string } {
  const name = rawName.trim()
  if (name === '') return { ok: false, error: 'Give the part a name.' }
  const id = slug(name)
  if (id === '') return { ok: false, error: 'The name needs at least one letter or number.' }
  if (isReservedBuiltinId(id))
    return { ok: false, error: `“${name}” is a built-in part’s name — pick another.` }
  if (isUserPart(id)) return { ok: false, error: `You already have a part named “${name}”.` }
  return { ok: true, id, name }
}

/**
 * Validate + assemble a UserPart from the form fields. Fails (with a message the form shows) on: an
 * empty name, a name that slugs to nothing or to a built-in / already-taken id, or zero pins. Default
 * values are optional and typed as scalars; per the object model a user's own values may be rough
 * (typed + unit-valid), so no citation is required here.
 */
export function buildUserPartDraft(input: UserPartInput): DraftResult {
  const named = resolvePartId(input.name)
  if (!named.ok) return named
  const { id, name } = named

  if (input.pins.length === 0) return { ok: false, error: 'Add at least one pin.' }

  const ids = pinIds(input.pins)
  const userPins = input.pins.map((pin, i) => {
    const pad = pin.pad?.trim() ?? ''
    return {
      id: ids[i] as string,
      name: pin.name.trim(),
      side: pin.side,
      electrical: pin.electrical,
      // Blank means "work it out" (by name, then by order), not "a pad called empty string".
      ...(pad.length > 0 ? { pad } : {}),
    }
  })

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

/**
 * The SOLVE CORE of a block — exactly what a custom part's internals persist: the parts, the wires
 * (with their drawn geometry, so inner wire lengths stay physically real), and the ports. Presentation
 * extras a canvas block can carry (display faces, gate symbols, pin drive/power marks, box size) are
 * deliberately NOT part of a saved custom part's internals — the part presents through its own pins —
 * so what saves is exactly what loads (the runtime validator enforces this same core shape). Deep
 * copies throughout: later edits to the source block can't silently change the saved part.
 */
function coreBlockData(block: BlockData): BlockData {
  return {
    name: block.name,
    origin: { x: block.origin.x, y: block.origin.y },
    nodes: block.nodes.map((n) => ({
      id: n.id,
      definition: n.definition,
      x: n.x,
      y: n.y,
      ...(n.rotation ? { rotation: n.rotation } : {}),
      ...(n.parameters ? { parameters: JSON.parse(JSON.stringify(n.parameters)) } : {}),
      ...(n.block ? { block: coreBlockData(n.block) } : {}),
    })),
    edges: block.edges.map((e) => ({
      id: e.id,
      source: e.source,
      // Normalise a live block's possibly-undefined handle to null: JSON.stringify DROPS an undefined
      // key, and the load-time validator (rightly) rejects a missing handle — the part would vanish.
      sourceHandle: e.sourceHandle ?? null,
      target: e.target,
      targetHandle: e.targetHandle ?? null,
      ...(e.waypoints ? { waypoints: e.waypoints.map((w) => ({ ...w })) } : {}),
      ...(e.curved ? { curved: true } : {}),
      ...(typeof e.curveRadius === 'number' ? { curveRadius: e.curveRadius } : {}),
    })),
    ports: block.ports.map((p) => ({
      id: p.id,
      label: p.label,
      ...(p.name ? { name: p.name } : {}),
      side: p.side,
      inner: { nodeId: p.inner.nodeId, handleId: p.inner.handleId },
    })),
  }
}

/**
 * Make a custom part FROM a circuit block (slice 4b Model B — the fuller graduation): the block's real
 * internal circuit becomes the part's internals, and its ports become the part's pins 1:1 (same ids, so
 * a wire on a pin reaches the right internal terminal when the solve flattens it).
 *
 * A NAMED net label inside the saved circuit keeps the schematic-wide rail convention: every label of
 * that name on a sheet is ONE net, so a "VCC" label inside the part ties to the sheet's VCC rail — and
 * two instances of the part share it. That is how the label works everywhere (a real schematic symbol),
 * deliberately not namespaced per instance.
 */
export function userPartFromBlock(
  rawName: string,
  designatorPrefix: string,
  block: BlockData,
): DraftResult {
  const named = resolvePartId(rawName)
  if (!named.ok) return named
  if (block.ports.length === 0) {
    return { ok: false, error: 'The block needs at least one pin (wire to it, or add pins first).' }
  }
  const pins = block.ports.map((port) => ({
    id: port.id,
    name: (port.name ?? '').trim() || port.label,
    side: port.side,
    // The port's drive says which way signal flows; a power pin is a supply-in. Documentation-level,
    // same as form-authored pins.
    electrical: (port.kind === 'power_positive' || port.kind === 'power_negative'
      ? 'power_in'
      : port.drive === 'input'
        ? 'input'
        : isOutputDrive(port.drive)
          ? 'output'
          : 'passive') as PinElectrical,
  }))
  const part: UserPart = {
    id: named.id,
    name: named.name,
    designatorPrefix: designatorPrefix.trim().toUpperCase() || 'U',
    pins,
    internal: coreBlockData(block),
  }
  return { ok: true, part }
}

import type { Parameters } from './part-defaults.ts'
import type { PinElectrical, PinSide, UserPart } from './user-parts.ts'

/**
 * The runtime validator for a persisted user part (user-made parts, slice 3). It mirrors
 * `schemas/user-part.schema.json` — the schema is the canonical spec (checked by ajv in the tests, the
 * same engine + strictness the catalog uses), and this is the hand-written enforcement that runs at
 * load time (the app has no runtime ajv on purpose: the packaged CSP forbids the eval ajv compiles to).
 *
 * IMPORTANT: this module must stay import-pure (no @xyflow / React value imports) — `circuit-file.ts`
 * pulls it in, and that file is imported by the Electron MAIN (Node) process, which can't load React.
 * The UserPart / Pin* imports above are TYPE-ONLY (erased at compile), so nothing React reaches Node.
 *
 * It is strict on the shape of known fields (a bad id/pin/param → the part is rejected, i.e. dropped on
 * load, never half-loaded) and lenient on UNKNOWN keys (ignored, so a newer file still loads its parts).
 */

const ID_RE = /^[a-z0-9](?:[a-z0-9_]*[a-z0-9])?$/
const SIDES: readonly PinSide[] = ['left', 'right', 'top', 'bottom']
const ELECTRICAL: readonly PinElectrical[] = [
  'input',
  'output',
  'bidirectional',
  'passive',
  'power_in',
  'power_out',
  'unspecified',
]
const PARAM_KEY_RE = /^[a-z][a-z0-9_]*$/

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)

function cleanParameters(raw: unknown): Parameters | null | undefined {
  if (raw === undefined) return undefined
  if (!isObj(raw)) return null
  const out: Parameters = {}
  for (const [key, entry] of Object.entries(raw)) {
    if (!PARAM_KEY_RE.test(key) || !isObj(entry) || !isObj(entry.value)) return null
    const v = entry.value
    if (
      v.kind !== 'scalar' ||
      typeof v.amount !== 'number' ||
      !Number.isFinite(v.amount) ||
      typeof v.unit !== 'string'
    ) {
      return null
    }
    out[key] = { value: { kind: 'scalar', amount: v.amount, unit: v.unit } }
  }
  return out
}

/**
 * Validate + sanitise one persisted user part. Returns a clean UserPart (only the known fields) or null
 * if it violates the shape. Null entries are DROPPED on load — the rest of the file still loads.
 */
export function validateUserPart(raw: unknown): UserPart | null {
  if (!isObj(raw)) return null
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) return null
  if (typeof raw.name !== 'string' || raw.name.length < 1) return null
  if (
    typeof raw.designatorPrefix !== 'string' ||
    raw.designatorPrefix.length < 1 ||
    raw.designatorPrefix.length > 8
  ) {
    return null
  }
  if (raw.description !== undefined && typeof raw.description !== 'string') return null
  if (!Array.isArray(raw.pins) || raw.pins.length < 1) return null

  const pins: UserPart['pins'] = []
  const seen = new Set<string>()
  for (const p of raw.pins) {
    if (!isObj(p)) return null
    if (typeof p.id !== 'string' || p.id.length < 1) return null
    if (seen.has(p.id)) return null // two terminals can't share an id
    seen.add(p.id)
    if (typeof p.name !== 'string') return null
    if (typeof p.side !== 'string' || !SIDES.includes(p.side as PinSide)) return null
    if (typeof p.electrical !== 'string' || !ELECTRICAL.includes(p.electrical as PinElectrical)) {
      return null
    }
    pins.push({
      id: p.id,
      name: p.name,
      side: p.side as PinSide,
      electrical: p.electrical as PinElectrical,
    })
  }

  const parameters = cleanParameters(raw.parameters)
  if (parameters === null) return null

  return {
    id: raw.id,
    name: raw.name,
    designatorPrefix: raw.designatorPrefix,
    ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
    pins,
    ...(parameters && Object.keys(parameters).length > 0 ? { parameters } : {}),
  }
}

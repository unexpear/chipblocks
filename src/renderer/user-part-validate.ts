import type { BlockData } from './blocks.ts'
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

const isFiniteNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

/** Hand-edited files can nest internals arbitrarily; past this depth the part is rejected (a legit
 *  module-of-modules stays shallow — this is a runaway/cycle backstop, not a design limit). */
const MAX_INTERNAL_DEPTH = 8

/**
 * Validate one level of a persisted internal circuit — the SOLVE CORE shape userPartFromBlock writes
 * (name/origin/nodes/edges/ports, nothing else). Strict: any malformed piece rejects the whole block
 * (→ the part is dropped on load, never half-loaded with a broken circuit inside).
 *
 * KNOWN LIMIT: `port.inner.handleId` is checked to exist as a string on a REAL inner node, but not to
 * be a real terminal OF that node's device (the per-definition terminal catalog lives in the renderer's
 * symbols module, which this import-pure file can't reach). A hand-edited handle like 'terminal_z' on a
 * resistor therefore loads; wiring that pin puts a phantom connection on the device, which the solver
 * then skips (same pre-existing behaviour as a canvas block with a hand-broken port). The app's own
 * writer can't produce this — ports come from real drawn wires.
 */
function cleanBlockCore(raw: unknown, depth: number): BlockData | null {
  if (depth <= 0) return null
  if (!isObj(raw)) return null
  if (typeof raw.name !== 'string') return null
  if (!isObj(raw.origin) || !isFiniteNum(raw.origin.x) || !isFiniteNum(raw.origin.y)) return null
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges) || !Array.isArray(raw.ports))
    return null

  const nodeIds = new Set<string>()
  const nodes: BlockData['nodes'] = []
  for (const n of raw.nodes) {
    if (!isObj(n)) return null
    if (typeof n.id !== 'string' || n.id.length < 1 || nodeIds.has(n.id)) return null
    nodeIds.add(n.id)
    if (typeof n.definition !== 'string' || n.definition.length < 1) return null
    if (!isFiniteNum(n.x) || !isFiniteNum(n.y)) return null
    if (n.rotation !== undefined && !isFiniteNum(n.rotation)) return null
    const parameters = cleanParameters(n.parameters)
    if (parameters === null) return null
    let block: BlockData | undefined
    if (n.block !== undefined) {
      const nested = cleanBlockCore(n.block, depth - 1)
      if (nested === null) return null
      block = nested
    }
    nodes.push({
      id: n.id,
      definition: n.definition,
      x: n.x,
      y: n.y,
      ...(n.rotation !== undefined ? { rotation: n.rotation } : {}),
      ...(parameters && Object.keys(parameters).length > 0 ? { parameters } : {}),
      ...(block ? { block } : {}),
    })
  }

  const edges: BlockData['edges'] = []
  for (const e of raw.edges) {
    if (!isObj(e)) return null
    if (typeof e.id !== 'string' || typeof e.source !== 'string' || typeof e.target !== 'string')
      return null
    if (e.sourceHandle !== null && typeof e.sourceHandle !== 'string') return null
    if (e.targetHandle !== null && typeof e.targetHandle !== 'string') return null
    let waypoints: { id: string; x: number; y: number }[] | undefined
    if (e.waypoints !== undefined) {
      if (!Array.isArray(e.waypoints)) return null
      waypoints = []
      for (const w of e.waypoints) {
        if (!isObj(w) || typeof w.id !== 'string' || !isFiniteNum(w.x) || !isFiniteNum(w.y))
          return null
        waypoints.push({ id: w.id, x: w.x, y: w.y })
      }
    }
    if (e.curved !== undefined && e.curved !== true) return null
    if (e.curveRadius !== undefined && !isFiniteNum(e.curveRadius)) return null
    edges.push({
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle,
      target: e.target,
      targetHandle: e.targetHandle,
      ...(waypoints && waypoints.length > 0 ? { waypoints } : {}),
      ...(e.curved === true ? { curved: true } : {}),
      ...(e.curveRadius !== undefined ? { curveRadius: e.curveRadius as number } : {}),
    })
  }

  const portIds = new Set<string>()
  const ports: BlockData['ports'] = []
  for (const p of raw.ports) {
    if (!isObj(p)) return null
    if (typeof p.id !== 'string' || p.id.length < 1 || portIds.has(p.id)) return null
    portIds.add(p.id)
    if (typeof p.label !== 'string') return null
    if (p.name !== undefined && typeof p.name !== 'string') return null
    if (typeof p.side !== 'string' || !SIDES.includes(p.side as PinSide)) return null
    if (!isObj(p.inner)) return null
    // A port must expose a REAL internal terminal — an unknown inner node would leave the pin dead.
    if (typeof p.inner.nodeId !== 'string' || !nodeIds.has(p.inner.nodeId)) return null
    if (typeof p.inner.handleId !== 'string' || p.inner.handleId.length < 1) return null
    ports.push({
      id: p.id,
      label: p.label,
      ...(p.name !== undefined ? { name: p.name } : {}),
      side: p.side as PinSide,
      inner: { nodeId: p.inner.nodeId, handleId: p.inner.handleId },
    })
  }

  return { name: raw.name, origin: { x: raw.origin.x, y: raw.origin.y }, nodes, edges, ports }
}

/** Validate an optional internal circuit. The top level's ports must be 1:1 with the part's PINS (same
 *  ids) — that's what routes a wire on a pin to the real internal terminal. undefined = absent. */
function cleanInternal(raw: unknown, pinIds: ReadonlySet<string>): BlockData | null | undefined {
  if (raw === undefined) return undefined
  const block = cleanBlockCore(raw, MAX_INTERNAL_DEPTH)
  if (block === null) return null
  const portIds = new Set(block.ports.map((p) => p.id))
  if (portIds.size !== pinIds.size) return null
  for (const id of portIds) {
    if (!pinIds.has(id)) return null
  }
  return block
}

/** Validate an optional behavesAs: a device id + a terminal→pin map whose pins must ACTUALLY EXIST on
 *  the part (an extra check the JSON Schema can't express). undefined = absent; null = invalid → reject. */
function cleanBehavesAs(
  raw: unknown,
  pinIds: ReadonlySet<string>,
): UserPart['behavesAs'] | null | undefined {
  if (raw === undefined) return undefined
  if (!isObj(raw)) return null
  if (typeof raw.definition !== 'string' || raw.definition.length < 1) return null
  if (!isObj(raw.terminals)) return null
  const terminals: Record<string, string> = {}
  const usedPins = new Set<string>()
  for (const [terminal, pinId] of Object.entries(raw.terminals)) {
    // Each mapped pin must EXIST on the part and be used by only ONE terminal (a shared pin would leave
    // another terminal unconnected — a degenerate device). Both are checks JSON Schema can't express.
    if (typeof pinId !== 'string' || !pinIds.has(pinId) || usedPins.has(pinId)) return null
    usedPins.add(pinId)
    terminals[terminal] = pinId
  }
  if (Object.keys(terminals).length < 1) return null
  return { definition: raw.definition, terminals }
}

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
  if (
    raw.footprintId !== undefined &&
    (typeof raw.footprintId !== 'string' || raw.footprintId.length < 1)
  )
    return null
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

  const behavesAs = cleanBehavesAs(raw.behavesAs, seen)
  if (behavesAs === null) return null

  const internal = cleanInternal(raw.internal, seen)
  if (internal === null) return null

  // A part simulates ONE way: as a single device (behavesAs) or as its internal circuit — never both.
  if (behavesAs !== undefined && internal !== undefined) return null

  return {
    id: raw.id,
    name: raw.name,
    designatorPrefix: raw.designatorPrefix,
    ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
    ...(typeof raw.footprintId === 'string' ? { footprintId: raw.footprintId } : {}),
    ...(behavesAs ? { behavesAs } : {}),
    ...(internal ? { internal } : {}),
    pins,
    ...(parameters && Object.keys(parameters).length > 0 ? { parameters } : {}),
  }
}

import { Position } from '@xyflow/react'
import type { BlockData } from './blocks.ts'
import type { Parameters } from './part-defaults.ts'

/**
 * USER-MADE PARTS — the data model + symbol GEOMETRY for a part the user authors (not hardcoded in
 * symbols.tsx). A user part draws itself from a PIN SPEC — a labelled box with pins on chosen sides —
 * so a definition that isn't in the code can still render on the canvas and wire up. This is the
 * foundation the authoring UI + persistence build on.
 *
 * Honesty: a user part is a BLACK BOX here — it places, wires, appears in the ratsnest, and exports,
 * but the solver honestly reports it "unsupported" (it reads only the placed instance's definition-id +
 * parameters + connections, never the definition, so an unknown part never crashes or fakes a solve).
 * Real simulatable behaviour is a later layer.
 */

/** Which edge of the body a pin sits on — drives both the drawn stub and the wire-handle position. */
export type PinSide = 'left' | 'right' | 'top' | 'bottom'

/** A pin's electrical role — documentation for now (the KiCad pin-type set); not yet read by the solver. */
export type PinElectrical =
  | 'input'
  | 'output'
  | 'bidirectional'
  | 'passive'
  | 'power_in'
  | 'power_out'
  | 'unspecified'

export const PIN_ELECTRICAL_TYPES: readonly PinElectrical[] = [
  'passive',
  'input',
  'output',
  'bidirectional',
  'power_in',
  'power_out',
  'unspecified',
]

export type UserPin = {
  /** Stable id — the wire-handle id + the terminal name the ratsnest/solver see. */
  id: string
  /** Label drawn inside the body next to the pin. */
  name: string
  side: PinSide
  electrical: PinElectrical
  /**
   * Which PAD of the part's footprint this pin solders to, named as the package labels it ('1', 'A5').
   * A real schematic symbol carries both — the pin's NAME says what the signal is (VCC, IO_12), the pad
   * says where it physically lands, and on a 48-pin chip those are nothing like each other. Omitted ⇒
   * fall back to matching the pin's name against a pad, then to declaration order (pin 1 → pad 1),
   * which is what a two-pin part wants and what parts authored before this existed rely on.
   */
  pad?: string
}

/** A user-authored part definition — the minimum to place + wire (its own kind is a black-box device). */
export type UserPart = {
  /** The definition id — unique, the string a placed node carries in data.definition. */
  id: string
  name: string
  /** Reference-designator letter(s) — 'U' for an IC, 'J' for a connector, etc. */
  designatorPrefix: string
  description?: string
  pins: UserPin[]
  /** The board package this part lands on (a BUILTIN_FOOTPRINTS id) — its pins map to the footprint's
   *  pads in declaration order. Absent ⇒ the part has no footprint yet, so it stays off the board. */
  footprintId?: string
  /**
   * Optional REAL, simulatable behaviour (user-made parts, slice 4b): the part behaves as a built-in
   * device, so the solver runs that device's real physics instead of reporting a black box. `definition`
   * is the built-in device id (e.g. 'resistor'); `terminals` maps each of that device's terminal names
   * to one of this part's pin ids. Absent ⇒ still a black box (honestly unsolved). Real device physics —
   * no faking; the part is graduating from a black box toward a full definition.
   */
  behavesAs?: {
    definition: string
    /** deviceTerminalName → this part's pin id (e.g. { terminal_a: 'p1', terminal_b: 'p2' }). */
    terminals: Record<string, string>
  }
  /**
   * Optional REAL internal circuit (user-made parts, slice 4b Model B — the fuller graduation): the
   * part is built from a whole sub-circuit of real parts, stored in the same shape a circuit block
   * uses. Each port's id IS one of this part's pin ids (1:1), so a wire on a pin reaches the real
   * internal terminal when the solve flattens it — exactly how a block flattens. Mutually exclusive
   * with behavesAs (a part simulates one way). Absent ⇒ no internals.
   */
  internal?: BlockData
  /** Cited default parameters, if any (typed values); black-box parts often have none. */
  parameters?: Parameters
}

// Symbol geometry, in px. The BODY is a box at least as big as the default device glyph (symbols.tsx
// W=80 / H=44); STUB pin leads stick out on every side, so the total is body + 2·STUB, and a pin's tip
// lands exactly on the node's outer edge — where React Flow anchors the wire handle.
const MIN_BODY_W = 80
const MIN_BODY_H = 44
const STUB = 8 // length of the pin lead sticking out of the body
const PITCH = 20 // spacing between adjacent pins on one side
const MARGIN = 16 // gap from a body corner to the first / last pin on that side
const CHAR_W = 8 // approx px per character of the 12px semibold body name (the box grows to fit it)
const PIN_LABEL_CHAR = 6 // approx px per character of a 9px pin-name label tucked inside the body edge

/** A placed pin: the stub root on the body edge, its tip on the node's outer edge, + drawing fields. */
export type PlacedPin = {
  id: string
  name: string
  side: PinSide
  electrical: PinElectrical
  /** Where the stub meets the body. */
  rootX: number
  rootY: number
  /** The stub's outer end — on the node's outer edge, where the wire handle sits. */
  tipX: number
  tipY: number
}

export type UserPartGeometry = {
  /** Total node size (body + stubs on both sides). */
  width: number
  height: number
  /** The inner body box (inset by STUB on every side). */
  body: { x: number; y: number; width: number; height: number }
  pins: PlacedPin[]
}

const bySide = (part: UserPart, side: PinSide) => part.pins.filter((p) => p.side === side)

/**
 * The box + pin coordinates for a user part, sized to fit its pins AND its name. Left/right pins set
 * the body height, top/bottom pins + the name set the body width. Pins on a side are spread evenly and
 * centred. The symbol SVG and the wire handles both read this — one coordinate space — so a handle
 * always lands on its drawn pin tip.
 */
export function userPartGeometry(part: UserPart): UserPartGeometry {
  const left = bySide(part, 'left')
  const right = bySide(part, 'right')
  const top = bySide(part, 'top')
  const bottom = bySide(part, 'bottom')
  const vMax = Math.max(left.length, right.length)
  const hMax = Math.max(top.length, bottom.length)
  const bodyH = Math.max(MIN_BODY_H, 2 * MARGIN + Math.max(0, vMax - 1) * PITCH)
  // Width fits the centred name AND the left/right pin labels tucked inside each edge without the three
  // colliding — so a long name beside named side-pins ("IN … My Sensor … OUT") stays readable.
  const labelChars = (pins: UserPin[]) => Math.max(0, ...pins.map((p) => p.name.length))
  const sideLabelW = Math.max(labelChars(left), labelChars(right)) * PIN_LABEL_CHAR
  const nameBandW = part.name.length * CHAR_W + 2 * sideLabelW + 24
  const bodyW = Math.max(MIN_BODY_W, nameBandW, 2 * MARGIN + Math.max(0, hMax - 1) * PITCH)
  const width = bodyW + 2 * STUB
  const height = bodyH + 2 * STUB
  const bx = STUB
  const by = STUB

  // Evenly spaced coordinate of pin i (of n) along a body edge of length `along`, centred.
  const coord = (i: number, n: number, along: number) =>
    n <= 1 ? along / 2 : MARGIN + ((along - 2 * MARGIN) * i) / (n - 1)

  const pins: PlacedPin[] = []
  const base = (p: UserPin) => ({ id: p.id, name: p.name, side: p.side, electrical: p.electrical })
  left.forEach((p, i) => {
    const y = by + coord(i, left.length, bodyH)
    pins.push({ ...base(p), rootX: bx, rootY: y, tipX: 0, tipY: y })
  })
  right.forEach((p, i) => {
    const y = by + coord(i, right.length, bodyH)
    pins.push({ ...base(p), rootX: bx + bodyW, rootY: y, tipX: width, tipY: y })
  })
  top.forEach((p, i) => {
    const x = bx + coord(i, top.length, bodyW)
    pins.push({ ...base(p), rootX: x, rootY: by, tipX: x, tipY: 0 })
  })
  bottom.forEach((p, i) => {
    const x = bx + coord(i, bottom.length, bodyW)
    pins.push({ ...base(p), rootX: x, rootY: by + bodyH, tipX: x, tipY: height })
  })
  return { width, height, body: { x: bx, y: by, width: bodyW, height: bodyH }, pins }
}

const SIDE_POSITION: Record<PinSide, Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
}

/**
 * The wire handles for a user part, in the shape terminalsOf returns: a handle per pin, on its edge
 * with the along-edge `offset` px (top for left/right pins, left for top/bottom — exactly what the
 * DeviceNode handle-render code consumes). The offset is the pin TIP's cross-axis coordinate, in the
 * same node-box space the glyph draws in, so the handle sits on the drawn pin tip.
 */
export function userPartTerminals(
  part: UserPart,
): { id: string; position: Position; offset: number }[] {
  return userPartGeometry(part).pins.map((p) => ({
    id: p.id,
    position: SIDE_POSITION[p.side],
    offset: p.side === 'left' || p.side === 'right' ? p.tipY : p.tipX,
  }))
}

// The runtime registry of user parts — populated by the authoring UI + project load (later slices); the
// symbol / terminal / palette / defaults lookups consult it so a user part behaves like a built-in.
const registry = new Map<string, UserPart>()

// A tiny external store so React (the palette) re-renders when the registry changes. The module-global
// Map is invisible to React; `snapshot` is a stable array rebuilt only on a mutation, and getSnapshot
// returns the SAME reference until then — exactly what useSyncExternalStore needs to avoid render loops.
let snapshot: UserPart[] = []
const listeners = new Set<() => void>()
function publish(): void {
  snapshot = [...registry.values()]
  for (const listener of listeners) listener()
}
/** Subscribe to registry changes (returns an unsubscribe). Pairs with getUserPartsSnapshot. */
export function subscribeUserParts(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
/** The current user parts as a STABLE reference (unchanged until the next mutation) — for React. */
export function getUserPartsSnapshot(): readonly UserPart[] {
  return snapshot
}

// Built-in definition ids are OFF-LIMITS as user-part ids. The solver, symbols, and defaults all key off
// the definition-id STRING, so a user part sharing a built-in's id would be simulated AND drawn as that
// built-in (with the wrong parameters) — a silent lie. The app seeds this set from the palette's built-in
// list at startup; the registry then refuses a colliding id, keeping the two sets DISJOINT. That
// disjointness is what lets terminalsOf / DeviceGlyph / the node-box sizing resolve a user part safely no
// matter where each consults the registry — a built-in id simply never reaches getUserPart.
const reservedBuiltinIds = new Set<string>()

/** Seed the reserved built-in ids (call once at startup with the palette's definition ids). */
export function reserveBuiltinIds(ids: Iterable<string>): void {
  for (const id of ids) reservedBuiltinIds.add(id)
}

/** Would this id collide with a built-in part? (The authoring UI validates a proposed id with this.) */
export function isReservedBuiltinId(id: string): boolean {
  return reservedBuiltinIds.has(id)
}

/** Register a user part. Refuses (and warns) an id that collides with a built-in — returns success. */
export function registerUserPart(part: UserPart): boolean {
  if (reservedBuiltinIds.has(part.id)) {
    console.warn(`[user-parts] refusing "${part.id}": that id belongs to a built-in part`)
    return false
  }
  registry.set(part.id, part)
  publish()
  return true
}
export function getUserPart(id: string): UserPart | undefined {
  return registry.get(id)
}
export function isUserPart(id: string): boolean {
  return registry.has(id)
}
export function allUserParts(): UserPart[] {
  return [...registry.values()]
}
/** Replace the whole registry (a project load / editor commit sets the full set at once). */
export function setUserParts(parts: readonly UserPart[]): void {
  registry.clear()
  for (const p of parts) {
    if (reservedBuiltinIds.has(p.id)) {
      console.warn(`[user-parts] skipping "${p.id}": that id belongs to a built-in part`)
      continue
    }
    registry.set(p.id, p)
  }
  publish()
}

/**
 * Add parts WITHOUT clobbering (used when a project loads its custom parts into a session that may
 * already hold parts from another open tab): an id already registered is KEPT, not overwritten — so a
 * loaded project can never silently change a part another tab is using. Reserved built-in ids are
 * skipped. Returns how many were newly added.
 */
export function mergeUserParts(parts: readonly UserPart[]): number {
  let added = 0
  for (const p of parts) {
    if (registry.has(p.id) || reservedBuiltinIds.has(p.id)) continue
    registry.set(p.id, p)
    added++
  }
  if (added > 0) publish()
  return added
}

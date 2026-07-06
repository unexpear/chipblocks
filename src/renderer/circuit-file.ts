import type { BlockData } from './blocks.ts'
import type { Parameters } from './part-defaults.ts'
import type { SheetSettings } from './sheet-frame.tsx'
import { validateUserPart } from './user-part-validate.ts'
import type { UserPart } from './user-parts.ts'

/**
 * Circuit file format (S19-v3-52) — Save/Load, the first half of the
 * two-deliverables model (the editable project). A `.chipblocks` file is JSON
 * holding exactly what the user built: the parts (definition + position +
 * rotation + their edited values) and the wires (terminal-to-terminal, with any
 * hand-routed corners). Solved data (currents, temperatures, …) is deliberately
 * NOT saved — it is recomputed from the circuit on load, never trusted from a
 * file.
 *
 * Versioned and validated: an unrecognized format or version is rejected with a
 * plain-language reason, not guessed at. The directory-based project format
 * (MyProject.chipblocks/ with origin overlays, per OBJECT-MODEL.md §11) is the
 * planned successor; this single file is rung one.
 */

export const CIRCUIT_FILE_FORMAT = 'chipblocks-circuit'
export const CIRCUIT_FILE_VERSION = 1

export type SavedNode = {
  id: string
  definition: string
  x: number
  y: number
  rotation?: number
  parameters?: Parameters
  /** The chosen board package (footprint id); absent ⇒ the part's default footprint. */
  footprintId?: string
  /** A circuit block carries its real internals (S19-v3-67). */
  block?: BlockData
}

export type SavedWire = {
  id: string
  source: string
  sourceHandle: string | null
  target: string
  targetHandle: string | null
  waypoints?: { id: string; x: number; y: number }[]
  /** Drawn with the curve subtool — corners render (and measure) as fillets. */
  curved?: boolean
  /** The wire's own corner sweep size (px); absent = the default Gentle size. */
  curveRadius?: number
  /** The wire's AWG gauge; absent = the default 22 AWG. Drives R = ρL/A + heating. */
  gaugeAwg?: number
  /** The wire's conductor material id; absent = copper. Drives R = ρ·L/A via resistivity. */
  material?: string
}

/** A part's HAND placement on the board — its position (mm) + rotation, keyed by part id. Absent for a
 *  part still on its auto spot; the board re-seeds those. Saved so a laid-out board survives a reload. */
export type SavedPlacement = {
  id: string
  x: number
  y: number
  rotation: number
}

export type CircuitFile = {
  format: typeof CIRCUIT_FILE_FORMAT
  version: typeof CIRCUIT_FILE_VERSION
  /** The board-wide ambient (°C) parts inherit; absent ⇒ the 25 °C default (older files). */
  projectAmbientC?: number
  /** The drawing sheet — page size + ISO 7200 title-block fields; absent ⇒ the default A4 sheet. */
  sheet?: SheetSettings
  /** Hand-placed board positions/rotations; absent ⇒ every part starts on its auto spot (older files). */
  placements?: SavedPlacement[]
  /** User-authored custom parts used by this project, so the file is self-contained + portable; absent
   *  ⇒ none (older files). Validated on load by user-part-validate.ts (mirrors user-part.schema.json). */
  userParts?: UserPart[]
  nodes: SavedNode[]
  wires: SavedWire[]
}

/** The minimal shapes the canvas exchanges with this module (React Flow-ish). */
type CanvasNodeLike = {
  id: string
  position: { x: number; y: number }
  data: {
    definition: string
    rotation?: number
    parameters?: Parameters
    footprintId?: string
    block?: BlockData
  }
}
type CanvasEdgeLike = {
  id: string
  source: string
  sourceHandle?: string | null
  target: string
  targetHandle?: string | null
  data?: {
    waypoints?: unknown
    curved?: unknown
    curveRadius?: unknown
    gaugeAwg?: unknown
    material?: unknown
  }
}

/**
 * Parameters the solver DERIVES from the circuit (and recomputes on load), so they are not persisted
 * — per the no-solved-data rule. incident_illuminance is computed by light casting from the sensor +
 * source positions and is overwritten on the first solve after load; saving it would freeze a stale
 * derived value into the file. (Device state like device_state / coil_state IS kept — that is the
 * latch's / relay's memory, what the user built, not a transient solved quantity.)
 */
const DERIVED_PARAMETERS = new Set(['incident_illuminance'])

function persistableParameters(parameters: Parameters | undefined): Parameters | undefined {
  if (!parameters) return undefined
  const kept = Object.entries(parameters).filter(([key]) => !DERIVED_PARAMETERS.has(key))
  return kept.length > 0 ? (Object.fromEntries(kept) as Parameters) : undefined
}

/** Every definition id the circuit references — top-level nodes AND parts nested inside blocks (a block
 *  can group a selection that itself contains a user part), walked recursively. Used to save only the
 *  user parts this project actually uses, so the file stays scoped + portable (not the whole session). */
function collectDefinitionIds(nodes: CanvasNodeLike[]): Set<string> {
  const ids = new Set<string>()
  const walkBlock = (block: BlockData) => {
    for (const inner of block.nodes) {
      ids.add(inner.definition)
      if (inner.block) walkBlock(inner.block)
    }
  }
  for (const n of nodes) {
    ids.add(n.data.definition)
    if (n.data.block) walkBlock(n.data.block)
  }
  return ids
}

/** The canvas state → a versioned, solver-free circuit file. */
export function serializeCircuit(
  nodes: CanvasNodeLike[],
  edges: CanvasEdgeLike[],
  projectAmbientC?: number,
  sheet?: SheetSettings,
  placements?: readonly SavedPlacement[],
  userParts?: readonly UserPart[],
): CircuitFile {
  // Save only the user parts THIS circuit references (not the whole session registry, which is shared
  // across open tabs) — so the file is self-contained + portable without leaking unrelated parts.
  const usedIds = userParts && userParts.length > 0 ? collectDefinitionIds(nodes) : undefined
  const referencedUserParts = usedIds ? (userParts ?? []).filter((p) => usedIds.has(p.id)) : []
  return {
    format: CIRCUIT_FILE_FORMAT,
    version: CIRCUIT_FILE_VERSION,
    ...(typeof projectAmbientC === 'number' ? { projectAmbientC } : {}),
    ...(sheet ? { sheet } : {}),
    ...(placements && placements.length > 0 ? { placements: [...placements] } : {}),
    ...(referencedUserParts.length > 0 ? { userParts: referencedUserParts } : {}),
    nodes: nodes.map((n) => {
      const parameters = persistableParameters(n.data.parameters)
      return {
        id: n.id,
        definition: n.data.definition,
        x: n.position.x,
        y: n.position.y,
        ...(n.data.rotation ? { rotation: n.data.rotation } : {}),
        ...(parameters ? { parameters } : {}),
        ...(n.data.footprintId ? { footprintId: n.data.footprintId } : {}),
        ...(n.data.block ? { block: n.data.block } : {}),
      }
    }),
    wires: edges.map((e) => {
      const waypoints = Array.isArray(e.data?.waypoints)
        ? (e.data.waypoints as { id: string; x: number; y: number }[])
        : undefined
      return {
        id: e.id,
        source: e.source,
        sourceHandle: e.sourceHandle ?? null,
        target: e.target,
        targetHandle: e.targetHandle ?? null,
        ...(waypoints && waypoints.length > 0 ? { waypoints } : {}),
        ...(e.data?.curved === true ? { curved: true } : {}),
        ...(typeof e.data?.curveRadius === 'number' ? { curveRadius: e.data.curveRadius } : {}),
        ...(typeof e.data?.gaugeAwg === 'number' ? { gaugeAwg: e.data.gaugeAwg } : {}),
        ...(typeof e.data?.material === 'string' ? { material: e.data.material } : {}),
      }
    }),
  }
}

export type DeserializeResult = { ok: true; file: CircuitFile } | { ok: false; reason: string }

/**
 * Parse + validate circuit-file text. Honest rejections: not JSON, not this
 * format, a future version, or structurally broken nodes/wires all return a
 * plain-language reason instead of a half-loaded circuit.
 */
export function deserializeCircuit(text: string): DeserializeResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'Not a valid JSON file.' }
  }
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, reason: 'Not a circuit file (expected a JSON object).' }
  }
  const file = raw as Record<string, unknown>
  if (file.format !== CIRCUIT_FILE_FORMAT) {
    return { ok: false, reason: 'Not a ChipBlocks circuit file (wrong or missing format field).' }
  }
  if (file.version !== CIRCUIT_FILE_VERSION) {
    return {
      ok: false,
      reason: `Unsupported circuit-file version ${String(file.version)} (this build reads version ${CIRCUIT_FILE_VERSION}).`,
    }
  }
  if (!Array.isArray(file.nodes) || !Array.isArray(file.wires)) {
    return { ok: false, reason: 'Circuit file is missing its nodes or wires list.' }
  }
  for (const n of file.nodes) {
    const node = n as Record<string, unknown>
    if (
      typeof node?.id !== 'string' ||
      typeof node?.definition !== 'string' ||
      typeof node?.x !== 'number' ||
      typeof node?.y !== 'number'
    ) {
      return { ok: false, reason: 'A part in the file is missing its id, type, or position.' }
    }
  }
  for (const w of file.wires) {
    const wire = w as Record<string, unknown>
    if (
      typeof wire?.id !== 'string' ||
      typeof wire?.source !== 'string' ||
      typeof wire?.target !== 'string'
    ) {
      return { ok: false, reason: 'A wire in the file is missing its id or endpoints.' }
    }
  }
  // projectAmbientC drives the solve temperature; if present it must be a finite number.
  // A malformed one is DROPPED — not a reason to reject the whole circuit — so the returned
  // type is honest (a number or absent) and the loader falls back to the 25 °C default.
  const { projectAmbientC, sheet, placements, userParts, ...rest } = file
  const base = rest as CircuitFile
  const ambientOk = typeof projectAmbientC === 'number' && Number.isFinite(projectAmbientC)
  // A malformed sheet (not an object) is dropped, not a reason to reject the circuit; the loader
  // merges what survives over the default sheet, so a partial/old one still loads.
  const sheetOk = typeof sheet === 'object' && sheet !== null
  // Hand placements: keep only well-formed entries (id + finite x/y + numeric rotation); a bad one is
  // dropped, not a reason to reject the circuit — that part just falls back to its auto spot.
  const cleanPlacements = Array.isArray(placements)
    ? (placements as unknown[]).filter((p): p is SavedPlacement => {
        const q = p as Record<string, unknown>
        return (
          typeof q?.id === 'string' &&
          typeof q?.x === 'number' &&
          Number.isFinite(q.x) &&
          typeof q?.y === 'number' &&
          Number.isFinite(q.y) &&
          typeof q?.rotation === 'number'
        )
      })
    : []
  // User parts: validate each against the user-part shape (mirrors user-part.schema.json). A malformed
  // entry is dropped — not a reason to reject the whole circuit — so a mostly-good file still loads its
  // good parts (and the parts that reference a dropped one just render as the honest unknown-part box).
  const cleanUserParts = Array.isArray(userParts)
    ? userParts.map((p) => validateUserPart(p)).filter((p): p is UserPart => p !== null)
    : []
  return {
    ok: true,
    file: {
      ...base,
      ...(ambientOk ? { projectAmbientC: projectAmbientC as number } : {}),
      ...(sheetOk ? { sheet: sheet as SheetSettings } : {}),
      ...(cleanPlacements.length > 0 ? { placements: cleanPlacements } : {}),
      ...(cleanUserParts.length > 0 ? { userParts: cleanUserParts } : {}),
    },
  }
}

/**
 * The largest numeric suffix among part ids (e.g. `resistor_7` → 7) — the drop
 * counter resumes above it after a load, so new parts never collide with loaded
 * ids.
 */
export function maxIdSuffix(nodes: { id: string }[]): number {
  let max = 0
  for (const n of nodes) {
    // The trailing _<n> suffix, if any. Test `!== undefined`, not truthiness, so an _0
    // suffix counts — `"0"` is falsy, which the old truthiness check silently skipped.
    const digits = /_(\d+)$/.exec(n.id)?.[1]
    if (digits !== undefined) max = Math.max(max, Number.parseInt(digits, 10))
  }
  return max
}

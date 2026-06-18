import {
  type BlockData,
  type CanvasEdgeLike,
  type CanvasNodeLike,
  cloneBlockData,
} from './blocks.ts'
import type { Parameters } from './part-defaults.ts'

/**
 * Canvas clipboard (S19-v3-69) — desktop-style copy / cut / paste for parts,
 * with a HISTORY like the Windows clipboard (Win+V): up to 15 copies are kept,
 * newest first, plus ONE cut at a time in its own slot (cutting again replaces
 * it — the parts a cut removed live only here, so the panel shows it pinned).
 *
 * A snapshot keeps the selected parts, the wires fully INSIDE the selection
 * (a wire to an unselected part has nowhere to attach when pasted), every
 * edited value (deep-copied — pasting then editing never reaches back), and
 * whole blocks. Pasting materializes fresh ids (block internals included, via
 * the same cloneBlockData the palette's block-copy uses) centered wherever
 * the cursor is — paste is a NEW, independent copy every time.
 */

export const MAX_COPY_SLOTS = 15

export type ClipNode = {
  id: string
  type?: string
  definition: string
  label?: string
  x: number
  y: number
  rotation?: number
  parameters?: Parameters
  block?: BlockData
}

export type ClipEdge = {
  id: string
  source: string
  sourceHandle: string | null
  target: string
  targetHandle: string | null
  waypoints?: { id: string; x: number; y: number }[]
  curved?: boolean
  curveRadius?: number
  /** The wire's AWG gauge + conductor material — both drive R = ρL/A, so a paste must keep them. */
  gaugeAwg?: number
  material?: string
}

export type ClipboardItem = {
  /** Plain-words contents, for the panel ("resistor + led", "5 parts — …"). */
  label: string
  nodes: ClipNode[]
  edges: ClipEdge[]
  /** Monotonic stamp — the panel sorts by it; paste takes the newest. */
  stamp: number
}

export type ClipboardState = {
  /** Copy history, newest first, capped at MAX_COPY_SLOTS. */
  copies: ClipboardItem[]
  /** The one cut at a time. A new cut replaces it. */
  cut: ClipboardItem | null
  nextStamp: number
}

export function emptyClipboard(): ClipboardState {
  return { copies: [], cut: null, nextStamp: 1 }
}

/**
 * Snapshot the selection (parts + the wires fully inside it) into a clipboard
 * item. Null when nothing is selected. Parameters and block internals are
 * deep-copied so later edits to the originals never change what was copied.
 */
export function snapshotSelection(
  nodes: CanvasNodeLike[],
  edges: CanvasEdgeLike[],
  selectedIds: ReadonlySet<string>,
): Omit<ClipboardItem, 'stamp'> | null {
  const picked = nodes.filter((n) => selectedIds.has(n.id))
  if (picked.length === 0) return null

  const clipNodes: ClipNode[] = picked.map((n) => ({
    id: n.id,
    ...(n.type !== undefined ? { type: n.type } : {}),
    definition: n.data.definition,
    ...(n.data.label !== undefined ? { label: n.data.label } : {}),
    x: n.position.x,
    y: n.position.y,
    ...(n.data.rotation !== undefined ? { rotation: n.data.rotation } : {}),
    ...(n.data.parameters !== undefined
      ? { parameters: JSON.parse(JSON.stringify(n.data.parameters)) as Parameters }
      : {}),
    ...(n.data.block !== undefined
      ? { block: JSON.parse(JSON.stringify(n.data.block)) as BlockData }
      : {}),
  }))

  const clipEdges: ClipEdge[] = edges
    .filter((e) => selectedIds.has(e.source) && selectedIds.has(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle ?? null,
      target: e.target,
      targetHandle: e.targetHandle ?? null,
      ...(Array.isArray(e.data?.waypoints) && (e.data.waypoints as unknown[]).length > 0
        ? {
            waypoints: JSON.parse(JSON.stringify(e.data.waypoints)) as {
              id: string
              x: number
              y: number
            }[],
          }
        : {}),
      ...(e.data?.curved === true ? { curved: true } : {}),
      ...(typeof e.data?.curveRadius === 'number' ? { curveRadius: e.data.curveRadius } : {}),
      ...(typeof e.data?.gaugeAwg === 'number' ? { gaugeAwg: e.data.gaugeAwg } : {}),
      ...(typeof e.data?.material === 'string' ? { material: e.data.material } : {}),
    }))

  return { label: describeParts(clipNodes), nodes: clipNodes, edges: clipEdges }
}

/** "resistor", "resistor + led", or "5 parts — resistor, led, block …". */
function describeParts(nodes: ClipNode[]): string {
  const names = nodes.map((n) => (n.definition === 'block' ? (n.label ?? 'block') : n.definition))
  if (names.length === 1) return names[0] ?? 'part'
  if (names.length === 2) return names.join(' + ')
  return `${names.length} parts — ${names.slice(0, 3).join(', ')}${names.length > 3 ? ' …' : ''}`
}

/** Add a copy at the front of the history; the oldest beyond 15 falls off. */
export function withCopy(
  state: ClipboardState,
  item: Omit<ClipboardItem, 'stamp'>,
): ClipboardState {
  const stamped: ClipboardItem = { ...item, stamp: state.nextStamp }
  return {
    copies: [stamped, ...state.copies].slice(0, MAX_COPY_SLOTS),
    cut: state.cut,
    nextStamp: state.nextStamp + 1,
  }
}

/** Put a cut into the single cut slot, replacing any previous cut. */
export function withCut(state: ClipboardState, item: Omit<ClipboardItem, 'stamp'>): ClipboardState {
  return {
    copies: state.copies,
    cut: { ...item, stamp: state.nextStamp },
    nextStamp: state.nextStamp + 1,
  }
}

/** What plain paste (Ctrl+V) pastes: the most recent cut OR copy. */
export function latestItem(state: ClipboardState): ClipboardItem | null {
  const newestCopy = state.copies[0] ?? null
  if (state.cut === null) return newestCopy
  if (newestCopy === null) return state.cut
  return state.cut.stamp > newestCopy.stamp ? state.cut : newestCopy
}

/**
 * Materialize a clipboard item as NEW canvas content: every id made fresh with
 * `suffix` (block internals re-cloned the same way), wires re-pointed at the
 * fresh ids, and the whole group translated so its bounding-box center lands
 * on `target` (the cursor). The pasted nodes arrive selected, ready to drag.
 */
export function materializeItem(
  item: ClipboardItem,
  suffix: string,
  target: { x: number; y: number },
): { nodes: CanvasNodeLike[]; edges: CanvasEdgeLike[] } {
  const minX = Math.min(...item.nodes.map((n) => n.x))
  const maxX = Math.max(...item.nodes.map((n) => n.x))
  const minY = Math.min(...item.nodes.map((n) => n.y))
  const maxY = Math.max(...item.nodes.map((n) => n.y))
  const dx = target.x - (minX + maxX) / 2
  const dy = target.y - (minY + maxY) / 2

  const freshId = (id: string) => `${id}_${suffix}`

  const nodes: CanvasNodeLike[] = item.nodes.map((n) => ({
    id: freshId(n.id),
    type: n.type ?? (n.definition === 'block' ? 'block' : 'device'),
    position: { x: n.x + dx, y: n.y + dy },
    selected: true,
    data: {
      definition: n.definition,
      ...(n.label !== undefined ? { label: n.label } : {}),
      ...(n.rotation !== undefined ? { rotation: n.rotation } : {}),
      ...(n.parameters !== undefined
        ? { parameters: JSON.parse(JSON.stringify(n.parameters)) as Parameters }
        : {}),
      ...(n.block !== undefined ? { block: cloneBlockData(n.block, suffix) } : {}),
    },
  }))

  const edges: CanvasEdgeLike[] = item.edges.map((e, i) => ({
    id: `${freshId(e.id)}_${i}`,
    source: freshId(e.source),
    sourceHandle: e.sourceHandle,
    target: freshId(e.target),
    targetHandle: e.targetHandle,
    type: 'net',
    deletable: true,
    data: {
      ...(e.waypoints !== undefined
        ? {
            waypoints: e.waypoints.map((w, j) => ({
              id: `${w.id}_${suffix}_${j}`,
              x: w.x + dx,
              y: w.y + dy,
            })),
          }
        : {}),
      ...(e.curved === true ? { curved: true } : {}),
      ...(typeof e.curveRadius === 'number' ? { curveRadius: e.curveRadius } : {}),
      ...(typeof e.gaugeAwg === 'number' ? { gaugeAwg: e.gaugeAwg } : {}),
      ...(typeof e.material === 'string' ? { material: e.material } : {}),
    },
  }))

  return { nodes, edges }
}

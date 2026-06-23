import type { Parameters } from './part-defaults.ts'

/**
 * Circuit blocks (S19-v3-67) — the Layer-5 move from OBJECT-MODEL.md: a drawn
 * circuit becomes ONE reusable block with terminals. The load-bearing honesty
 * rule, straight from the object model ("no black-box user blocks"):
 *
 *   A block is PURE STRUCTURE. The solver never sees blocks — flattenBlocks
 *   expands every block back into its real parts (with namespaced ids) before
 *   every solve, so the actual transistors inside are what gets computed,
 *   every time. Grouping a circuit changes NOTHING physically — and that is
 *   proven by test: a blocked CMOS inverter solves to the same numbers as the
 *   flat one.
 *
 * Ports are discovered from the wiring: any internal terminal that a wire
 * connects to something OUTSIDE the selection becomes a port. The boundary
 * wires re-attach to the block's port handles; flattening routes them back to
 * the real internal terminal.
 */

/** A block pin's power role — a chip marks its supply pins; signal pins stay plain. */
export type PinKind = 'signal' | 'power_positive' | 'power_negative'
/** Which edge of the block box a pin sits on — a real chip's perimeter (QFP-style). */
export type PinSide = 'left' | 'right' | 'top' | 'bottom'
/**
 * A pin's signal direction / drive type — the basis of the output-combining (driver-contention)
 * rules from real logic chips. The three OUTPUT kinds are push-pull (actively drives high AND low —
 * a normal output), open-collector / open-drain (pulls low only; meant to share a wire via a
 * pull-up), and tri-state (can switch to high-Z to share a bus). Inputs and unspecified pins never
 * drive, so they never contend.
 */
export type DriveKind = 'input' | 'push_pull' | 'open_collector' | 'tristate'
const OUTPUT_DRIVES: ReadonlySet<DriveKind> = new Set<DriveKind>([
  'push_pull',
  'open_collector',
  'tristate',
])
/** Is this pin an output (a driver)? Only outputs can contend when wired to the same net. */
export function isOutputDrive(drive: DriveKind | undefined): drive is DriveKind {
  return drive !== undefined && OUTPUT_DRIVES.has(drive)
}

export type BlockPort = {
  id: string
  /** Human label — the internal terminal it IS (e.g. "mn1 · gate"). */
  label: string
  /** User-given pin name (e.g. "VCC", "OUT"); falls back to the label. */
  name?: string
  /** Power pins render with +/− (a chip DOES mark its supply pins); signal pins stay plain. */
  kind?: PinKind
  /** Signal direction / drive type — the basis of the output-combining (driver-contention) checks. */
  drive?: DriveKind
  /** For a tri-state OUTPUT pin: which pin enables it (a pin id on this block) + its active level. The
   *  live check counts how many tri-states on a shared bus are enabled at once (≥2 = real contention). */
  enable?: { pin: string; activeHigh: boolean }
  /** Which EDGE of the block box the pin sits on — a real chip's perimeter pins (QFP-style). */
  side: PinSide
  /** Legacy hand-laid position (px along the edge) — only the BUILT-IN blocks set it; user-grouped
   *  blocks leave it unset and auto-distribute on the edges (blockLayout). */
  offset?: number
  inner: { nodeId: string; handleId: string }
}

export type BlockInnerNode = {
  id: string
  definition: string
  x: number
  y: number
  rotation?: number
  parameters?: Parameters
  /** Nested block (grouping a selection that contains a block). */
  block?: BlockData
}

export type BlockInnerEdge = {
  id: string
  source: string
  sourceHandle: string | null
  target: string
  targetHandle: string | null
  waypoints?: { id: string; x: number; y: number }[]
  curved?: boolean
  /** Corner sweep size (px) for a curve-style wire — each wire keeps its own. */
  curveRadius?: number
}

export type BlockData = {
  name: string
  /** The block node's position when grouped — ungroup offsets internals by the displacement. */
  origin: { x: number; y: number }
  nodes: BlockInnerNode[]
  edges: BlockInnerEdge[]
  ports: BlockPort[]
}

/** The minimal canvas shapes this module exchanges with App (React Flow-ish). */
export type CanvasNodeLike = {
  id: string
  type?: string
  position: { x: number; y: number }
  data: {
    definition: string
    label?: string
    rotation?: number
    parameters?: Parameters
    block?: BlockData
  }
  selected?: boolean
}
export type CanvasEdgeLike = {
  id: string
  source: string
  sourceHandle?: string | null
  target: string
  targetHandle?: string | null
  type?: string
  deletable?: boolean
  style?: Record<string, unknown>
  data?: {
    waypoints?: unknown
    curved?: unknown
    curveRadius?: unknown
    gaugeAwg?: unknown
    material?: unknown
    internalBond?: unknown
  }
}

/**
 * Is this wire fully INSIDE the selection (both endpoints selected)? The one
 * rule everywhere selection meets wires: grouping keeps these as the block's
 * internals, the clipboard copies exactly these, and box/lasso/select-all
 * highlight exactly these.
 */
export function edgeInsideSelection(
  edge: { source: string; target: string },
  selectedIds: ReadonlySet<string>,
): boolean {
  return selectedIds.has(edge.source) && selectedIds.has(edge.target)
}

const PORT_SPACING = 18
const PORT_PAD = 18
const BLOCK_MIN_W = 96
const BLOCK_MIN_H = 44

/** A pin's resolved place on the block box: which edge, and the px coordinate along that edge. */
export type PlacedPort = { port: BlockPort; side: BlockPort['side']; coord: number }

/**
 * Lay the pins out on the block's FOUR edges, like a real chip's perimeter pins. Each side's pins are
 * evenly spaced and CENTERED along that edge; the box grows so the busiest left/right side sets the
 * height and the busiest top/bottom side sets the width. Pure + recomputed every render — so a pin
 * always sits ON an edge: reassign its side and it simply re-places itself, never floating.
 */
export function blockLayout(ports: BlockPort[]): {
  width: number
  height: number
  placed: PlacedPort[]
} {
  // A hand-laid block (every pin carries an explicit offset — the built-ins) keeps its exact layout;
  // a user-grouped block (no offsets) auto-distributes on the four edges, centered per side.
  if (ports.length > 0 && ports.every((p) => typeof p.offset === 'number')) {
    const height = Math.max(BLOCK_MIN_H, Math.max(...ports.map((p) => p.offset ?? 0)) + PORT_PAD)
    return {
      width: BLOCK_MIN_W,
      height,
      placed: ports.map((port) => ({ port, side: port.side, coord: port.offset ?? 0 })),
    }
  }
  const bySide: Record<BlockPort['side'], BlockPort[]> = {
    left: [],
    right: [],
    top: [],
    bottom: [],
  }
  for (const p of ports) bySide[p.side].push(p)
  const vMax = Math.max(bySide.left.length, bySide.right.length)
  const hMax = Math.max(bySide.top.length, bySide.bottom.length)
  const height = Math.max(BLOCK_MIN_H, vMax * PORT_SPACING + PORT_PAD)
  const width = Math.max(BLOCK_MIN_W, hMax * PORT_SPACING + PORT_PAD)
  const placed: PlacedPort[] = []
  for (const side of ['left', 'right', 'top', 'bottom'] as const) {
    const list = bySide[side]
    const along = side === 'left' || side === 'right' ? height : width
    const start = along / 2 - ((list.length - 1) * PORT_SPACING) / 2
    list.forEach((port, i) => {
      placed.push({ port, side, coord: start + i * PORT_SPACING })
    })
  }
  return { width, height, placed }
}

/** Drop the legacy hand-laid offsets so the block auto-distributes (after any pinout edit). */
export function withoutOffsets(ports: BlockPort[]): BlockPort[] {
  return ports.map(({ offset: _offset, ...rest }) => rest)
}

/** Move a pin up/down (dir −1 / +1) AMONG ITS SAME-SIDE pins — reordering that one edge. */
export function movePortAlongEdge(ports: BlockPort[], portId: string, dir: -1 | 1): BlockPort[] {
  const idx = ports.findIndex((p) => p.id === portId)
  const side = ports[idx]?.side
  if (idx < 0 || side === undefined) return ports
  let swap = -1
  for (let i = idx + dir; i >= 0 && i < ports.length; i += dir) {
    if (ports[i]?.side === side) {
      swap = i
      break
    }
  }
  const a = ports[idx]
  const b = ports[swap]
  if (swap < 0 || !a || !b) return ports
  const out = [...ports]
  out[idx] = b
  out[swap] = a
  return out
}

/** Does this wire attach to the given block PIN? Used to drop the wire when its pin is removed (it
 *  would otherwise dangle on a handle that no longer exists). */
export function edgeTouchesPort(
  edge: {
    source: string
    sourceHandle?: string | null
    target: string
    targetHandle?: string | null
  },
  blockId: string,
  portId: string,
): boolean {
  return (
    (edge.source === blockId && edge.sourceHandle === portId) ||
    (edge.target === blockId && edge.targetHandle === portId)
  )
}

const edgeData = (edge: CanvasEdgeLike): BlockInnerEdge => ({
  id: edge.id,
  source: edge.source,
  sourceHandle: edge.sourceHandle ?? null,
  target: edge.target,
  targetHandle: edge.targetHandle ?? null,
  ...(Array.isArray(edge.data?.waypoints) && (edge.data.waypoints as unknown[]).length > 0
    ? { waypoints: edge.data.waypoints as { id: string; x: number; y: number }[] }
    : {}),
  ...(edge.data?.curved === true ? { curved: true } : {}),
  ...(typeof edge.data?.curveRadius === 'number' ? { curveRadius: edge.data.curveRadius } : {}),
})

/**
 * Group the selected parts (and every wire fully inside the selection) into a
 * block. Wires crossing the boundary define the ports: the inside end becomes
 * a port terminal (deduplicated — several outside wires on one terminal share
 * one port), and each boundary wire is re-attached to the block's port handle.
 *
 * Returns the new canvas (block node added, grouped parts removed, boundary
 * wires rewired) or a plain-language reason it can't group.
 */
export function groupSelection(
  nodes: CanvasNodeLike[],
  edges: CanvasEdgeLike[],
  selectedIds: ReadonlySet<string>,
  blockId: string,
  name: string,
): { nodes: CanvasNodeLike[]; edges: CanvasEdgeLike[] } | { reason: string } {
  const inner = nodes.filter((n) => selectedIds.has(n.id))
  if (inner.length < 2) return { reason: 'Select at least two parts to group into a block.' }

  const innerEdges = edges.filter((e) => edgeInsideSelection(e, selectedIds))
  const boundaryEdges = edges.filter((e) => selectedIds.has(e.source) !== selectedIds.has(e.target))
  const outsideEdges = edges.filter((e) => !selectedIds.has(e.source) && !selectedIds.has(e.target))

  // Selection bounding box → the block node's position and the port sides.
  const minX = Math.min(...inner.map((n) => n.position.x))
  const minY = Math.min(...inner.map((n) => n.position.y))
  const centerX = inner.reduce((s, n) => s + n.position.x, 0) / inner.length

  // Ports: one per distinct INTERNAL terminal touched by a boundary wire.
  const ports: BlockPort[] = []
  const portByTerminal = new Map<string, BlockPort>()
  const portFor = (nodeId: string, handleId: string): BlockPort => {
    const key = `${nodeId}/${handleId}`
    const existing = portByTerminal.get(key)
    if (existing) return existing
    const node = inner.find((n) => n.id === nodeId)
    const side: 'left' | 'right' = (node?.position.x ?? centerX) <= centerX ? 'left' : 'right'
    const port: BlockPort = {
      id: `port_${ports.length + 1}`,
      label: `${nodeId} · ${handleId.replace(/_/g, ' ')}`,
      side,
      inner: { nodeId, handleId },
    }
    ports.push(port)
    portByTerminal.set(key, port)
    return port
  }

  const rewiredBoundary = boundaryEdges.map((edge) => {
    const sourceInside = selectedIds.has(edge.source)
    const port = sourceInside
      ? portFor(edge.source, edge.sourceHandle ?? '')
      : portFor(edge.target, edge.targetHandle ?? '')
    return sourceInside
      ? { ...edge, source: blockId, sourceHandle: port.id }
      : { ...edge, target: blockId, targetHandle: port.id }
  })

  // Order the pins by their internal-terminal y, so blockLayout stacks each edge sensibly. Positions
  // are computed at render (blockLayout), so a pin always lands centered on its edge — never floating.
  ports.sort((a, b) => {
    const ya = inner.find((n) => n.id === a.inner.nodeId)?.position.y ?? 0
    const yb = inner.find((n) => n.id === b.inner.nodeId)?.position.y ?? 0
    return ya - yb
  })

  const block: BlockData = {
    name,
    origin: { x: minX, y: minY },
    nodes: inner.map((n) => ({
      id: n.id,
      definition: n.data.definition,
      x: n.position.x,
      y: n.position.y,
      ...(n.data.rotation ? { rotation: n.data.rotation } : {}),
      ...(n.data.parameters ? { parameters: n.data.parameters } : {}),
      ...(n.data.block ? { block: n.data.block } : {}),
    })),
    edges: innerEdges.map(edgeData),
    ports,
  }

  const blockNode: CanvasNodeLike = {
    id: blockId,
    type: 'block',
    position: { x: minX, y: minY },
    data: { definition: 'block', label: name, block },
  }

  return {
    nodes: [...nodes.filter((n) => !selectedIds.has(n.id)), blockNode],
    edges: [...outsideEdges, ...rewiredBoundary],
  }
}

/**
 * Explode a block back into its parts — the exact inverse of grouping. If the
 * block node was moved since grouping, the internals move with it (offset by
 * the block's displacement). Boundary wires re-attach to the real internal
 * terminals their ports stood for.
 */
export function ungroupBlock(
  nodes: CanvasNodeLike[],
  edges: CanvasEdgeLike[],
  blockNodeId: string,
): { nodes: CanvasNodeLike[]; edges: CanvasEdgeLike[] } | { reason: string } {
  const blockNode = nodes.find((n) => n.id === blockNodeId)
  const block = blockNode?.data.block
  if (!blockNode || !block) return { reason: 'That is not a block.' }
  const dx = blockNode.position.x - block.origin.x
  const dy = blockNode.position.y - block.origin.y

  const restored: CanvasNodeLike[] = block.nodes.map((n) => ({
    id: n.id,
    type: n.block ? 'block' : n.definition === 'junction' ? 'junction' : 'device',
    position: { x: n.x + dx, y: n.y + dy },
    data: {
      definition: n.definition,
      label: n.block ? n.block.name : n.id,
      ...(n.rotation ? { rotation: n.rotation } : {}),
      ...(n.parameters ? { parameters: n.parameters } : {}),
      ...(n.block ? { block: n.block } : {}),
    },
  }))
  const restoredEdges: CanvasEdgeLike[] = block.edges.map((e) => ({
    id: e.id,
    source: e.source,
    sourceHandle: e.sourceHandle,
    target: e.target,
    targetHandle: e.targetHandle,
    type: 'net',
    deletable: true,
    ...(e.waypoints || e.curved
      ? {
          data: {
            ...(e.waypoints
              ? {
                  waypoints: e.waypoints.map((w) => ({ ...w, x: w.x + dx, y: w.y + dy })),
                }
              : {}),
            ...(e.curved ? { curved: true } : {}),
            ...(typeof e.curveRadius === 'number' ? { curveRadius: e.curveRadius } : {}),
          },
        }
      : {}),
  }))

  const portInner = new Map(block.ports.map((p) => [p.id, p.inner]))
  const rewired = edges
    .filter((e) => e.source !== blockNodeId && e.target !== blockNodeId)
    .concat(
      edges
        .filter((e) => e.source === blockNodeId || e.target === blockNodeId)
        .map((e) => {
          if (e.source === blockNodeId) {
            const inner = portInner.get(e.sourceHandle ?? '')
            return inner ? { ...e, source: inner.nodeId, sourceHandle: inner.handleId } : e
          }
          const inner = portInner.get(e.targetHandle ?? '')
          return inner ? { ...e, target: inner.nodeId, targetHandle: inner.handleId } : e
        }),
    )

  return {
    nodes: [...nodes.filter((n) => n.id !== blockNodeId), ...restored],
    edges: [...rewired, ...restoredEdges],
  }
}

/**
 * Expand every block into its REAL parts for the solve — recursively, with
 * namespaced ids (`blockId.innerId`), and boundary wires routed to the real
 * internal terminals. The solver only ever sees primitive parts: a block is
 * structure, never a model.
 */
export function flattenBlocks(
  nodes: CanvasNodeLike[],
  edges: CanvasEdgeLike[],
): {
  nodes: CanvasNodeLike[]
  edges: CanvasEdgeLike[]
  portTarget: Map<string, { nodeId: string; handleId: string }>
} {
  const flatNodes: CanvasNodeLike[] = []
  const flatEdges: CanvasEdgeLike[] = []
  // port lookup per block node: portId → namespaced inner endpoint
  const portTarget = new Map<string, { nodeId: string; handleId: string }>()

  for (const node of nodes) {
    const block = node.data.block
    if (!block) {
      flatNodes.push(node)
      continue
    }
    const prefix = `${node.id}.`
    const innerNodes: CanvasNodeLike[] = block.nodes.map((n) => ({
      id: `${prefix}${n.id}`,
      position: { x: n.x, y: n.y },
      data: {
        definition: n.definition,
        ...(n.rotation ? { rotation: n.rotation } : {}),
        ...(n.parameters ? { parameters: n.parameters } : {}),
        ...(n.block ? { block: n.block } : {}),
      },
    }))
    const innerEdges: CanvasEdgeLike[] = block.edges.map((e) => ({
      id: `${prefix}${e.id}`,
      source: `${prefix}${e.source}`,
      sourceHandle: e.sourceHandle,
      target: `${prefix}${e.target}`,
      targetHandle: e.targetHandle,
      ...(e.waypoints || e.curved
        ? {
            data: {
              ...(e.waypoints ? { waypoints: e.waypoints } : {}),
              ...(e.curved ? { curved: true } : {}),
              ...(typeof e.curveRadius === 'number' ? { curveRadius: e.curveRadius } : {}),
            },
          }
        : {}),
    }))
    // Recurse — a block inside a block flattens the same way.
    const expanded = flattenBlocks(innerNodes, innerEdges)
    flatNodes.push(...expanded.nodes)
    flatEdges.push(...expanded.edges)
    for (const port of block.ports) {
      // If the inner endpoint is itself a nested block's port, chain through the recursion's
      // resolution so the outer port lands on the real terminal, not the now-flattened block.
      const innerNode = `${prefix}${port.inner.nodeId}`
      const chained = expanded.portTarget.get(`${innerNode}/${port.inner.handleId}`)
      portTarget.set(
        `${node.id}/${port.id}`,
        chained ?? { nodeId: innerNode, handleId: port.inner.handleId },
      )
    }
  }

  for (const edge of edges) {
    let source = edge.source
    let sourceHandle = edge.sourceHandle ?? null
    let target = edge.target
    let targetHandle = edge.targetHandle ?? null
    const fromPort = portTarget.get(`${source}/${sourceHandle ?? ''}`)
    if (fromPort) {
      source = fromPort.nodeId
      sourceHandle = fromPort.handleId
    }
    const toPort = portTarget.get(`${target}/${targetHandle ?? ''}`)
    if (toPort) {
      target = toPort.nodeId
      targetHandle = toPort.handleId
    }
    flatEdges.push({ ...edge, source, sourceHandle, target, targetHandle })
  }

  return { nodes: flatNodes, edges: flatEdges, portTarget }
}

/**
 * Validation bubbles up the hierarchy (per the object model): a failure on an
 * internal part (`block_1.mn`) also marks the block node itself, so the user
 * sees the problem without descending.
 */
export function bubbleBlockHealth<T extends { failed?: boolean; note?: string }>(
  health: Map<string, T>,
): Map<string, T> {
  const bubbled = new Map(health)
  for (const [id, entry] of health) {
    const dot = id.indexOf('.')
    if (dot <= 0 || !entry.failed) continue
    const blockId = id.slice(0, dot)
    const existing = bubbled.get(blockId)
    const note = `inside: ${id.slice(dot + 1)}${entry.note ? ` — ${entry.note}` : ''}`
    bubbled.set(blockId, {
      ...(existing ?? ({} as T)),
      failed: true,
      note: existing?.note ? `${existing.note} · ${note}` : note,
    } as T)
  }
  return bubbled
}

/**
 * Meter aliases: probing a block's PORT reads the real internal terminal it
 * stands for. Returns `${blockId}/${portId}` → `${blockId}.${nodeId}/${handleId}`
 * pairs for every block on the canvas (recursing into nested blocks is not
 * needed — only top-level ports are probeable handles).
 */
export function blockPortAliases(nodes: CanvasNodeLike[]): { outer: string; inner: string }[] {
  const aliases: { outer: string; inner: string }[] = []
  for (const node of nodes) {
    const block = node.data.block
    if (!block) continue
    for (const port of block.ports) {
      aliases.push({
        outer: `${node.id}/${port.id}`,
        inner: `${node.id}.${port.inner.nodeId}/${port.inner.handleId}`,
      })
    }
  }
  return aliases
}

/** Fresh ids for a dropped copy of a block — internals remapped consistently. */
export function cloneBlockData(block: BlockData, suffix: string): BlockData {
  const rename = (id: string) => `${id}_${suffix}`
  return {
    name: block.name,
    origin: { ...block.origin },
    nodes: block.nodes.map((n) => ({
      ...n,
      id: rename(n.id),
      ...(n.parameters ? { parameters: JSON.parse(JSON.stringify(n.parameters)) } : {}),
      ...(n.block ? { block: cloneBlockData(n.block, suffix) } : {}),
    })),
    edges: block.edges.map((e) => ({
      ...e,
      id: rename(e.id),
      source: rename(e.source),
      target: rename(e.target),
      ...(e.waypoints ? { waypoints: e.waypoints.map((w) => ({ ...w })) } : {}),
    })),
    ports: block.ports.map((p) => ({
      ...p,
      inner: { nodeId: rename(p.inner.nodeId), handleId: p.inner.handleId },
    })),
  }
}

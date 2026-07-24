/**
 * FPGA fabric — Stage 1 (the abstract "mini-VPR"), increment 3: the fabric model.
 * The full staging is FPGA-FABRIC-RESEARCH.md Appendix A. This is the shared substrate the placer and
 * the router (later increments) operate on — deliberately built BEFORE those hard engines so they plug
 * into a proven structure.
 *
 * An island-style FPGA is a grid of logic tiles in a sea of routing (research §1). The router does not
 * lay fresh wires; it SELECTS among pre-existing switches, so the fabric is a **routing-resource graph
 * (RRG)**: nodes are wires + tile pins, edges are the programmable connections (**pips**). A route from a
 * driver to a load is a path through this graph.
 *
 *   node kinds : source → opin → (connection block) → chanx/chany track → (switch block) → track →
 *                (connection block) → ipin → sink
 *   pip kinds  : `buffer` (directional, a tri-state/mux — CB + pin pips) and `routing` (a pass switch — SB).
 *
 * Design choice — the schema deliberately mirrors **Project IceStorm's chipdb vocabulary** (research
 * §4a): a `.device W H` grid of typed tiles, wires as nodes (its `.net`), and `.buffer`/`.routing` pips.
 * Two of chipdb's fields are left empty in Stage 1 — `Pip.configBits` is `null` (the CRAM-coordinate
 * hook) and `WireNode.span` is undefined (the segmentation hook) — so today this is a generic island
 * model *shaped to ingest* the real iCE40 data (it becomes a superset once those hooks are filled), and
 * Stage 2 is a data-load into these structures, not a rewrite.
 *
 * Stage-1 simplification (honest): tracks are **full-length** (one node per row/column track), not yet
 * segmented into span-4/span-12 wires — the `span` field is the hook for that later refinement. This is a
 * valid, routable island model; realistic segmentation and sparse Fc/Fs come with the real iCE40 data.
 */

/** Island-fabric architecture knobs (research §1: k = 4–6, N = 4–10, I = ⌈(k/2)(N+1)⌉, Fs = 3). */
export type FabricArch = {
  /** LUT input count. */
  k: number
  /** BLEs (LUT+FF) per logic cluster/tile. */
  n: number
  /** distinct cluster input pins I = ⌈(k/2)(N+1)⌉. */
  clusterInputs: number
  /** routing channel width W (tracks per channel). */
  channelWidth: number
  /** fraction of a channel's tracks an input pin taps (connection-block flexibility Fc,in). */
  fcIn: number
  /** fraction of a channel's tracks an output pin drives (Fc,out). */
  fcOut: number
  /** switch-block flexibility Fs — tracks each track connects to at a channel crossing. */
  fs: number
}

/** The cluster input count for a k-LUT, N-BLE cluster: I = ⌈(k/2)(N+1)⌉ (research §1). */
export function clusterInputs(k: number, n: number): number {
  return Math.ceil((k / 2) * (n + 1))
}

/**
 * A ready-to-use Stage-1 arch: a 4-LUT, one BLE per tile, W = 4, Fs = 3, and a fully-connected CB
 * (Fc = 1 — a generous near-crossbar so a small fabric is always routable; sparse Fc is a later
 * refinement, exercised by the sparse-Fc test).
 */
export const DEFAULT_FABRIC_ARCH: FabricArch = {
  k: 4,
  n: 1,
  clusterInputs: clusterInputs(4, 1),
  channelWidth: 4,
  fcIn: 1,
  fcOut: 1,
  fs: 3,
}

export type TileKind = 'logic' | 'io' | 'empty'
export type FabricTile = { x: number; y: number; kind: TileKind }
export type FabricDevice = {
  gridWidth: number
  gridHeight: number
  arch: FabricArch
  tiles: FabricTile[]
}

export type WireKind = 'source' | 'sink' | 'opin' | 'ipin' | 'chanx' | 'chany'
export type WireNode = {
  id: string
  kind: WireKind
  x: number
  y: number
  /** track index within a channel (chanx/chany only). */
  track?: number
  /** input-pin index (ipin only). */
  pin?: number
  /** how many tiles the wire spans; undefined in Stage 1 (full-length tracks) — the segmentation hook. */
  span?: number
}

export type PipKind = 'buffer' | 'routing'
export type Pip = {
  id: string
  from: string
  to: string
  kind: PipKind
  /** Stage-2 hook: the real CRAM bit coordinate(s) that turn this pip on. `null` in Stage 1. */
  configBits: null
}

export type Rrg = {
  nodes: Map<string, WireNode>
  pips: Pip[]
  /** outgoing pips per node id. */
  edgesFrom: Map<string, Pip[]>
  /** incoming pips per node id. */
  edgesTo: Map<string, Pip[]>
}

export type Fabric = { device: FabricDevice; rrg: Rrg }

/** The `count` track indices an Fc fraction taps, spread evenly across the W tracks. */
function fcTracks(fc: number, w: number): number[] {
  const count = Math.min(w, Math.max(1, Math.round(fc * w)))
  return Array.from({ length: count }, (_, i) => Math.floor((i * w) / count))
}

/** Build the per-node incoming/outgoing pip adjacency maps from a pip list. */
function indexPips(pips: Pip[]): { edgesFrom: Map<string, Pip[]>; edgesTo: Map<string, Pip[]> } {
  const edgesFrom = new Map<string, Pip[]>()
  const edgesTo = new Map<string, Pip[]>()
  const push = (map: Map<string, Pip[]>, key: string, pip: Pip): void => {
    const arr = map.get(key)
    if (arr) arr.push(pip)
    else map.set(key, [pip])
  }
  for (const pip of pips) {
    push(edgesFrom, pip.from, pip)
    push(edgesTo, pip.to, pip)
  }
  return { edgesFrom, edgesTo }
}

/**
 * Generate an island-style fabric: a `gridWidth × gridHeight` grid of logic tiles + a routing-resource
 * graph (one horizontal channel per row and one vertical channel per column, W tracks each; connection
 * blocks tie tile pins to Fc tracks; switch blocks tie crossing channels together with flexibility Fs).
 */
export function generateFabric(arch: FabricArch, gridWidth = 3, gridHeight = 3): Fabric {
  const nodes = new Map<string, WireNode>()
  const pips: Pip[] = []
  const addNode = (node: WireNode): string => {
    nodes.set(node.id, node)
    return node.id
  }
  const addPip = (from: string, to: string, kind: PipKind = 'buffer'): void => {
    pips.push({ id: `p${pips.length}`, from, to, kind, configBits: null })
  }
  const w = arch.channelWidth

  // Logic tiles: each with a SOURCE → OPIN (the cluster output) and I input pins IPIN → SINK.
  const tiles: FabricTile[] = []
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      tiles.push({ x, y, kind: 'logic' })
      addNode({ id: `src_${x}_${y}`, kind: 'source', x, y })
      addNode({ id: `opin_${x}_${y}`, kind: 'opin', x, y })
      addPip(`src_${x}_${y}`, `opin_${x}_${y}`)
      addNode({ id: `sink_${x}_${y}`, kind: 'sink', x, y })
      for (let p = 0; p < arch.clusterInputs; p++) {
        addNode({ id: `ipin_${x}_${y}_${p}`, kind: 'ipin', x, y, pin: p })
        addPip(`ipin_${x}_${y}_${p}`, `sink_${x}_${y}`)
      }
    }
  }

  // Routing channels (full-length tracks in Stage 1): one horizontal per row, one vertical per column.
  for (let y = 0; y < gridHeight; y++) {
    for (let t = 0; t < w; t++) addNode({ id: `chanx_${y}_${t}`, kind: 'chanx', x: 0, y, track: t })
  }
  for (let x = 0; x < gridWidth; x++) {
    for (let t = 0; t < w; t++) addNode({ id: `chany_${x}_${t}`, kind: 'chany', x, y: 0, track: t })
  }

  const outTracks = fcTracks(arch.fcOut, w)
  const inTracks = fcTracks(arch.fcIn, w)
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      // Connection block OUT: the tile's OPIN drives Fc,out tracks of its row + column channels.
      for (const t of outTracks) {
        addPip(`opin_${x}_${y}`, `chanx_${y}_${t}`)
        addPip(`opin_${x}_${y}`, `chany_${x}_${t}`)
      }
      // Connection block IN: each IPIN taps Fc,in tracks of its row + column channels.
      for (let p = 0; p < arch.clusterInputs; p++) {
        for (const t of inTracks) {
          addPip(`chanx_${y}_${t}`, `ipin_${x}_${y}_${p}`)
          addPip(`chany_${x}_${t}`, `ipin_${x}_${y}_${p}`)
        }
      }
      // Switch block: where row-y and column-x channels cross, tie Fs track pairs together (both ways).
      for (let t = 0; t < w; t++) {
        for (let d = 0; d < arch.fs && d < w; d++) {
          const t2 = (t + d) % w
          addPip(`chanx_${y}_${t}`, `chany_${x}_${t2}`, 'routing')
          addPip(`chany_${x}_${t2}`, `chanx_${y}_${t}`, 'routing')
        }
      }
    }
  }

  const { edgesFrom, edgesTo } = indexPips(pips)
  return {
    device: { gridWidth, gridHeight, arch, tiles },
    rrg: { nodes, pips, edgesFrom, edgesTo },
  }
}

/** Structural integrity of an RRG: every pip endpoint is a real node, and the edge maps mirror the pips. */
export function rrgIntegrity(rrg: Rrg): { ok: boolean; issues: string[] } {
  const issues: string[] = []
  for (const pip of rrg.pips) {
    if (!rrg.nodes.has(pip.from))
      issues.push(`pip ${pip.id}: source node "${pip.from}" does not exist`)
    if (!rrg.nodes.has(pip.to)) issues.push(`pip ${pip.id}: target node "${pip.to}" does not exist`)
  }
  const count = (map: Map<string, Pip[]>): number => {
    let total = 0
    for (const arr of map.values()) total += arr.length
    return total
  }
  if (count(rrg.edgesFrom) !== rrg.pips.length) issues.push('edgesFrom does not mirror pips')
  if (count(rrg.edgesTo) !== rrg.pips.length) issues.push('edgesTo does not mirror pips')
  return { ok: issues.length === 0, issues }
}

/** The node ids forward-reachable from `starts` over the pips (a routability probe). */
export function reachableFrom(rrg: Rrg, starts: Iterable<string>): Set<string> {
  const seen = new Set<string>(starts)
  const stack = [...seen]
  while (stack.length > 0) {
    const node = stack.pop() as string
    for (const pip of rrg.edgesFrom.get(node) ?? []) {
      if (!seen.has(pip.to)) {
        seen.add(pip.to)
        stack.push(pip.to)
      }
    }
  }
  return seen
}

/**
 * Serialize a fabric to a text chipdb in Project IceStorm's directive vocabulary (research §4a): a
 * `.device W H` line, an `.arch` line, per-kind `.<kind>_tile X Y` lines, `.net <id> <kind> X Y …` wires,
 * and `.buffer`/`.routing` pips. This is icebox-FLAVOURED, not byte-identical: our net is a single wire
 * node (icebox's is a multi-segment wire) and our pip is a plain from→to (icebox carries the CRAM bit
 * pattern that `Pip.configBits` will hold in Stage 2). The point is to prove the schema round-trips and
 * that a real IceStorm-shaped snippet ingests into these exact types — i.e. Stage 2 is a data-load.
 */
export function serializeChipdb(fabric: Fabric): string {
  const { device, rrg } = fabric
  const a = device.arch
  const lines: string[] = [
    `.device ${device.gridWidth} ${device.gridHeight}`,
    `.arch k=${a.k} n=${a.n} i=${a.clusterInputs} w=${a.channelWidth} fc_in=${a.fcIn} fc_out=${a.fcOut} fs=${a.fs}`,
  ]
  for (const tile of device.tiles) lines.push(`.${tile.kind}_tile ${tile.x} ${tile.y}`)
  for (const node of rrg.nodes.values()) {
    const extra = [
      node.track === undefined ? '' : `track=${node.track}`,
      node.pin === undefined ? '' : `pin=${node.pin}`,
      node.span === undefined ? '' : `span=${node.span}`,
    ]
      .filter((s) => s !== '')
      .join(' ')
    lines.push(`.net ${node.id} ${node.kind} ${node.x} ${node.y}${extra === '' ? '' : ` ${extra}`}`)
  }
  for (const pip of rrg.pips) lines.push(`.${pip.kind} ${pip.from} ${pip.to}`)
  return `${lines.join('\n')}\n`
}

const TILE_KINDS: readonly TileKind[] = ['logic', 'io', 'empty']
const WIRE_KINDS: readonly WireKind[] = ['source', 'sink', 'opin', 'ipin', 'chanx', 'chany']

/**
 * Parse a chipdb text (see `serializeChipdb`) back into a fabric — including a hand-written IceStorm-shaped
 * snippet. Pip `configBits` parse to `null` (the Stage-2 hook); the edge maps are rebuilt from the pips.
 * Unknown directives are ignored so a richer real chipdb still parses its recognized subset.
 */
export function parseChipdb(text: string): Fabric {
  let gridWidth = 0
  let gridHeight = 0
  const arch: FabricArch = { ...DEFAULT_FABRIC_ARCH }
  const tiles: FabricTile[] = []
  const nodes = new Map<string, WireNode>()
  const pips: Pip[] = []
  const num = (s: string | undefined): number => Number(s ?? Number.NaN)

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const tok = line.split(/\s+/)
    const dir = tok[0] ?? ''
    if (dir === '.device') {
      gridWidth = num(tok[1])
      gridHeight = num(tok[2])
    } else if (dir === '.arch') {
      for (const kv of tok.slice(1)) {
        const [key, value] = kv.split('=')
        const v = num(value)
        if (key === 'k') arch.k = v
        else if (key === 'n') arch.n = v
        else if (key === 'i') arch.clusterInputs = v
        else if (key === 'w') arch.channelWidth = v
        else if (key === 'fc_in') arch.fcIn = v
        else if (key === 'fc_out') arch.fcOut = v
        else if (key === 'fs') arch.fs = v
      }
    } else if (dir.endsWith('_tile')) {
      const kind = dir.slice(1).replace(/_tile$/, '')
      if ((TILE_KINDS as readonly string[]).includes(kind)) {
        tiles.push({ x: num(tok[1]), y: num(tok[2]), kind: kind as TileKind })
      }
    } else if (dir === '.net') {
      const id = tok[1]
      const kind = tok[2]
      if (
        id !== undefined &&
        kind !== undefined &&
        (WIRE_KINDS as readonly string[]).includes(kind)
      ) {
        const node: WireNode = { id, kind: kind as WireKind, x: num(tok[3]), y: num(tok[4]) }
        for (const kv of tok.slice(5)) {
          const [key, value] = kv.split('=')
          if (key === 'track') node.track = num(value)
          else if (key === 'pin') node.pin = num(value)
          else if (key === 'span') node.span = num(value)
        }
        nodes.set(id, node)
      }
    } else if (dir === '.buffer' || dir === '.routing') {
      const from = tok[1]
      const to = tok[2]
      if (from !== undefined && to !== undefined) {
        pips.push({
          id: `p${pips.length}`,
          from,
          to,
          kind: dir === '.buffer' ? 'buffer' : 'routing',
          configBits: null,
        })
      }
    }
  }

  const { edgesFrom, edgesTo } = indexPips(pips)
  return {
    device: { gridWidth, gridHeight, arch, tiles },
    rrg: { nodes, pips, edgesFrom, edgesTo },
  }
}

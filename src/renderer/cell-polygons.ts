/**
 * REAL CMOS STANDARD-CELL POLYGONS — the chip-physical chapter's next silicon layer. cell-layout.ts
 * gives each gate a bounding-box AREA; this turns that box into REAL per-layer geometry: n/p diffusion
 * strips, a poly stripe per input, the n-well, power rails, and source/drain/gate contacts — laid out
 * the way a real standard cell is, with series transistors ORDERED along an Euler path so they share
 * diffusion and abut (the payoff that makes a NAND's pull-down one unbroken strip). gds.ts turns these
 * λ rectangles into the exported GDSII a real cell has.
 *
 * COORDINATE SYSTEM: bottom-left origin, +x right, +y UP, units = λ (matches GDSII's y-up, so a cell is
 * emitted upright and the floorplan flips only at placement). Every rect is {x,y,w,h} with (x,y) the
 * bottom-left corner; all coordinates are ≥ 0.
 *
 * HONESTY CAVEAT (this is NOT a foundry-DRC-clean SKY130 cell): the geometry is the AMI/ON-Semi C5N
 * λ-scalable SCMOS *teaching* cell (Harris E158 dimensions, the same basis as cell-layout.ts); the layer
 * NUMBERS are SKY130's, purely so the .gds opens in KLayout / Magic. It has NO well/substrate taps (the 8
 * gate blocks expose no bulk terminal, so wells/bulk are electrically floating), and at a composite gate's
 * internal stage boundary a source/drain contact is placed with reduced poly enclosure to hold the
 * W = columns·8 + 8 λ width invariant. It is for visual/structural inspection, not tapeout — every such
 * relaxation is recorded in `notes[]` rather than hidden.
 */

import { type BlockData, type CanvasNodeLike, flattenBlocks } from './blocks.ts'
import {
  AND_BLOCK,
  BUFFER_BLOCK,
  INVERTER_BLOCK,
  NAND2_BLOCK,
  NOR2_BLOCK,
  OR_BLOCK,
  XNOR_BLOCK,
  XOR_BLOCK,
} from './builtin-blocks.ts'
import { DESIGN_RULES, PROCESS } from './cell-layout.ts'

/** The subset of PDK layer names a standard cell draws on (all present in pdk.ts's SKY130 map). */
export type CellLayerName = 'nwell' | 'diff' | 'poly' | 'licon1' | 'li1' | 'mcon' | 'met1'

/** One rectangle of a cell, in λ, bottom-left origin. `net` is the electrical net it belongs to (for
 *  later colouring / extraction), where meaningful. */
export type CellRect = {
  layer: CellLayerName
  net?: string
  x: number
  y: number
  w: number
  h: number
}

/** A transistor in the extracted netlist. `sd` are the two diffusion nets (source/drain interchangeable
 *  — the blocks label by role, never by layout position, so we never assume which is which). */
export type Mosfet = { id: string; type: 'n' | 'p'; gate: string; sd: [string, string] }

export type GateNetlist = {
  transistors: Mosfet[]
  vdd: string
  vss: string
  out: string
  /** Input nets in block-port order (`['in']` or `['a','b']`). */
  inputs: string[]
  notes: string[]
}

/** One vertical transistor column: the input (gate) it switches, its stage, and the NMOS/PMOS realising
 *  it (a column always has one of each in a complementary cell). */
export type ColumnInfo = {
  index: number
  gate: string
  stage: number
  nmosId?: string
  pmosId?: string
  centerXLambda: number
}

export type CellLayout = {
  name: string
  widthLambda: number
  heightLambda: number
  rects: CellRect[]
  columns: ColumnInfo[]
  stageCount: number
  reliable: boolean
  notes: string[]
}

// ---- the name → block registry (keyed by BlockData.name, the exact string PlacedCell.name carries) ----
// A ReadonlyMap, never an object index: a PlacedCell.name is data (user / imported cells exist) and must
// not reach an inherited Object member — the same prototype-pollution hardening as pdk.ts's LAYER_BY_NAME.
const CELL_BLOCKS: ReadonlyMap<string, BlockData> = new Map([
  [INVERTER_BLOCK.name, INVERTER_BLOCK],
  [BUFFER_BLOCK.name, BUFFER_BLOCK],
  [NAND2_BLOCK.name, NAND2_BLOCK],
  [NOR2_BLOCK.name, NOR2_BLOCK],
  [AND_BLOCK.name, AND_BLOCK],
  [OR_BLOCK.name, OR_BLOCK],
  [XOR_BLOCK.name, XOR_BLOCK],
  [XNOR_BLOCK.name, XNOR_BLOCK],
])

/** The BlockData for a standard-cell gate name, or undefined if it is not one of the 8 primitives. */
export function cellBlock(name: string): BlockData | undefined {
  return CELL_BLOCKS.get(name)
}

// ---- geometry constants (imported from the cited SCMOS rule set — never re-hardcoded) ----
const ruleLambda = (name: string): number => {
  const r = DESIGN_RULES[name]
  if (r === undefined) throw new Error(`design rule "${name}" missing`)
  return r.lambda
}
const POLY_PITCH = PROCESS.polyPitch.lambda // 8 — one input column
const EDGE = PROCESS.edgeMargin.lambda // 4 — n-well / diffusion overhang each side
const RAIL = PROCESS.railWidth.lambda // 8 — VDD/VSS rail width (met1)
const H = PROCESS.rowHeight.lambda // 90 — row height (= floorplan row pitch)
const POLY_W = ruleLambda('minPolyWidth') // 2
const CONTACT = ruleLambda('contactSize') // 2
const ACT_SPACE = ruleLambda('minActiveSpace') // 3 — the diffusion break at a stage boundary

// y-bands (all inside 0..H): rails top and bottom, diffusion rows between, n-well over the p-diffusion.
const VSS_Y = 0
const NDIFF_Y = 12
const DIFF_H = 22
const PDIFF_Y = 56
const VDD_Y = H - RAIL // 82
const NWELL_Y = 50
const NWELL_H = H - NWELL_Y // 40
const POLY_Y = 10
const POLY_H = 70 // 10..80 — crosses both diffusion strips with a 2λ endcap
const GATE_CONTACT_Y = 44 // input gate contact, in the field gap between the diffusion rows
const OUT_JOG_Y = 48 // output-strap horizontal jog band, clear of the gate contacts below it
const NDIFF_CONTACT_Y = NDIFF_Y + DIFF_H / 2 - CONTACT / 2 // centred in the n-diffusion
const PDIFF_CONTACT_Y = PDIFF_Y + DIFF_H / 2 - CONTACT / 2

/** Column c's poly centre-line: edge margin + half a pitch + c pitches. */
const centerX = (c: number): number => EDGE + POLY_PITCH / 2 + c * POLY_PITCH

// ---- disjoint-set over terminal keys, for building nets ----
class DisjointSet {
  private parent = new Map<string, string>()
  find(x: string): string {
    const p = this.parent.get(x)
    if (p === undefined) {
      this.parent.set(x, x)
      return x
    }
    if (p === x) return x
    const root = this.find(p)
    this.parent.set(x, root)
    return root
  }
  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
  add(x: string): void {
    this.find(x)
  }
}

const MOSFET_DEFS = new Set(['transistor_mosfet_nmos', 'transistor_mosfet_pmos'])
const HANDLES = ['gate', 'source', 'drain'] as const

/**
 * Extract the gate's transistor netlist by flattening it to MOSFETs and unioning connected terminals into
 * nets. A net's canonical id is the lexicographically-smallest terminal key in its component — so the same
 * block always yields byte-identical nets (find()'s root alone is path-compression-order-dependent).
 */
export function extractNetlist(block: BlockData): GateNetlist {
  const probe: CanvasNodeLike = {
    id: '_cell',
    position: { x: 0, y: 0 },
    data: { definition: 'block', block },
  }
  const flat = flattenBlocks([probe], [])
  const notes: string[] = []

  const mosNodes = flat.nodes.filter((n) => MOSFET_DEFS.has(n.data.definition))
  const isTerminal = new Set<string>()
  const ds = new DisjointSet()
  for (const n of mosNodes) {
    for (const h of HANDLES) {
      const key = `${n.id}/${h}`
      isTerminal.add(key)
      ds.add(key)
    }
  }
  for (const e of flat.edges) {
    const a = `${e.source}/${e.sourceHandle ?? ''}`
    const b = `${e.target}/${e.targetHandle ?? ''}`
    if (isTerminal.has(a) && isTerminal.has(b)) ds.union(a, b)
  }

  // canonical net id = smallest terminal key in the component
  const canonical = new Map<string, string>()
  for (const key of [...isTerminal].sort()) {
    const root = ds.find(key)
    const current = canonical.get(root)
    if (current === undefined || key < current) canonical.set(root, key)
  }
  const netOf = (nodeId: string, handle: string): string => {
    const key = `${nodeId}/${handle}`
    return canonical.get(ds.find(key)) ?? key
  }

  const portTerminal = (portId: string): string | undefined => {
    const inner = flat.portTarget.get(`_cell/${portId}`)
    if (!inner) {
      notes.push(`port "${portId}" did not resolve to a terminal`)
      return undefined
    }
    return netOf(inner.nodeId, inner.handleId)
  }
  const vdd = portTerminal('v_dd') ?? '__vdd__'
  const vss = portTerminal('gnd') ?? '__vss__'
  const out = portTerminal('out') ?? '__out__'
  const inputs: string[] = []
  for (const port of block.ports) {
    if (port.id === 'a' || port.id === 'b' || port.id === 'in') {
      const net = portTerminal(port.id)
      if (net !== undefined) inputs.push(net)
    }
  }

  const transistors: Mosfet[] = mosNodes.map((n) => ({
    id: n.id,
    type: n.data.definition === 'transistor_mosfet_nmos' ? 'n' : 'p',
    gate: netOf(n.id, 'gate'),
    sd: [netOf(n.id, 'source'), netOf(n.id, 'drain')],
  }))

  if (vdd === vss || vdd === out || vss === out) {
    notes.push('rail/output nets collapsed — netlist looks malformed')
  }
  return { transistors, vdd, vss, out, inputs, notes }
}

// ---- Euler-path column ordering ----
type EulerResult = { labels: string[]; fetIds: string[]; vertices: string[] } | null

/** An Euler path over a transistor network (vertices = diffusion nets, one edge per transistor labelled by
 *  its gate). Returns the ordered gate labels, the fet ids in that order, and the k+1 vertex sequence.
 *  Deterministic start: the lexicographically-smallest of the two odd-degree vertices (or smallest vertex
 *  for an Euler circuit); ties broken by smallest fet id. Null if no Euler path (disconnected / >2 odd). */
function eulerPath(fets: Mosfet[]): EulerResult {
  if (fets.length === 0) return { labels: [], fetIds: [], vertices: [] }
  type Edge = { to: string; fetId: string; gate: string; idx: number }
  const adj = new Map<string, Edge[]>()
  const degree = new Map<string, number>()
  const touch = (v: string) => {
    if (!adj.has(v)) adj.set(v, [])
    degree.set(v, (degree.get(v) ?? 0) + 1)
  }
  fets.forEach((f, idx) => {
    const [a, b] = f.sd
    touch(a)
    touch(b)
    adj.get(a)?.push({ to: b, fetId: f.id, gate: f.gate, idx })
    adj.get(b)?.push({ to: a, fetId: f.id, gate: f.gate, idx })
  })
  // deterministic adjacency order (smallest fet id first)
  for (const list of adj.values())
    list.sort((x, y) => (x.fetId < y.fetId ? -1 : x.fetId > y.fetId ? 1 : 0))

  const vertices = [...degree.keys()].sort()
  const odd = vertices.filter((v) => (degree.get(v) ?? 0) % 2 === 1)
  if (odd.length !== 0 && odd.length !== 2) return null
  const start = odd.length === 2 ? odd[0] : vertices[0]
  if (start === undefined) return null

  // Hierholzer, tracking used edge indices (handles parallel edges).
  const used = new Array(fets.length).fill(false)
  const vertexStack: string[] = [start]
  const edgeStack: (Edge | null)[] = [null]
  const trailV: string[] = []
  const trailE: (Edge | null)[] = []
  while (vertexStack.length > 0) {
    const v = vertexStack[vertexStack.length - 1] as string
    const next = (adj.get(v) ?? []).find((e) => !used[e.idx])
    if (next === undefined) {
      trailV.push(v)
      trailE.push(edgeStack.pop() ?? null)
      vertexStack.pop()
      continue
    }
    used[next.idx] = true
    vertexStack.push(next.to)
    edgeStack.push(next)
  }
  if (trailV.length !== fets.length + 1) return null // disconnected
  trailV.reverse()
  trailE.reverse()
  const labels: string[] = []
  const fetIds: string[] = []
  for (let i = 1; i < trailE.length; i++) {
    const e = trailE[i]
    if (!e) return null
    labels.push(e.gate)
    fetIds.push(e.fetId)
  }
  return { labels, fetIds, vertices: trailV }
}

/** Walk `fets` consuming their edges in the exact gate-label order `labels` (each used once), returning the
 *  resulting k+1 vertex sequence + fet-id order. Tries every start vertex; deterministic tie-break by fet
 *  id. Null if the network cannot be traversed in that label order. */
function realize(
  fets: Mosfet[],
  labels: string[],
): { vertices: string[]; fetIds: string[] } | null {
  if (labels.length === 0) return { vertices: [], fetIds: [] }
  const starts = [...new Set(fets.flatMap((f) => f.sd))].sort()
  for (const start of starts) {
    const used = new Array(fets.length).fill(false)
    const vertices = [start]
    const fetIds: string[] = []
    let v = start
    let ok = true
    for (const label of labels) {
      const candidates = fets
        .map((f, idx) => ({ f, idx }))
        .filter(({ f, idx }) => !used[idx] && f.gate === label && (f.sd[0] === v || f.sd[1] === v))
        .sort((x, y) => (x.f.id < y.f.id ? -1 : x.f.id > y.f.id ? 1 : 0))
      const pick = candidates[0]
      if (pick === undefined) {
        ok = false
        break
      }
      used[pick.idx] = true
      v = pick.f.sd[0] === v ? pick.f.sd[1] : pick.f.sd[0]
      vertices.push(v)
      fetIds.push(pick.f.id)
    }
    if (ok) return { vertices, fetIds }
  }
  return null
}

// ---- stage clustering ----
type Stage = { transistors: Mosfet[]; outputNet: string }

/** Partition the transistors into stages = connected components of the diffusion graph over NON-rail nets
 *  (a gate's pull-up and pull-down share their output diffusion → same stage; stages connect only through a
 *  gate net → separate). Ordered input-stages-first by a topological sort over "stage A's output drives a
 *  gate in stage B". */
function buildStages(net: GateNetlist): Stage[] {
  const fets = net.transistors
  const rails = new Set([net.vdd, net.vss])
  const ds = new DisjointSet()
  for (const f of fets) ds.add(f.id)
  // link transistors that share a non-rail diffusion net
  const byNet = new Map<string, string[]>()
  for (const f of fets) {
    for (const s of f.sd) {
      if (rails.has(s)) continue
      const list = byNet.get(s) ?? []
      list.push(f.id)
      byNet.set(s, list)
    }
  }
  for (const ids of byNet.values()) {
    for (let i = 1; i < ids.length; i++) ds.union(ids[0] as string, ids[i] as string)
  }
  const groups = new Map<string, Mosfet[]>()
  for (const f of fets) {
    const root = ds.find(f.id)
    const list = groups.get(root) ?? []
    list.push(f)
    groups.set(root, list)
  }

  const stages: Stage[] = [...groups.values()].map((transistors) => {
    // output net = the unique non-rail net shared by an NMOS sd AND a PMOS sd in this stage
    const nNets = new Set(transistors.filter((t) => t.type === 'n').flatMap((t) => t.sd))
    const pNets = transistors.filter((t) => t.type === 'p').flatMap((t) => t.sd)
    const shared = [...new Set(pNets)].filter((s) => nNets.has(s) && !rails.has(s)).sort()
    return { transistors, outputNet: shared[0] ?? '' }
  })

  // topological order: stage A precedes B if A.outputNet drives a gate in B
  const outputToStage = new Map<string, number>()
  stages.forEach((s, i) => {
    if (s.outputNet) outputToStage.set(s.outputNet, i)
  })
  const deps = stages.map((s) => {
    const set = new Set<number>()
    for (const t of s.transistors) {
      const src = outputToStage.get(t.gate)
      if (src !== undefined && stages[src] !== s) set.add(src)
    }
    return set
  })
  const order: number[] = []
  const placed = new Set<number>()
  const visit = (i: number, guard: Set<number>) => {
    if (placed.has(i) || guard.has(i)) return
    guard.add(i)
    for (const d of [...(deps[i] as Set<number>)].sort((a, b) => a - b)) visit(d, guard)
    if (!placed.has(i)) {
      placed.add(i)
      order.push(i)
    }
  }
  for (let i = 0; i < stages.length; i++) visit(i, new Set())
  return order.map((i) => stages[i] as Stage)
}

// ---- column ordering per stage ----
type OrderedColumn = { gate: string; nmosId?: string | undefined; pmosId?: string | undefined }
type StageColumns = {
  columns: OrderedColumn[]
  nVertices: string[]
  pVertices: string[]
  broken: boolean
}

const distinctVertices = (fets: Mosfet[]): number => new Set(fets.flatMap((f) => f.sd)).size

/** Order one stage's columns via a COMMON Euler path: drive the label order from the more-constrained
 *  (series) network and realise the same order in the other (the parallel dual always can) so the poly
 *  columns are straight and shared by both rows. Falls back to one-column-per-pair with breaks if no common
 *  ordering exists. */
function orderStage(stage: Stage): StageColumns {
  const nmos = stage.transistors.filter((t) => t.type === 'n')
  const pmos = stage.transistors.filter((t) => t.type === 'p')
  const primaryIsN = distinctVertices(nmos) >= distinctVertices(pmos)
  const primaryFets = primaryIsN ? nmos : pmos
  const otherFets = primaryIsN ? pmos : nmos

  const euler = eulerPath(primaryFets)
  const other = euler ? realize(otherFets, euler.labels) : null
  if (euler && other && other.fetIds.length === euler.fetIds.length) {
    const columns: OrderedColumn[] = euler.labels.map((gate, i) => {
      const primaryId = euler.fetIds[i]
      const otherId = other.fetIds[i]
      return primaryIsN
        ? { gate, nmosId: primaryId, pmosId: otherId }
        : { gate, nmosId: otherId, pmosId: primaryId }
    })
    return {
      columns,
      nVertices: primaryIsN ? euler.vertices : other.vertices,
      pVertices: primaryIsN ? other.vertices : euler.vertices,
      broken: false,
    }
  }

  // fallback: pair NMOS/PMOS by shared gate, one column each, a diffusion break between every column
  const byGate = new Map<string, { n?: string; p?: string }>()
  const gateOrder: string[] = []
  for (const t of [...stage.transistors].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!byGate.has(t.gate)) {
      byGate.set(t.gate, {})
      gateOrder.push(t.gate)
    }
    const slot = byGate.get(t.gate) as { n?: string; p?: string }
    if (t.type === 'n') slot.n = t.id
    else slot.p = t.id
  }
  const columns = gateOrder.map((gate) => ({
    gate,
    nmosId: byGate.get(gate)?.n,
    pmosId: byGate.get(gate)?.p,
  }))
  return { columns, nVertices: [], pVertices: [], broken: true }
}

// ---- polygon assembly ----
type Run = { firstCol: number; lastCol: number; vertices: string[] }

const rectFrom = (
  layer: CellLayerName,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  net?: string,
): CellRect => ({
  layer,
  ...(net ? { net } : {}),
  x: Math.min(x0, x1),
  y: Math.min(y0, y1),
  w: Math.abs(x1 - x0),
  h: Math.abs(y1 - y0),
})

/**
 * The full per-layer polygon set for a gate standard cell. Never throws: an unrecognised / malformed block
 * still yields valid, non-overlapping rails + wells + poly + broken diffusion, with reliable=false and a
 * note explaining the fallback.
 */
export function cellPolygons(block: BlockData): CellLayout {
  const net = extractNetlist(block)
  const notes = [...net.notes]
  const stages = buildStages(net)

  // lay stages left→right; global column index runs continuously across stages
  const columns: ColumnInfo[] = []
  const nRuns: Run[] = []
  const pRuns: Run[] = []
  let broken = false
  let globalCol = 0
  stages.forEach((stage, stageIndex) => {
    const ordered = orderStage(stage)
    if (ordered.broken) broken = true
    const firstCol = globalCol
    for (const col of ordered.columns) {
      columns.push({
        index: globalCol,
        gate: col.gate,
        stage: stageIndex,
        ...(col.nmosId ? { nmosId: col.nmosId } : {}),
        ...(col.pmosId ? { pmosId: col.pmosId } : {}),
        centerXLambda: centerX(globalCol),
      })
      globalCol += 1
    }
    const lastCol = globalCol - 1
    if (ordered.columns.length > 0 && !ordered.broken) {
      nRuns.push({ firstCol, lastCol, vertices: ordered.nVertices })
      pRuns.push({ firstCol, lastCol, vertices: ordered.pVertices })
    } else if (ordered.columns.length > 0) {
      // broken: each column its own single-column run (diffusion break between all)
      for (let c = firstCol; c <= lastCol; c++) {
        nRuns.push({ firstCol: c, lastCol: c, vertices: [] })
        pRuns.push({ firstCol: c, lastCol: c, vertices: [] })
      }
    }
  })

  const totalCols = columns.length
  const widthLambda = Math.max(1, totalCols) * POLY_PITCH + 2 * EDGE
  const rects: CellRect[] = []

  // power rails (full width, so tiled cells share them) + n-well over the p-diffusion row
  rects.push(rectFrom('met1', 0, VSS_Y, widthLambda, VSS_Y + RAIL, net.vss))
  rects.push(rectFrom('met1', 0, VDD_Y, widthLambda, VDD_Y + RAIL, net.vdd))
  rects.push(rectFrom('nwell', 0, NWELL_Y, widthLambda, NWELL_Y + NWELL_H))

  // poly stripe per column, crossing both diffusion rows
  for (const col of columns) {
    rects.push(
      rectFrom(
        'poly',
        col.centerXLambda - POLY_W / 2,
        POLY_Y,
        col.centerXLambda + POLY_W / 2,
        POLY_Y + POLY_H,
        col.gate,
      ),
    )
  }

  // diffusion strips (one rect per abutted run) + their contacts
  const isEdge = (col: number, side: 'left' | 'right') =>
    side === 'left' ? col === 0 : col === totalCols - 1
  const emitDiffusion = (runs: Run[], diffY: number, contactY: number) => {
    for (const run of runs) {
      const leftEdge = isEdge(run.firstCol, 'left')
      const rightEdge = isEdge(run.lastCol, 'right')
      const leftExt = leftEdge ? EDGE : (POLY_PITCH - ACT_SPACE) / 2
      const rightExt = rightEdge ? EDGE : (POLY_PITCH - ACT_SPACE) / 2
      const x0 = centerX(run.firstCol) - leftExt
      const x1 = centerX(run.lastCol) + rightExt
      rects.push(rectFrom('diff', x0, diffY, x1, diffY + DIFF_H))
      emitDiffContacts(run, diffY === NDIFF_Y, contactY, leftEdge, rightEdge)
    }
  }

  // each stage's OUTPUT net gets a diffusion contact on both rows (so it can route on); the series-middle
  // internal nets do not (the Euler-abutment payoff). Rails always get a contact + strap.
  const stageOutputs = new Set(stages.map((s) => s.outputNet).filter((s) => s.length > 0))
  const railStraps: { x: number; net: string }[] = []
  const outByNet = new Map<string, { n: number[]; p: number[] }>()
  const emitDiffContacts = (
    run: Run,
    isN: boolean,
    contactY: number,
    leftEdge: boolean,
    rightEdge: boolean,
  ) => {
    const k = run.lastCol - run.firstCol + 1
    if (run.vertices.length !== k + 1) return // broken run: no vertex nets → no contacts
    for (let j = 0; j < run.vertices.length; j++) {
      const vnet = run.vertices[j] as string
      const isRail = vnet === net.vdd || vnet === net.vss
      const isOutput = stageOutputs.has(vnet)
      if (!isRail && !isOutput) continue // internal series-middle net: no contact (the Euler payoff)
      // end contacts sit clear of the column's poly; a stage-break end places the contact flush against
      // the poly edge (extending ~0.5λ past the shortened diffusion — the reduced enclosure), so it never
      // overlaps the input gate pin's li1 landing on that column.
      let cx: number
      if (j === 0)
        cx = leftEdge
          ? centerX(run.firstCol) - EDGE + 0.5
          : centerX(run.firstCol) - POLY_W / 2 - CONTACT
      else if (j === run.vertices.length - 1)
        cx = rightEdge ? centerX(run.lastCol) + 1.5 : centerX(run.lastCol) + POLY_W / 2
      else cx = centerX(run.firstCol + j - 1) + POLY_PITCH / 2 - CONTACT / 2
      if ((j === 0 && !leftEdge) || (j === run.vertices.length - 1 && !rightEdge)) {
        notes.push(
          `reduced contact enclosure at a stage boundary (net ${isOutput ? 'output' : 'rail'})`,
        )
      }
      rects.push(rectFrom('licon1', cx, contactY, cx + CONTACT, contactY + CONTACT, vnet))
      if (isRail) railStraps.push({ x: cx, net: vnet })
      if (isOutput) {
        const slot = outByNet.get(vnet) ?? { n: [], p: [] }
        ;(isN ? slot.n : slot.p).push(cx)
        outByNet.set(vnet, slot)
      }
    }
  }

  emitDiffusion(nRuns, NDIFF_Y, NDIFF_CONTACT_Y)
  emitDiffusion(pRuns, PDIFF_Y, PDIFF_CONTACT_Y)

  // rail straps: an li1 that spans the whole way from the diffusion contact THROUGH the rail, plus an mcon
  // (li1↔met1 via) inside the rail. The li1 must reach the rail's far edge so it covers the via — VSS down
  // to VSS_Y (0), VDD up to VDD_Y + RAIL — otherwise the ground/supply extracts as open.
  for (const strap of railStraps) {
    const toVdd = strap.net === net.vdd
    const y0 = toVdd ? PDIFF_CONTACT_Y : VSS_Y
    const y1 = toVdd ? VDD_Y + RAIL : NDIFF_CONTACT_Y + CONTACT
    rects.push(
      rectFrom('li1', strap.x, Math.min(y0, y1), strap.x + CONTACT, Math.max(y0, y1), strap.net),
    )
    const mconY = toVdd ? VDD_Y + 2 : VSS_Y + 2
    rects.push(rectFrom('mcon', strap.x, mconY, strap.x + CONTACT, mconY + CONTACT, strap.net))
  }

  // output strap per stage-output net: tie EVERY output diffusion contact (a parallel row has an output
  // contact at BOTH ends) together. A horizontal li1 spine on a band clear of the input gate contacts runs
  // across the stage's output contacts; a vertical li1 drops from the spine INTO each contact (covering the
  // licon1 cut, not merely touching it). The spine stays within the stage's own columns, so stages don't
  // collide. Stubs span from inside the n-diff contact (NDIFF_CONTACT_Y) up / down to inside the p-diff one.
  for (const [vnet, slot] of [...outByNet.entries()].sort()) {
    if (slot.n.length === 0 || slot.p.length === 0) continue
    const xs = [...slot.n, ...slot.p]
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    rects.push(rectFrom('li1', minX, OUT_JOG_Y, maxX + CONTACT, OUT_JOG_Y + CONTACT, vnet))
    for (const x of slot.n) {
      rects.push(rectFrom('li1', x, NDIFF_CONTACT_Y, x + CONTACT, OUT_JOG_Y + CONTACT, vnet))
    }
    for (const x of slot.p) {
      rects.push(rectFrom('li1', x, OUT_JOG_Y, x + CONTACT, PDIFF_CONTACT_Y + CONTACT, vnet))
    }
  }

  // input gate contacts (poly → li1 landing pin) for the columns switched by a primary input
  const inputSet = new Set(net.inputs)
  for (const col of columns) {
    if (!inputSet.has(col.gate)) {
      if (!broken)
        notes.push(
          `internal gate net on column ${col.index} — inter-stage route left to the router`,
        )
      continue
    }
    const cx = col.centerXLambda - CONTACT / 2
    rects.push(
      rectFrom('licon1', cx, GATE_CONTACT_Y, cx + CONTACT, GATE_CONTACT_Y + CONTACT, col.gate),
    )
    rects.push(
      rectFrom('li1', cx, GATE_CONTACT_Y, cx + CONTACT, GATE_CONTACT_Y + CONTACT, col.gate),
    )
  }

  const balanced =
    net.transistors.filter((t) => t.type === 'n').length ===
    net.transistors.filter((t) => t.type === 'p').length
  const reliable = !broken && balanced && net.transistors.length > 0 && net.notes.length === 0
  if (broken)
    notes.push('no common Euler ordering — diffusion broken between columns (area-estimate layout)')

  return {
    name: block.name,
    widthLambda,
    heightLambda: H,
    rects,
    columns,
    stageCount: stages.length,
    reliable,
    notes,
  }
}

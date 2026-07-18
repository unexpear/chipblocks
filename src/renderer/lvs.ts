/**
 * LAYOUT-VERSUS-SCHEMATIC (LVS) — the chip-physical chapter's capstone. It recovers a transistor netlist
 * from a cell's drawn polygons USING GEOMETRY ALONE (poly×diffusion crossings = devices; same-layer overlap
 * + contact stacks = nets) and structurally compares it against the schematic netlist the cell was built
 * from. This closes the loop: it proves the drawn silicon IS the circuit — the chip-side twin of the board's
 * connectivity checks. The CellRect `net` labels are used only for human-readable report names, NEVER for
 * connectivity — the verdict is decided by graph structure, so scrambling the labels can't change it.
 *
 * OUTCOME: all 8 library cells LVS-MATCH from geometry alone — the drawn silicon provably IS the circuit.
 * (Before the inter-stage router, a composite gate's driven gate poly was left unrouted and extracted as a
 * FLOATING net, so the 5 composites came back as a MISMATCH flagged `areaEstimate: true`. The router
 * strapping every multi-column gate net closed that gap; the `areaEstimate` flag remains for any future
 * layout that leaves a gate net open, distinguishing an expected unrouted estimate from a true regression.)
 *
 * All geometry is in λ, bottom-left origin, y-up (matching cell-polygons.ts). Body/bulk is ignored on both
 * sides (the teaching cells expose no bulk terminal; the schematic MOSFETs are 3-terminal), so LVS is
 * legitimately body-agnostic here.
 */

import type { BlockData } from './blocks.ts'
import { STANDARD_CELL_BLOCKS } from './cell-drc.ts'
import {
  type CellRect,
  cellBlock,
  cellPolygons,
  extractNetlist,
  type GateNetlist,
} from './cell-polygons.ts'

// ---- small geometry helpers (local copies of cell-drc.ts's — only a 2nd use, below CLAUDE.md's
//      three-uses-before-extracting bar; keep them here rather than couple two verified modules) ----
const EPS = 1e-6
type Rect = { x: number; y: number; w: number; h: number }
const r3 = (v: number): number => Math.round(v * 1000) / 1000
const rectContains = (outer: Rect, inner: Rect): boolean =>
  outer.x - EPS <= inner.x &&
  inner.x + inner.w <= outer.x + outer.w + EPS &&
  outer.y - EPS <= inner.y &&
  inner.y + inner.h <= outer.y + outer.h + EPS
/** POSITIVE shared area (not a mere edge-touch) — the rule that fuses one conductor without merging two
 *  different-net shapes that only abut (the tightest real different-net li1 gap is 0.5 λ, zero shared area). */
const rectsOverlapArea = (a: Rect, b: Rect): boolean =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > EPS &&
  Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > EPS
const rectIntersect = (a: Rect, b: Rect): Rect => {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  return { x, y, w: Math.min(a.x + a.w, b.x + b.w) - x, h: Math.min(a.y + a.h, b.y + b.h) - y }
}
const pointInIntervalX = (x: number, x0: number, x1: number): boolean =>
  x0 - EPS <= x && x <= x1 + EPS
const pointInRectXY = (x: number, y: number, r: Rect): boolean =>
  r.x - EPS <= x && x <= r.x + r.w + EPS && r.y - EPS <= y && y <= r.y + r.h + EPS

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

export type LayoutNodeKind = 'diff_region' | 'poly' | 'li1' | 'met1'
export type ExtractedMosfet = { id: string; type: 'n' | 'p'; gate: string; sd: [string, string] }

export type ExtractedNetlist = {
  transistors: ExtractedMosfet[]
  vdd: string
  vss: string
  out: string
  /** Primary-input nets, ordered by gate-column x ascending. */
  inputs: string[]
  /** All net ids, deterministically sorted (N0, N1, …). */
  nets: string[]
  /** net id → sorted distinct CellRect.net labels seen (report / anchor names ONLY, never a verdict). */
  labels: Map<string, string[]>
  notes: string[]
}

type LNode = { key: string; kind: LayoutNodeKind; rect: Rect; pType?: 'n' | 'p' }
const KIND_RANK: Record<LayoutNodeKind, number> = { diff_region: 0, li1: 1, met1: 2, poly: 3 }

/**
 * Recover a transistor netlist from a cell's rectangles using geometry alone. Never throws — any
 * unresolvable feature becomes a note and extraction continues.
 */
export function extractLayoutNetlist(rects: CellRect[]): ExtractedNetlist {
  const notes: string[] = []
  const of = (layer: CellRect['layer']) => rects.filter((r) => r.layer === layer)
  const polys = of('poly')
  const diffs = of('diff')
  const nwells = of('nwell')
  const li1s = of('li1')
  const met1s = of('met1')
  const licons = of('licon1')
  const mcons = of('mcon')

  const ds = new DisjointSet()
  const nodes = new Map<string, LNode>()
  const add = (key: string, kind: LayoutNodeKind, rect: Rect, pType?: 'n' | 'p') => {
    if (!nodes.has(key)) {
      nodes.set(key, pType ? { key, kind, rect, pType } : { key, kind, rect })
      ds.add(key)
    }
  }
  const polyKey = (p: CellRect) => `poly@${r3(p.x)}/${r3(p.y)}`
  const li1Key = (l: CellRect) => `li1@${r3(l.x)}/${r3(l.y)}/${r3(l.w)}/${r3(l.h)}`
  const met1Key = (m: CellRect) => `met1@${r3(m.x)}/${r3(m.y)}/${r3(m.w)}/${r3(m.h)}`
  for (const p of polys) add(polyKey(p), 'poly', p)
  for (const l of li1s) add(li1Key(l), 'li1', l)
  for (const m of met1s) add(met1Key(m), 'met1', m)

  // STEP 1+2: devices (poly × diff crossing) and diffusion-region splitting.
  type Dev = { id: string; type: 'n' | 'p'; gateKey: string; leftKey: string; rightKey: string }
  const devices: Dev[] = []
  for (const d of diffs) {
    const stripP: 'n' | 'p' = nwells.some((nw) => rectContains(nw, d)) ? 'p' : 'n'
    const crossing = polys.filter((p) => rectsOverlapArea(p, d)).sort((a, b) => a.x - b.x)
    const regionKeys: string[] = []
    for (let i = 0; i <= crossing.length; i++) {
      const x0 = i === 0 ? d.x : (crossing[i - 1] as CellRect).x + (crossing[i - 1] as CellRect).w
      const x1 = i === crossing.length ? d.x + d.w : (crossing[i] as CellRect).x
      const key = `reg@${r3(d.y)}/${r3(x0)}-${r3(x1)}`
      add(key, 'diff_region', { x: x0, y: d.y, w: x1 - x0, h: d.h }, stripP)
      regionKeys.push(key)
    }
    crossing.forEach((p, i) => {
      const ch = rectIntersect(p, d)
      const type: 'n' | 'p' = nwells.some((nw) => rectContains(nw, ch)) ? 'p' : 'n'
      const cx = p.x + p.w / 2
      devices.push({
        id: `fet@${type}/${r3(cx)}/${r3(d.y)}`,
        type,
        gateKey: polyKey(p),
        leftKey: regionKeys[i] as string,
        rightKey: regionKeys[i + 1] as string,
      })
    })
  }

  // STEP 3a: same-layer positive-overlap merge (poly / li1 / met1 — NEVER diff regions).
  const mergeLayer = (list: CellRect[], keyFn: (r: CellRect) => string) => {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i] as CellRect
        const b = list[j] as CellRect
        if (rectsOverlapArea(a, b)) ds.union(keyFn(a), keyFn(b))
      }
    }
  }
  mergeLayer(polys, polyKey)
  mergeLayer(li1s, li1Key)
  mergeLayer(met1s, met1Key)

  const regions = [...nodes.values()].filter((n) => n.kind === 'diff_region')
  // STEP 3b: licon1 bridge (diff region OR poly, below ↔ li1, above), by contact CENTRE (tolerates the
  // 0.5 λ stage-boundary overhang that a strict containment test would miss).
  for (const c of licons) {
    const cx = c.x + c.w / 2
    const cy = c.y + c.h / 2
    let below = regions.find(
      (n) =>
        pointInIntervalX(cx, n.rect.x, n.rect.x + n.rect.w) &&
        cy >= n.rect.y - EPS &&
        cy <= n.rect.y + n.rect.h + EPS,
    )?.key
    if (below === undefined) {
      const p = polys.find((pp) => pointInRectXY(cx, cy, pp))
      if (p) below = polyKey(p)
    }
    const above = li1s.find((l) => rectsOverlapArea(c, l))
    if (below !== undefined && above) ds.union(below, li1Key(above))
    else notes.push(`unresolved licon1 at (${r3(cx)}, ${r3(cy)})`)
  }
  // STEP 3c: mcon bridge (li1 ↔ met1).
  for (const m of mcons) {
    const below = li1s.find((l) => rectsOverlapArea(m, l))
    const above = met1s.find((mt) => rectsOverlapArea(m, mt))
    if (below && above) ds.union(li1Key(below), met1Key(above))
    else notes.push(`unresolved mcon at (${r3(m.x)}, ${r3(m.y)})`)
  }

  // Canonical net ids: sort components by their smallest node key (kind, x, y, w, h), assign N0, N1, …
  const nodeSort = (k: string): [number, number, number, number, number] => {
    const n = nodes.get(k) as LNode
    return [KIND_RANK[n.kind], r3(n.rect.x), r3(n.rect.y), r3(n.rect.w), r3(n.rect.h)]
  }
  const cmpTuple = (a: number[], b: number[]): number => {
    for (let i = 0; i < a.length; i++) {
      if ((a[i] as number) !== (b[i] as number)) return (a[i] as number) - (b[i] as number)
    }
    return 0
  }
  const comps = new Map<string, string[]>()
  for (const key of nodes.keys()) {
    const root = ds.find(key)
    const list = comps.get(root) ?? []
    list.push(key)
    comps.set(root, list)
  }
  const compReps = [...comps.values()]
    .map((keys) => ({
      keys,
      min: [...keys].sort((a, b) => cmpTuple(nodeSort(a), nodeSort(b)))[0] as string,
    }))
    .sort((a, b) => cmpTuple(nodeSort(a.min), nodeSort(b.min)))
  const netOfKey = new Map<string, string>()
  compReps.forEach((c, i) => {
    for (const k of c.keys) netOfKey.set(k, `N${i}`)
  })
  const net = (key: string) => netOfKey.get(key) as string

  // labels (report only): net id → distinct source CellRect.net labels touching that component.
  const labels = new Map<string, string[]>()
  const noteLabel = (key: string, label?: string) => {
    if (label === undefined) return
    const id = net(key)
    const set = labels.get(id) ?? []
    if (!set.includes(label)) set.push(label)
    labels.set(id, set.sort())
  }
  for (const p of polys) noteLabel(polyKey(p), p.net)
  for (const l of li1s) noteLabel(li1Key(l), l.net)
  for (const m of met1s) noteLabel(met1Key(m), m.net)

  const transistors: ExtractedMosfet[] = devices.map((d) => ({
    id: d.id,
    type: d.type,
    gate: net(d.gateKey),
    sd: [net(d.leftKey), net(d.rightKey)],
  }))

  // Rails by met1 y-position (SCMOS row convention: top rail = VDD, bottom = VSS — a layout invariant).
  const topRail = met1s.length > 0 ? met1s.reduce((a, b) => (b.y > a.y ? b : a)) : undefined
  const botRail = met1s.length > 0 ? met1s.reduce((a, b) => (b.y < a.y ? b : a)) : undefined
  const vdd = topRail ? net(met1Key(topRail)) : ''
  const vss = botRail ? net(met1Key(botRail)) : ''
  if (!vdd || !vss) notes.push('could not resolve a VDD/VSS rail (open supply)')

  // regions grouped by net, for the output-tie test (a net touching both an n-region and a p-region).
  const nNetsWithRegion = new Set<string>()
  const pNetsWithRegion = new Set<string>()
  for (const rg of regions) {
    ;(rg.pType === 'p' ? pNetsWithRegion : nNetsWithRegion).add(net(rg.key))
  }
  const gateNets = new Set(transistors.map((t) => t.gate))
  const outCandidates = [...new Set(transistors.flatMap((t) => t.sd))]
    .filter((id) => id !== vdd && id !== vss && nNetsWithRegion.has(id) && pNetsWithRegion.has(id))
    .filter((id) => !gateNets.has(id))
    .sort()
  const out = outCandidates[0] ?? ''
  if (outCandidates.length === 0) notes.push('no tied output net found')
  if (outCandidates.length > 1) notes.push('multiple output-tie candidates (unrouted composite)')

  // inputs: poly nets that reach a gate contact (a licon1 whose centre sits on the poly), by x ascending.
  // A PRIMARY input is poly-only — it never touches a diffusion region. A driven/inter-stage net also has a
  // gate contact now (the router strapped it) but its component touches the driver's diffusion, so excluding
  // region-touching nets keeps those out of `inputs` (otherwise WL would mis-anchor them as inputs).
  const netTouchesRegion = new Set([...nNetsWithRegion, ...pNetsWithRegion])
  const gateContactPoly = new Set<string>()
  for (const c of licons) {
    const cx = c.x + c.w / 2
    const cy = c.y + c.h / 2
    const p = polys.find((pp) => pointInRectXY(cx, cy, pp))
    if (p) gateContactPoly.add(polyKey(p))
  }
  const inputs = [...polys]
    .filter((p) => gateContactPoly.has(polyKey(p)))
    .sort((a, b) => a.x - b.x)
    .map((p) => net(polyKey(p)))
    .filter((id) => !netTouchesRegion.has(id))
    .filter((id, i, arr) => arr.indexOf(id) === i)

  // floating-gate note: a poly that IS a transistor gate but reaches no gate contact — the unrouted
  // inter-stage net that flips areaEstimate for the composites.
  for (const p of polys) {
    const id = net(polyKey(p))
    if (gateNets.has(id) && !gateContactPoly.has(polyKey(p))) {
      notes.push('unrouted inter-stage gate net (area-estimate layout)')
      break
    }
  }

  return {
    transistors,
    vdd,
    vss,
    out,
    inputs,
    nets: compReps.map((_, i) => `N${i}`),
    labels,
    notes,
  }
}

// ================================ the comparator ================================

export type LvsDiscrepancyKind =
  | 'device_count'
  | 'device_type'
  | 'connectivity'
  | 'short'
  | 'open'
  | 'floating'
  | 'indeterminate'

export type LvsDiscrepancy = {
  kind: LvsDiscrepancyKind
  detail: string
}

export type LvsResult = {
  status: 'match' | 'mismatch'
  match: boolean
  /** true when the mismatch is an EXPECTED unrouted-inter-stage composite, not a real regression. */
  areaEstimate: boolean
  schematic: GateNetlist
  layout: ExtractedNetlist
  netMap: Map<string, string>
  deviceMap: Map<string, string>
  deviceCountSchematic: number
  deviceCountLayout: number
  discrepancies: LvsDiscrepancy[]
  notes: string[]
}

type Graph = {
  transistors: ExtractedMosfet[]
  role: (net: string) => string
}

const roleOf = (nl: {
  vdd: string
  vss: string
  out: string
  inputs: string[]
}): ((net: string) => string) => {
  const inputs = new Set(nl.inputs)
  return (net: string) => {
    if (net && net === nl.vdd) return 'VDD'
    if (net && net === nl.vss) return 'VSS'
    if (net && net === nl.out) return 'OUT'
    if (inputs.has(net)) return 'IN'
    return 'NET'
  }
}

/**
 * Anchored 1-D Weisfeiler–Leman colour refinement on the disjoint union of the two netlists. Returns
 * whether the final transistor-colour multisets are identical (a necessary structural-equivalence check).
 * Anchoring VDD/VSS/OUT/IN by role removes the automorphisms (rail swap, series↔parallel dual, input
 * relabel) a bare colouring would false-match.
 */
function weisfeilerLehmanMatch(gl: Graph, gs: Graph): boolean {
  type N = { id: string; kind: 't' | 'net'; color: string; inc: { other: string; label: string }[] }
  const build = (g: Graph, side: string): Map<string, N> => {
    const map = new Map<string, N>()
    const ensureNet = (net: string) => {
      const key = `${side}net:${net}`
      if (!map.has(key)) map.set(key, { id: key, kind: 'net', color: g.role(net), inc: [] })
      return key
    }
    for (const t of g.transistors) {
      const tk = `${side}t:${t.id}`
      const tn: N = { id: tk, kind: 't', color: t.type, inc: [] }
      map.set(tk, tn)
      const links: [string, string][] = [
        [t.gate, 'g'],
        [t.sd[0], 's'],
        [t.sd[1], 's'],
      ]
      for (const [net, label] of links) {
        const nk = ensureNet(net)
        tn.inc.push({ other: nk, label })
        ;(map.get(nk) as N).inc.push({ other: tk, label })
      }
    }
    return map
  }
  const nodes = new Map<string, N>([...build(gl, 'L'), ...build(gs, 'S')])
  let distinct = new Set([...nodes.values()].map((n) => n.color)).size
  for (let round = 0; round < nodes.size + 2; round++) {
    const sigs = new Map<string, string>()
    for (const n of nodes.values()) {
      const nbr = n.inc
        .map((e) => `${e.label}:${(nodes.get(e.other) as N).color}`)
        .sort()
        .join(',')
      sigs.set(n.id, `${n.color}|${nbr}`)
    }
    const ranks = new Map<string, number>()
    ;[...new Set(sigs.values())].sort().forEach((s, i) => {
      ranks.set(s, i)
    })
    for (const n of nodes.values()) n.color = String(ranks.get(sigs.get(n.id) as string))
    const nowDistinct = ranks.size
    if (nowDistinct === distinct) break
    distinct = nowDistinct
  }
  const multiset = (side: string) =>
    [...nodes.values()]
      .filter((n) => n.kind === 't' && n.id.startsWith(side))
      .map((n) => n.color)
      .sort()
  const l = multiset('L')
  const s = multiset('S')
  return l.length === s.length && l.every((c, i) => c === s[i])
}

/** Backtracking net+device bijection consistent with the anchors — the source of truth for `match`. Bounded
 *  so a large graph can never hang; on the cap it returns null (reported as indeterminate). */
function findBijection(
  layout: ExtractedNetlist,
  schematic: GateNetlist,
): { netMap: Map<string, string>; deviceMap: Map<string, string> } | null {
  const netMap = new Map<string, string>()
  const usedNet = new Set<string>()
  const seed = (s: string, l: string) => {
    if (s && l && !netMap.has(s)) {
      netMap.set(s, l)
      usedNet.add(l)
    }
  }
  seed(schematic.vdd, layout.vdd)
  seed(schematic.vss, layout.vss)
  seed(schematic.out, layout.out)

  const usedDev = new Set<string>()
  const deviceMap = new Map<string, string>()
  let steps = 0
  const MAX_STEPS = 200000

  const tryMap = (s: string, l: string, added: string[]): boolean => {
    const cur = netMap.get(s)
    if (cur !== undefined) return cur === l
    if (usedNet.has(l)) return false
    netMap.set(s, l)
    usedNet.add(l)
    added.push(s)
    return true
  }
  const undo = (added: string[]) => {
    for (const s of added) {
      usedNet.delete(netMap.get(s) as string)
      netMap.delete(s)
    }
  }

  const bt = (i: number): boolean => {
    if (i === schematic.transistors.length) return true
    if (++steps > MAX_STEPS) return false
    const s = schematic.transistors[i] as ExtractedMosfet
    for (const l of layout.transistors) {
      if (usedDev.has(l.id) || l.type !== s.type) continue
      const pairings: [number, number][] = [
        [0, 1],
        [1, 0],
      ]
      for (const [a, b] of pairings) {
        const added: string[] = []
        if (
          tryMap(s.gate, l.gate, added) &&
          tryMap(s.sd[0] as string, l.sd[a] as string, added) &&
          tryMap(s.sd[1] as string, l.sd[b] as string, added)
        ) {
          usedDev.add(l.id)
          deviceMap.set(s.id, l.id)
          if (bt(i + 1)) return true
          usedDev.delete(l.id)
          deviceMap.delete(s.id)
        }
        undo(added)
      }
    }
    return false
  }
  return bt(0) ? { netMap, deviceMap } : null
}

/** Compare an extracted layout netlist against a schematic netlist and produce the LVS verdict + report. */
export function compareNetlists(layout: ExtractedNetlist, schematic: GateNetlist): LvsResult {
  const discrepancies: LvsDiscrepancy[] = []
  const isUnrouted = layout.notes.some((n) => n.includes('unrouted inter-stage'))
  // areaEstimate is set ONLY on the open-inter-stage branch — a device-count/type/short regression is a
  // TRUE mismatch even on a composite (whose layout carries the unrouted note), never masked as expected.
  const finish = (
    status: 'match' | 'mismatch',
    opts?: {
      area?: boolean
      bij?: { netMap: Map<string, string>; deviceMap: Map<string, string> }
    },
  ): LvsResult => ({
    status,
    match: status === 'match',
    areaEstimate: status === 'mismatch' && (opts?.area ?? false),
    schematic,
    layout,
    netMap: opts?.bij?.netMap ?? new Map(),
    deviceMap: opts?.bij?.deviceMap ?? new Map(),
    deviceCountSchematic: schematic.transistors.length,
    deviceCountLayout: layout.transistors.length,
    discrepancies,
    notes: [...layout.notes],
  })

  const ln = layout.transistors.filter((t) => t.type === 'n').length
  const lp = layout.transistors.filter((t) => t.type === 'p').length
  const sn = schematic.transistors.filter((t) => t.type === 'n').length
  const sp = schematic.transistors.filter((t) => t.type === 'p').length
  if (layout.transistors.length !== schematic.transistors.length) {
    discrepancies.push({
      kind: 'device_count',
      detail: `device count: layout ${layout.transistors.length}, schematic ${schematic.transistors.length}`,
    })
  }
  if (ln !== sn)
    discrepancies.push({ kind: 'device_type', detail: `NMOS count: layout ${ln}, schematic ${sn}` })
  if (lp !== sp)
    discrepancies.push({ kind: 'device_type', detail: `PMOS count: layout ${lp}, schematic ${sp}` })
  if (
    layout.vdd &&
    (layout.vdd === layout.vss || layout.vdd === layout.out || layout.vss === layout.out)
  ) {
    discrepancies.push({
      kind: 'short',
      detail: 'a supply/output rail collapsed onto another (short)',
    })
  }
  if (discrepancies.length > 0) return finish('mismatch')

  const gl: Graph = { transistors: layout.transistors, role: roleOf(layout) }
  const gs: Graph = { transistors: schematic.transistors, role: roleOf(schematic) }
  if (!weisfeilerLehmanMatch(gl, gs)) {
    const kind: LvsDiscrepancyKind = isUnrouted ? 'open' : 'connectivity'
    discrepancies.push({
      kind,
      detail: isUnrouted
        ? 'inter-stage gate net is open (unrouted composite — area estimate)'
        : 'net connectivity differs from the schematic',
    })
    return finish('mismatch', { area: isUnrouted })
  }

  const bij = findBijection(layout, schematic)
  if (!bij) {
    discrepancies.push({ kind: 'indeterminate', detail: 'no consistent device bijection found' })
    return finish('mismatch')
  }
  return finish('match', { bij })
}

/** LVS one cell: extract its layout netlist from geometry and compare against its schematic netlist. */
export function lvsCompare(block: BlockData): LvsResult {
  const layout = extractLayoutNetlist(cellPolygons(block).rects)
  const schematic = extractNetlist(block)
  return compareNetlists(layout, schematic)
}

export type CellLvsReport = { name: string; result: LvsResult }

/** LVS every primitive standard cell. */
export function standardCellLvs(): CellLvsReport[] {
  return STANDARD_CELL_BLOCKS.map((block) => ({ name: block.name, result: lvsCompare(block) }))
}

/** LVS each UNIQUE mapped cell type in a set of placed-cell names (a per-design sweep for the export
 *  report). Names that aren't a primitive gate are skipped. */
export function namedCellLvs(names: Iterable<string>): CellLvsReport[] {
  const seen = new Set<string>()
  const out: CellLvsReport[] = []
  for (const name of names) {
    if (seen.has(name)) continue
    seen.add(name)
    const block = cellBlock(name)
    if (!block) continue
    out.push({ name, result: lvsCompare(block) })
  }
  return out
}

/** A one-line human summary of an LVS sweep, separating true fails from expected area-estimate mismatches. */
export function summarizeLvs(reports: CellLvsReport[]): string {
  const matched = reports.filter((r) => r.result.match).length
  const area = reports.filter((r) => !r.result.match && r.result.areaEstimate).length
  const trueFail = reports.filter((r) => !r.result.match && !r.result.areaEstimate).length
  const tail = area > 0 ? `; ${area} area-estimate (unrouted inter-stage)` : ''
  return `LVS: ${matched}/${reports.length} cells match${tail}; ${trueFail} true mismatch${trueFail === 1 ? '' : 'es'}`
}

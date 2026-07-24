/**
 * FPGA fabric — Stage 1 (the abstract "mini-VPR"), increment 1: the LUT atom + its evaluation.
 * The full staging is FPGA-FABRIC-RESEARCH.md Appendix A. This is the foundation every later piece
 * (the gates→LUT technology-mapper, the packer, the placer/router, the sim binding) builds on.
 *
 * A k-input look-up table IS a truth table: its 2^k configuration bits are the function it computes.
 * Evaluating it is a single array lookup — index the config by the inputs read LSB-first (input i
 * contributes bit i of the index).
 *
 * The load-bearing design fact (why this increment touches NO existing code): a LUT rides the logic
 * engine's own gate contract. logic-sim.ts evaluates every gate as `fn(inputs)[0]`, where
 * `fn: (boolean[]) => boolean[]`; `lutFn` returns exactly that shape, so a LUT drops into `stepLogic`
 * with zero changes to the 0/1 engine. That is the concrete meaning of the research claim "LUT eval is
 * trivial" — the hard, genuinely-new engines (technology mapping, the routing-resource-graph router)
 * come in later increments; the atom itself is a table lookup.
 */

import type { CompiledLogic } from './logic-sim.ts'

/** The number of truth-table entries (configuration bits) a k-input LUT holds: 2^k. */
export function lutConfigSize(k: number): number {
  return 1 << k
}

/** The truth-table index the inputs select, read LSB-first: `inputs[i]` contributes bit i of the index. */
export function lutIndex(inputs: readonly boolean[]): number {
  let index = 0
  for (let i = 0; i < inputs.length; i++) if (inputs[i]) index |= 1 << i
  return index
}

/**
 * A k-input look-up table: its 2^k-entry truth table IS the logic it computes. `config[i]` is the output
 * when the inputs, read LSB-first, encode the integer i. `inputs`/`output` are net names — the same
 * net-string model the gate netlist and logic-sim use; an unused input is tied to a constant net.
 * (The flip-flop atom `KDff` and the whole-design `LutNetlist` container arrive with the technology
 * mapper that produces them — this increment defines only the LUT itself.)
 */
export type KLut = {
  id: string
  k: number
  /** length === `lutConfigSize(k)` (= 2^k). */
  config: boolean[]
  /** k net names driving the LUT inputs, LSB-first (`inputs[0]` is the LSB of the table index). */
  inputs: string[]
  /** the net this LUT drives. */
  output: string
}

/**
 * The LUT's evaluation as the logic engine's gate function — a single truth-table lookup. Drop-in for
 * `LogicSpec['fn']` in logic-sim.ts, so a LUT evaluates through `stepLogic` with no engine change. An
 * out-of-range or unset config entry reads as `false` (an unconfigured table entry is not "true").
 */
export function lutFn(config: readonly boolean[]): (inputs: boolean[]) => boolean[] {
  return (inputs) => [config[lutIndex(inputs)] === true]
}

/**
 * Synthesize a LUT's 2^k config table from a gate's boolean function: `config[j]` is the gate's output
 * when its k inputs, read LSB-first, encode j. Because it enumerates the function exhaustively,
 * `lutFn(synthLutConfig(g.fn, k))` is behaviourally identical to `g.fn` for a k-input gate — that
 * identity is what makes the mapping below provably faithful.
 */
export function synthLutConfig(fn: (inputs: boolean[]) => boolean[], k: number): boolean[] {
  return Array.from(
    { length: 1 << k },
    (_, j) => fn(Array.from({ length: k }, (_, i) => ((j >> i) & 1) === 1))[0] === true,
  )
}

/**
 * The TRIVIAL technology mapper (Stage 1, increment 2): turn a compiled gate netlist into LUTs, ONE LUT
 * per gate, each LUT's config synthesized from that gate's function. The real mapper (increments 7-8)
 * will COVER several gates into one LUT; this 1:1 version exists first to prove the map→simulate spine
 * and the net-id convention against the golden gate simulation, before any optimizer. Reuses
 * `compileLogic`'s already-net-resolved `{ fn, ins, out }` gate list (feedback / flip-flops arrive as
 * internal gates + `cutNets`, so this handles them unchanged).
 */
export function mapCompiledToLuts(compiled: CompiledLogic): KLut[] {
  return compiled.gates.map((gate, i) => ({
    id: `L${i}`,
    k: gate.ins.length,
    config: synthLutConfig(gate.fn, gate.ins.length),
    inputs: [...gate.ins],
    output: gate.out,
  }))
}

/**
 * A compiled logic identical to `compiled` except every gate is replaced by its equivalent LUT — so it
 * co-simulates through the real `stepLogic` and can be characterized against the original. Seeds, port
 * mapping, and feedback cut-nets are carried through unchanged.
 */
export function lutifyCompiled(compiled: CompiledLogic): CompiledLogic {
  const gates = mapCompiledToLuts(compiled).map((lut) => ({
    fn: lutFn(lut.config),
    ins: lut.inputs,
    out: lut.output,
  }))
  return { gates, seeds: compiled.seeds, portNet: compiled.portNet, cutNets: compiled.cutNets }
}

/** A k-feasible cut of a node: its leaf nets (sorted) + the node's truth table over them (LSB-first). */
type Cut = { leaves: string[]; table: boolean[] }

/** The trivial cut of a net — the wire itself (identity: config[0]=false, config[1]=true). */
const trivialCut = (net: string): Cut => ({ leaves: [net], table: [false, true] })

/** Dedup cuts by leaf-set, drop any a strict subset already covers, keep the `cap` smallest. */
function prioritizeCuts(cuts: Cut[], cap: number): Cut[] {
  const byKey = new Map<string, Cut>()
  for (const c of cuts) {
    const key = c.leaves.join(',')
    if (!byKey.has(key)) byKey.set(key, c)
  }
  const uniq = [...byKey.values()]
  const kept = uniq.filter(
    (c) =>
      !uniq.some(
        (o) =>
          o !== c &&
          o.leaves.length < c.leaves.length &&
          o.leaves.every((l) => c.leaves.includes(l)),
      ),
  )
  kept.sort((a, b) => a.leaves.length - b.leaves.length)
  return kept.slice(0, cap)
}

/**
 * The LUT-covering technology mapper (Engine #1): cut enumeration + area-flow covering. Where the trivial
 * `mapCompiledToLuts` makes one LUT per gate, this COVERS a whole cone of gates into a single k-LUT, so a
 * design uses far fewer LUTs.
 *
 * How: walk the gate netlist in topological order and enumerate each node's k-feasible cuts (leaf sets
 * ≤ k through which every path from the inputs passes), carrying each cut's exact truth table by
 * composing the gate functions — so a cut IS the LUT that would implement it. Pick each node's cut by
 * area-flow (estimated total LUTs), then cover from the roots down to the primary inputs.
 *
 * A net is a COVER ROOT — forced to be emitted as its own LUT output — when it is a primary output, a
 * feedback cut point (`compiled.cutNets`: the state nets a latch reads back), or shared (fanout ≥ 2), or
 * terminal (fanout 0). Primary outputs are passed in explicitly (`outputNets`): they cannot be inferred
 * from the gate list, because a driven output net that ALSO feeds internal logic has fanout ≥ 1 and would
 * otherwise be absorbed into a downstream cone and left undriven. And no cut may contain its own node — so a
 * feedback pair decomposes into two LUTs that read each other's net rather than one self-referential LUT,
 * exactly as the trivial map does. Correctness is not a matter of trust — each LUT's config is the
 * exhaustive truth table of its cone, and the cover is checked against the golden gate simulation, with
 * coverage + k-feasibility asserted structurally (tests/fpga-fabric.test.ts).
 */
export function coverToLuts(
  compiled: CompiledLogic,
  outputNets: Iterable<string> = [],
  k = 4,
  cutCap = 8,
): KLut[] {
  const gates = compiled.gates
  const driverOf = new Map<string, (typeof gates)[number]>()
  for (const g of gates) driverOf.set(g.out, g)
  const isPI = (net: string): boolean => !driverOf.has(net)

  const fanout = new Map<string, number>()
  for (const g of gates) for (const net of g.ins) fanout.set(net, (fanout.get(net) ?? 0) + 1)
  const foOf = (net: string): number => fanout.get(net) ?? 0
  // `boundary` = the nets forced to be their own LUT output because we can't tell them from internal logic
  // by the gate list alone: primary outputs and feedback cut points (both supplied). A driven output that
  // also feeds logic has fanout ≥ 1, so without this it would be absorbed into a downstream cone and left
  // undriven. A net is then a ROOT if it is a boundary, or shared (fanout ≥ 2), or terminal (fanout 0).
  const boundary = new Set<string>(outputNets)
  for (const net of compiled.cutNets) boundary.add(net)
  const isRoot = (net: string): boolean =>
    !isPI(net) && (boundary.has(net) || foOf(net) === 0 || foOf(net) >= 2)

  // Cut enumeration — gates are already topologically ordered by compileLogic. Reject any cut that would
  // contain its OWN node (`leaves.includes(g.out)`): a LUT can never read its own output. In a combinational
  // DAG this never fires (a node is never in its own fanin cone); the one place it would is a path back
  // across a feedback cut point, so this local invariant is what makes a cross-coupled pair decompose into
  // two LUTs reading each other's net rather than one self-referential LUT. (prioritizeCuts + the area-flow
  // self-cut filter would also drop such a cut, but enforcing it here keeps feedback-safety local, not an
  // emergent side effect of the cut-prioritizer.)
  const cutsOf = new Map<string, Cut[]>()
  const cutsFor = (net: string): Cut[] => cutsOf.get(net) ?? [trivialCut(net)]
  for (const g of gates) {
    const faninCuts = g.ins.map(cutsFor)
    const merged: Cut[] = []
    const combine = (i: number, chosen: Cut[]): void => {
      if (i === faninCuts.length) {
        const leaves = [...new Set(chosen.flatMap((c) => c.leaves))].sort()
        if (leaves.length > k || leaves.includes(g.out)) return
        const table: boolean[] = []
        for (let a = 0; a < 1 << leaves.length; a++) {
          const faninVals = chosen.map((c) => {
            let sub = 0
            c.leaves.forEach((leaf, p) => {
              if (((a >> leaves.indexOf(leaf)) & 1) === 1) sub |= 1 << p
            })
            return c.table[sub] === true
          })
          table.push(g.fn(faninVals)[0] === true)
        }
        merged.push({ leaves, table })
        return
      }
      for (const c of faninCuts[i] ?? []) combine(i + 1, [...chosen, c])
    }
    combine(0, [])
    merged.push(trivialCut(g.out)) // usable as a leaf in downstream cuts
    cutsOf.set(g.out, prioritizeCuts(merged, cutCap))
  }

  // Area-flow: choose each node's implementation cut (the one minimizing estimated total LUTs).
  const bestCut = new Map<string, Cut>()
  const areaFlow = new Map<string, number>()
  const afOf = (net: string): number => (isPI(net) ? 0 : (areaFlow.get(net) ?? 0))
  for (const g of gates) {
    // the trivial self-cut is only for use as a leaf, never as a node's own implementation
    const cuts = (cutsOf.get(g.out) ?? []).filter(
      (c) => !(c.leaves.length === 1 && c.leaves[0] === g.out),
    )
    let best: Cut | undefined
    let bestAf = Number.POSITIVE_INFINITY
    for (const c of cuts) {
      const area = 1 + c.leaves.reduce((s, leaf) => s + afOf(leaf) / Math.max(1, foOf(leaf)), 0)
      if (area < bestAf) {
        bestAf = area
        best = c
      }
    }
    if (best) {
      bestCut.set(g.out, best)
      areaFlow.set(g.out, bestAf)
    }
  }

  // Cover from the roots down: emit a LUT per root, then recurse on its internal leaves.
  const luts: KLut[] = []
  const emitted = new Set<string>()
  const worklist = gates.map((g) => g.out).filter(isRoot)
  const queued = new Set(worklist)
  let index = 0
  while (worklist.length > 0) {
    const root = worklist.pop() as string
    if (emitted.has(root) || isPI(root)) continue
    const cut = bestCut.get(root)
    if (cut === undefined) continue
    emitted.add(root)
    luts.push({
      id: `L${index++}`,
      k: cut.leaves.length,
      config: cut.table,
      inputs: [...cut.leaves],
      output: root,
    })
    for (const leaf of cut.leaves) {
      if (!isPI(leaf) && !emitted.has(leaf) && !queued.has(leaf)) {
        queued.add(leaf)
        worklist.push(leaf)
      }
    }
  }
  return luts
}

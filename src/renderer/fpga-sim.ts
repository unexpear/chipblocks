/**
 * FPGA fabric — Stage 1 (the abstract "mini-VPR"), increment 5: the ON-pip → sim bridge.
 * The full staging is FPGA-FABRIC-RESEARCH.md Appendix A. This is the seam that finally connects the two
 * halves built so far — the LUT logic (fpga-fabric.ts) and the routing fabric (fpga-rrg.ts) — and it is
 * the last piece before the hard engines (mapper optimizer, packer, placer, PathFinder router).
 *
 * A route is a set of switches turned ON. An ON pip electrically joins its two endpoint wires, so a set
 * of ON pips induces a partition of the fabric wires into **nets** (union-find over the ON pips' endpoints
 * — the same `union(src, dst)` idea compileLogic uses over drawn edges). Once wires are nets, a LUT placed
 * on a tile is just a gate over those nets: it reads the nets its input pins sit on and drives the net its
 * output pin sits on. That yields a `CompiledLogic` the existing `stepLogic` runs — so a design placed and
 * routed onto the fabric simulates through the same 0/1 engine everything else does, unchanged.
 *
 * Deliberately router-independent: it takes the ON-pip set as input, so it works with HAND-CHOSEN pips
 * today and with the future router's output later, with no change.
 */

import { lutFn } from './fpga-fabric.ts'
import type { Rrg } from './fpga-rrg.ts'
import type { CompiledLogic } from './logic-sim.ts'

/**
 * A LUT placed on the fabric: its truth-table config, the RRG node ids feeding its inputs (LSB-first —
 * `inputs[0]` is the LSB of the table index), and the RRG node id it drives.
 */
export type PlacedLut = {
  config: boolean[]
  inputs: string[]
  output: string
}

/** A primary-input drive: force an RRG node's net to a level (the fabric's external stimulus). */
export type Drive = { node: string; high: boolean }

/**
 * Bridge a routed fabric to the logic engine: the ON pips union their endpoint wires into nets, each
 * placed LUT becomes a gate over those nets, and each drive seeds its node's net. Returns a
 * `CompiledLogic` ready for `stepLogic`. Reading is by node id — `result.value(nodeId, '')` returns the
 * level of whatever net that node sits on, so a load anywhere on a routed net reads its driver's value.
 *
 * Stage-1 scope (honest): this assumes a SINGLE driver per net. It does not detect driver contention —
 * two LUT outputs (or a LUT + a drive) unioned onto one net just resolve to whichever gate stepLogic
 * settles last, silently. That never arises from a legal routing (the mapper drives each net once and the
 * router never shorts two drivers), but a hand-built ON-pip set could. Contention detection belongs with
 * the router increment, not here.
 */
export function bridgeToSim(
  rrg: Rrg,
  onPipIds: Iterable<string>,
  luts: readonly PlacedLut[],
  drives: readonly Drive[] = [],
): CompiledLogic {
  // Union-find over node ids; each ON pip merges its two endpoints into one net (same pattern as
  // compileLogic's terminal union-find). Nodes are created lazily so LUT input/output ids and drive
  // targets need not appear in any pip.
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let root = x
    for (;;) {
      const p = parent.get(root)
      if (p === undefined || p === root) break
      root = p
    }
    let cur = x
    while (cur !== root) {
      const p = parent.get(cur) ?? cur
      parent.set(cur, root)
      cur = p
    }
    return root
  }
  const ensure = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x)
    return x
  }
  const union = (a: string, b: string): void => {
    parent.set(find(ensure(a)), find(ensure(b)))
  }

  const onSet = new Set(onPipIds)
  for (const pip of rrg.pips) if (onSet.has(pip.id)) union(pip.from, pip.to)
  const netOf = (node: string): string => find(ensure(node))

  const gates: CompiledLogic['gates'] = luts.map((lut) => ({
    fn: lutFn(lut.config),
    ins: lut.inputs.map(netOf),
    out: netOf(lut.output),
  }))
  const seeds: CompiledLogic['seeds'] = drives.map((d) => ({ net: netOf(d.node), high: d.high }))
  const portNet = (nodeId: string): string => netOf(nodeId)
  return { gates, seeds, portNet, cutNets: [] }
}

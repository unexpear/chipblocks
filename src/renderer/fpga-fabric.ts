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

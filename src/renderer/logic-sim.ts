import type { World } from '../cross-fk-validator.ts'
import {
  type BlockData,
  type CanvasEdgeLike,
  type CanvasNodeLike,
  flattenBlocks,
} from './blocks.ts'
import type { Parameters } from './part-defaults.ts'

/**
 * Logic-level simulator — the FAST path for digital blocks. The DC solver is honest but slow at
 * scale: a 7-segment decoder is ~650 transistors → ~60 s. This sidesteps that by flattening a design
 * only down to its logic GATES (whose boolean functions are known) and evaluating them as 0s and 1s;
 * the same decoder resolves in well under a millisecond. The transistor solver still owns analog parts
 * and the silicon you see when you DESCEND into a gate — this owns "what does this pile of gates
 * compute". It is the enabler for chip-scale digital (decoders, counters, eventually CPUs / MCUs).
 *
 * Today: combinational logic (gates feeding gates, driven by HIGH/LOW sources + ground). Sequential
 * state (clocked flip-flops, registers) is the next layer; a feedback loop that never settles is
 * reported via `settled: false` rather than looping forever.
 */

type LogicSpec = { inputs: string[]; outputs: string[]; fn: (inputs: boolean[]) => boolean[] }

/**
 * Recognised logic gates, keyed by the gate block's `name`. Everything richer (adders, the
 * calculator, the decoder) is BUILT from these, so the flatten stops here and the network stays
 * small — a calculator is ~24 gates, a decoder ~108, both instant to evaluate.
 */
export const LOGIC_PRIMITIVES: Record<string, LogicSpec> = {
  NOT: { inputs: ['in'], outputs: ['out'], fn: ([a]) => [a !== true] },
  Buffer: { inputs: ['in'], outputs: ['out'], fn: ([a]) => [a === true] },
  AND: { inputs: ['a', 'b'], outputs: ['out'], fn: ([a, b]) => [a === true && b === true] },
  OR: { inputs: ['a', 'b'], outputs: ['out'], fn: ([a, b]) => [a === true || b === true] },
  NAND: { inputs: ['a', 'b'], outputs: ['out'], fn: ([a, b]) => [!(a === true && b === true)] },
  NOR: { inputs: ['a', 'b'], outputs: ['out'], fn: ([a, b]) => [!(a === true || b === true)] },
  XOR: { inputs: ['a', 'b'], outputs: ['out'], fn: ([a, b]) => [(a === true) !== (b === true)] },
  XNOR: { inputs: ['a', 'b'], outputs: ['out'], fn: ([a, b]) => [(a === true) === (b === true)] },
}

/** Is this block a logic gate the simulator evaluates directly (rather than expanding to MOSFETs)? */
export function isLogicGate(block: BlockData): boolean {
  return block.name in LOGIC_PRIMITIVES
}

export type LogicResult = {
  /** The boolean a node's terminal (or a top-level block port) settled to — undefined if undriven. */
  value: (nodeId: string, handle: string) => boolean | undefined
  /** False if a feedback loop never reached a steady state (an oscillator / ring). */
  settled: boolean
}

/** A power source reads as logic HIGH if it sits at least at the CMOS half-rail (2.5 V of a 5 V part). */
function sourceIsHigh(params: Parameters | undefined): boolean {
  const nv = (params as { nominal_voltage?: { value?: { amount?: number } } } | undefined)
    ?.nominal_voltage
  return (nv?.value?.amount ?? 0) >= 2.5
}

/**
 * Evaluate a canvas of digital blocks as 0/1 logic. Flattens to gates (not transistors), discovers
 * the nets, seeds the ones driven by sources/ground, then sweeps the gates until everything settles.
 *
 * `state` (optional) makes it SEQUENTIAL: a held net→bit map the caller persists across solves. A
 * feedback loop (a latch's cross-coupled outputs) is seeded from it so the loop HOLDS its stored bit
 * instead of going undefined, and the settled result is written back — so a latch holds its value, and a
 * clocked flip-flop / register updates when its clock is toggled and the canvas re-solved.
 */
export function simulateLogic(
  nodes: CanvasNodeLike[],
  edges: CanvasEdgeLike[],
  state?: Map<string, boolean>,
): LogicResult {
  const flat = flattenBlocks(nodes, edges, isLogicGate)

  // Union-find over terminals → nets (which terminals are wired together).
  const parent = new Map<string, string>()
  const key = (n: string, h: string) => `${n}${String.fromCharCode(0)}${h}`
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
  const ensure = (k: string) => {
    if (!parent.has(k)) parent.set(k, k)
    return k
  }
  const union = (a: string, b: string) => parent.set(find(ensure(a)), find(ensure(b)))
  for (const e of flat.edges) {
    union(key(e.source, e.sourceHandle ?? ''), key(e.target, e.targetHandle ?? ''))
  }
  // A CLOSED switch CONDUCTS — union its two terminals so a logic level passes across it (an OPEN switch
  // leaves them on separate nets, an open circuit). Same closed-state rule as dc-solver's switchIsClosed
  // (`state` !== 'open'). This is what lets a real-switch keypad drive logic inputs.
  for (const node of flat.nodes) {
    const def = node.data.definition
    if (def !== 'switch_spst_toggle' && def !== 'switch_spst_momentary') continue
    const stateVal = (node.data.parameters as Record<string, { value?: unknown }> | undefined)
      ?.state?.value
    if (stateVal !== 'open') union(key(node.id, 'terminal_in'), key(node.id, 'terminal_out'))
  }
  const netOf = (n: string, h: string) => find(ensure(key(n, h)))

  // Driven nets (sources / ground) + the gate list.
  const fixed = new Map<string, boolean>()
  const gates: { fn: LogicSpec['fn']; ins: string[]; out: string }[] = []
  for (const node of flat.nodes) {
    const block = node.data.block
    if (block && isLogicGate(block)) {
      const spec = LOGIC_PRIMITIVES[block.name]
      const outPort = spec?.outputs[0]
      if (!spec || outPort === undefined) continue
      gates.push({
        fn: spec.fn,
        ins: spec.inputs.map((p) => netOf(node.id, p)),
        out: netOf(node.id, outPort),
      })
      continue
    }
    if (node.data.definition === 'ground') {
      fixed.set(netOf(node.id, 'reference_terminal'), false)
    } else if (node.data.definition === 'power_source') {
      fixed.set(netOf(node.id, 'terminal_positive'), sourceIsHigh(node.data.parameters))
      fixed.set(netOf(node.id, 'terminal_negative'), false)
    }
  }

  // Sweep the gates until nothing changes: combinational logic settles in ≤ depth sweeps; a feedback
  // loop either settles or trips the cap (→ settled=false) instead of spinning forever.
  const value = new Map(fixed)
  // Sequential seed: give feedback nets their held bit (a latch can't start without one); a source-driven
  // (fixed) net always wins, so real inputs still override the stored state.
  if (state) {
    for (const [net, bit] of state) if (!value.has(net)) value.set(net, bit)
  }
  let settled = true
  const maxSweeps = gates.length * 2 + 2
  for (let sweep = 0; ; sweep++) {
    let changed = false
    for (const g of gates) {
      if (g.ins.some((net) => !value.has(net))) continue
      const out = g.fn(g.ins.map((net) => value.get(net) === true))[0] === true
      if (value.get(g.out) !== out) {
        value.set(g.out, out)
        changed = true
      }
    }
    if (!changed) {
      // Settled — unless a feedback loop never started (its output is still undriven, with no held
      // state to seed it). Kick one to a deterministic 0 (a real latch powers up to SOME state) and
      // keep sweeping; the latch resolves from there.
      const stuck = gates.find((g) => !value.has(g.out))
      if (stuck === undefined) break
      value.set(stuck.out, false)
      changed = true
    }
    if (sweep >= maxSweeps) {
      settled = false
      break
    }
  }

  // Persist the settled bits so the next solve holds this state (the memory in a latch / flip-flop).
  if (state) {
    for (const [net, bit] of value) state.set(net, bit)
  }

  return {
    settled,
    value: (nodeId, handle) => {
      const target = flat.portTarget.get(`${nodeId}/${handle}`)
      const net = target ? netOf(target.nodeId, target.handleId) : netOf(nodeId, handle)
      return value.get(net)
    },
  }
}

/**
 * A node-voltage seed for the DC solver, computed from the fast logic-sim — the lever that lets
 * digital circuits solve at full real-transistor fidelity AND fast. Each logic gate's pins (inputs,
 * output, supply rails) are pinned to their digital level (0 or Vdd), so the Newton solver starts AT
 * the operating point and converges in a few steps instead of grinding through the gmin / source-
 * stepping retries that dominate at scale (a cold ~650-MOSFET decoder is thousands of solves; the same
 * circuit cost 14 s to subtract vs 3 s to add purely from cold-start convergence).
 *
 * The net mapping: flatten the canvas to gates (the logic-sim's view), then ONE more level to
 * transistors (the solver's view). That second flatten's portTarget maps every gate PORT to the real
 * transistor terminal — and so the world net — the solver knows it by. Returns undefined when the
 * canvas has no gates (nothing digital to seed).
 */
export function digitalSeed(
  nodes: CanvasNodeLike[],
  edges: CanvasEdgeLike[],
  world: World,
  state?: Map<string, boolean>,
): Map<string, number> | undefined {
  const gateFlat = flattenBlocks(nodes, edges, isLogicGate)
  const gates = gateFlat.nodes.filter(
    (node) => node.data.block !== undefined && isLogicGate(node.data.block),
  )
  if (gates.length === 0) return undefined

  const logic = simulateLogic(nodes, edges, state)
  // Vdd: the strongest supply on the canvas (digital logic swings 0..Vdd); default the CMOS-ish 5 V.
  let vdd = 5
  for (const node of nodes) {
    if (node.data.definition !== 'power_source') continue
    const amount = (
      node.data.parameters as { nominal_voltage?: { value?: { amount?: number } } } | undefined
    )?.nominal_voltage?.value?.amount
    if (typeof amount === 'number' && amount > vdd) vdd = amount
  }

  // Flatten the gates one level further (to transistors) so their PORTS land in portTarget, mapping
  // each gate pin to the real terminal — and world net — the solver knows it by.
  const fullFlat = flattenBlocks(gateFlat.nodes, gateFlat.edges)
  const netOf = (nodeId: string, handle: string): string | undefined =>
    world.instances.get(nodeId)?.connects?.find((c) => c.terminal === handle)?.net

  const seed = new Map<string, number>()
  for (const gate of gates) {
    const block = gate.data.block
    if (block === undefined) continue
    for (const port of block.ports) {
      const high = logic.value(gate.id, port.id)
      if (high === undefined) continue
      const target = fullFlat.portTarget.get(`${gate.id}/${port.id}`) ?? {
        nodeId: gate.id,
        handleId: port.id,
      }
      const net = netOf(target.nodeId, target.handleId)
      if (net !== undefined) seed.set(net, high ? vdd : 0)
    }
  }
  return seed.size > 0 ? seed : undefined
}

/** A block's input→output truth table, GENERATED by running its real circuit — the block's "behaviour",
 *  fully simulated, not hand-written. `rows` is every input combination and the outputs it produced. */
export type TruthTable = {
  inputs: string[]
  outputs: string[]
  rows: { in: boolean[]; out: boolean[] }[]
}

const POWER_PORT_IDS = new Set(['v_dd', 'vdd', 'vcc', 'gnd', 'vss', 'vee'])
const OUTPUT_PORT_IDS = new Set([
  'out',
  'q',
  'qbar',
  'q_bar',
  'sum',
  's',
  'carry',
  'cout',
  'c_out',
  'carry_out',
  'borrow',
])
const isOutputPort = (p: { id: string; drive?: string }): boolean =>
  p.drive === 'push_pull' ||
  p.drive === 'open_collector' ||
  p.drive === 'tri_state' ||
  OUTPUT_PORT_IDS.has(p.id.toLowerCase())

/**
 * Characterize a COMBINATIONAL block: drive every input combination through the block's REAL circuit
 * (the logic engine, which expands it to its actual gates) and record the outputs. The resulting truth
 * table IS the block's behaviour — exact, because it came from the sim, not a guess. Returns null for a
 * block with no clear inputs/outputs, too many inputs to enumerate (2^n), or logic that never settles
 * (i.e. it has state — sequential blocks can't be a plain input→output table).
 */
export function characterizeBlock(block: BlockData, maxInputs = 12): TruthTable | null {
  const nonPower = block.ports.filter((p) => !POWER_PORT_IDS.has(p.id.toLowerCase()))
  const outputs = nonPower.filter(isOutputPort).map((p) => p.id)
  const inputs = nonPower.filter((p) => !isOutputPort(p)).map((p) => p.id)
  if (inputs.length === 0 || outputs.length === 0 || inputs.length > maxInputs) return null
  const vddPort = block.ports.find((p) => ['v_dd', 'vdd', 'vcc'].includes(p.id.toLowerCase()))
  const gndPort = block.ports.find((p) => ['gnd', 'vss', 'vee'].includes(p.id.toLowerCase()))
  const supply = (volts: number): Parameters =>
    ({ nominal_voltage: { value: { kind: 'scalar', amount: volts, unit: 'volt' } } }) as Parameters
  const rows: { in: boolean[]; out: boolean[] }[] = []
  for (let combo = 0; combo < 1 << inputs.length; combo++) {
    const inBits = inputs.map((_, i) => ((combo >> i) & 1) === 1)
    const nodes: CanvasNodeLike[] = [
      { id: 'b', position: { x: 0, y: 0 }, data: { definition: 'block', block } },
      { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
      ...inputs.map((_, i) => ({
        id: `s${i}`,
        position: { x: 0, y: 0 },
        data: { definition: 'power_source', parameters: supply(inBits[i] ? 5 : 0) },
      })),
      ...(vddPort
        ? [
            {
              id: 'vd',
              position: { x: 0, y: 0 },
              data: { definition: 'power_source', parameters: supply(5) },
            },
          ]
        : []),
    ]
    const edges: CanvasEdgeLike[] = [
      ...inputs.flatMap((port, i) => [
        {
          id: `e${i}p`,
          source: `s${i}`,
          sourceHandle: 'terminal_positive',
          target: 'b',
          targetHandle: port,
        },
        {
          id: `e${i}n`,
          source: `s${i}`,
          sourceHandle: 'terminal_negative',
          target: 'g',
          targetHandle: 'reference_terminal',
        },
      ]),
      ...(vddPort
        ? [
            {
              id: 'evd',
              source: 'vd',
              sourceHandle: 'terminal_positive',
              target: 'b',
              targetHandle: vddPort.id,
            },
          ]
        : []),
      ...(gndPort
        ? [
            {
              id: 'egn',
              source: 'b',
              sourceHandle: gndPort.id,
              target: 'g',
              targetHandle: 'reference_terminal',
            },
          ]
        : []),
    ]
    const result = simulateLogic(nodes, edges)
    if (!result.settled) return null
    rows.push({ in: inBits, out: outputs.map((o) => result.value('b', o) === true) })
  }
  return { inputs, outputs, rows }
}

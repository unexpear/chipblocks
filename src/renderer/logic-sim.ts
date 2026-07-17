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

/** The non-gate parts the logic engine handles (sources/ground seed nets, switches conduct, junctions
 *  just join wires). Anything else — an LED, a resistor, a bare transistor — is analog the engine ignores. */
const LOGIC_PASSIVE_DEFS = new Set([
  'ground',
  'power_source',
  'junction',
  'switch_spst_toggle',
  'switch_spst_momentary',
])
const logicCompatCache = new WeakMap<BlockData, boolean>()

/**
 * Is this block PURELY digital — does it flatten (down to logic gates) into nothing but gates and the
 * passives the logic engine handles? If so it is simulated EXACTLY by the fast logic engine, so it should
 * default to LOGIC fidelity instead of the ~1000× slower transistor solve. A block with ANY analog part
 * (an LED, a stray resistor, a bare transistor) returns false — compileLogic would silently DROP that part,
 * so such a block must stay on the transistor solver (or use the mixed hand-off). Memoised per block: the
 * flatten is the same work compileLogic does, done once.
 */
export function blockIsLogicCompatible(block: BlockData): boolean {
  const cached = logicCompatCache.get(block)
  if (cached !== undefined) return cached
  const probe: CanvasNodeLike = {
    id: '_probe',
    position: { x: 0, y: 0 },
    data: { definition: 'block', block },
  }
  const flat = flattenBlocks([probe], [], isLogicGate)
  let sawGate = false
  let compatible = true
  for (const n of flat.nodes) {
    const b = n.data.block
    if (b && isLogicGate(b)) {
      sawGate = true
      continue
    }
    if (!LOGIC_PASSIVE_DEFS.has(n.data.definition)) {
      compatible = false
      break
    }
  }
  const result = compatible && sawGate // at least one gate, and nothing analog
  logicCompatCache.set(block, result)
  return result
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
 * A canvas compiled to a reusable logic circuit — the expensive part (flattenBlocks over the whole
 * block hierarchy + the union-find net resolution + the resolved gate list) done ONCE. stepLogic then
 * re-runs only the cheap sweep with fresh source levels, so a clocked block driven over many cycles
 * (the calculator's ×/÷ sequencer) doesn't re-flatten ~9000 gates every clock.
 */
export type CompiledLogic = {
  gates: { fn: LogicSpec['fn']; ins: string[]; out: string }[]
  /** Fixed-net seeds in node order. `nodeId` present ⇒ an overridable power-source positive net
   *  (`high` is its compile-time level); absent ⇒ a hard-fixed net (ground ref / source negative). */
  seeds: { net: string; high: boolean; nodeId?: string }[]
  /** Resolve a top-level (nodeId, handle) to its net — for reading outputs back. */
  portNet: (nodeId: string, handle: string) => string
  /** One output net per feedback cycle (a latch's cut point) — the nets to kick to a start value at cold
   *  power-up. One per independent cycle, so kicking them together matches kicking one flip-flop at a time. */
  cutNets: string[]
}

/** Flatten + net-resolve a canvas once (see CompiledLogic). The heavy work; pair with stepLogic. */
export function compileLogic(nodes: CanvasNodeLike[], edges: CanvasEdgeLike[]): CompiledLogic {
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

  // Driven-net seeds (sources / ground) + the gate list — built in node order so a step re-seeds them
  // in exactly the order the original single-shot solve did.
  const seeds: CompiledLogic['seeds'] = []
  const gates: CompiledLogic['gates'] = []
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
      seeds.push({ net: netOf(node.id, 'reference_terminal'), high: false })
    } else if (node.data.definition === 'power_source') {
      seeds.push({
        net: netOf(node.id, 'terminal_positive'),
        high: sourceIsHigh(node.data.parameters),
        nodeId: node.id,
      })
      seeds.push({ net: netOf(node.id, 'terminal_negative'), high: false })
    }
  }
  const portNet = (nodeId: string, handle: string): string => {
    const target = flat.portTarget.get(`${nodeId}/${handle}`)
    return target ? netOf(target.nodeId, target.handleId) : netOf(nodeId, handle)
  }

  // Order the gates topologically — each placed AFTER the gates that drive its inputs — so stepLogic's sweep
  // settles the combinational logic in a single pass. The old node-order list needed one sweep per logic
  // level (a deep adder/multiplier tree = tens of sweeps over every gate). Feedback-cycle gates (a latch's
  // cross-coupled pair) can't be ordered, so they're appended and left to the residual sweeps. This is purely
  // a re-ordering: stepLogic still iterates to the same fixed point, so every result is bit-for-bit unchanged.
  const producer = new Map<string, number>()
  gates.forEach((g, i) => producer.set(g.out, i))
  const indeg = new Array<number>(gates.length).fill(0)
  const consumers: number[][] = gates.map(() => [])
  gates.forEach((g, i) => {
    for (const net of g.ins) {
      const p = producer.get(net)
      if (p !== undefined && p !== i) {
        indeg[i] = (indeg[i] as number) + 1
        ;(consumers[p] as number[]).push(i)
      }
    }
  })
  const ordered: CompiledLogic['gates'] = []
  const cutNets: string[] = []
  const placed = new Array<boolean>(gates.length).fill(false)
  const queue: number[] = []
  for (let i = 0; i < gates.length; i++) if (indeg[i] === 0) queue.push(i)
  let head = 0
  while (ordered.length < gates.length) {
    if (head >= queue.length) {
      // A feedback cycle stalled Kahn's. Almost all logic reads flip-flop outputs, and a flop is a small
      // cross-coupled cycle, so leaving cycles for last would strand everything downstream of a flop. Instead
      // CUT one feedback edge: force-place the unplaced gate with the fewest still-unresolved inputs (its
      // feedback input reads last cycle's value from `state`, so its consumers can safely order after it).
      // That gate is this cycle's cut point — record its output as a cold-start kick target.
      let best = -1
      for (let i = 0; i < gates.length; i++)
        if (!placed[i] && (best < 0 || (indeg[i] as number) < (indeg[best] as number))) best = i
      if (best < 0) break
      indeg[best] = 0
      queue.push(best)
      cutNets.push((gates[best] as CompiledLogic['gates'][number]).out)
    }
    const i = queue[head++] as number
    if (placed[i]) continue
    placed[i] = true
    ordered.push(gates[i] as CompiledLogic['gates'][number])
    for (const c of consumers[i] as number[]) {
      indeg[c] = (indeg[c] as number) - 1
      if (indeg[c] === 0) queue.push(c)
    }
  }

  return { gates: ordered, seeds, portNet, cutNets }
}

/**
 * Run one settle of a compiled circuit. `sourceOverrides` (nodeId → level) overrides specific power
 * sources for THIS step (e.g. the clock + the pressed key); omitted sources keep their compile-time
 * level. `state` is the persistent flip-flop memory (seeded, then written back). Identical semantics to
 * simulateLogic — which is exactly compileLogic + one stepLogic with no overrides.
 */
export function stepLogic(
  compiled: CompiledLogic,
  sourceOverrides?: Map<string, boolean>,
  state?: Map<string, boolean>,
): LogicResult {
  // Re-seed the driven nets FRESH each step (a released key reads 0, never its old held value); a
  // source-driven net always wins over stored state.
  const fixed = new Map<string, boolean>()
  for (const s of compiled.seeds) {
    fixed.set(s.net, s.nodeId !== undefined ? (sourceOverrides?.get(s.nodeId) ?? s.high) : s.high)
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
  const gates = compiled.gates
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
      // Settled — unless a feedback loop never started (its output is still undriven, with no held state to
      // seed it). Kick each cycle's cut net to 0 (a real latch powers up to SOME state); they're one per
      // independent cycle, so kicking them together settles to the same state as kicking one flip-flop at a
      // time — but in a couple of sweeps, not one per flop (thousands, on a CPU cold start). A one-at-a-time
      // fallback covers any cycle the cut list somehow missed.
      let anyStuck = false
      for (const net of compiled.cutNets)
        if (!value.has(net)) {
          value.set(net, false)
          anyStuck = true
        }
      if (!anyStuck) {
        const stuck = gates.find((g) => !value.has(g.out))
        if (stuck === undefined) break
        value.set(stuck.out, false)
      }
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
    value: (nodeId, handle) => value.get(compiled.portNet(nodeId, handle)),
  }
}

/**
 * Evaluate a canvas of digital blocks as 0/1 logic. Flattens to gates (not transistors), discovers the
 * nets, seeds the ones driven by sources/ground, then sweeps the gates until everything settles —
 * compileLogic + one stepLogic. `state` makes it sequential (a held net→bit map the caller persists).
 */
export function simulateLogic(
  nodes: CanvasNodeLike[],
  edges: CanvasEdgeLike[],
  state?: Map<string, boolean>,
): LogicResult {
  return stepLogic(compileLogic(nodes, edges), undefined, state)
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

export const POWER_PORT_IDS = new Set(['v_dd', 'vdd', 'vcc', 'gnd', 'vss', 'vee'])
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
export const isOutputPort = (p: { id: string; drive?: string }): boolean =>
  // An explicit input drive wins over the name heuristic — a declared input named out/q/s/sum/… is an input.
  p.drive !== 'input' &&
  (p.drive === 'push_pull' ||
    p.drive === 'open_collector' ||
    p.drive === 'tristate' ||
    OUTPUT_PORT_IDS.has(p.id.toLowerCase()))

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

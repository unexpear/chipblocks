/**
 * FPGA fabric — Stage 3a (real iCE40): put a LOADED BITSTREAM ON THE CANVAS. `fpga-icebox-load.ts` turns a user's
 * `.bin` into a `RecoveredNetlist` of LUT4 cells; this lowers that netlist into ordinary canvas nodes + edges made
 * of the app's own logic primitives (AND / OR / NOT / Buffer), so a real vendor bitstream becomes a circuit the
 * rest of the app already understands — the fast logic engine (`compileLogic` / `simulateLogic`), the block
 * viewer, probes, and every other tool that works on a canvas.
 *
 * The lowering is a plain sum-of-products: a LUT4's truth table is the OR of the minterms it makes true, and each
 * minterm is an AND of that cell's four inputs, inverted where the minterm's bit is 0. That is the same
 * "everything real, no shortcuts" move the rest of the project makes — the recovered LUT becomes actual gates the
 * user can open and inspect, not an opaque black box. A cell whose LUT is constant emits a fixed level instead.
 *
 * Registers are real boundaries, not pretended away: a registered cell (`dffEnable`) lowers to its LUT gates
 * computing the NEXT-state D (`cellD`) plus an explicit STATE node carrying the stored Q (`stateNodes`), and it is
 * the Q node that `cellOutputs` names — so consumers read Q exactly as they would on silicon. Drive the state
 * nodes from `simulateClocked`'s state to step the canvas through cycles. The result is the standard synchronous
 * view: a combinational cloud between register boundaries.
 *
 * Honest scope: carry outputs (`kind: 'carry'` inputs) come from the carry unit, not the LUT, so they have no
 * gate-level equivalent here — they are reported in `unlowered` (and their cell in `unfaithful`) rather than
 * silently wired to something wrong.
 */

import type { BlockData, CanvasEdgeLike, CanvasNodeLike } from './blocks.ts'
import type { CellRef, InputSource, RecoveredNetlist } from './fpga-icebox-run.ts'

/** A canvas graph lowered from a recovered netlist, plus what could not be lowered faithfully. */
export type LoweredCanvas = {
  nodes: CanvasNodeLike[]
  edges: CanvasEdgeLike[]
  /** primary-input net → the power-source node id driving it (set its voltage to drive that input). */
  inputNodes: Map<number, string>
  /** cell key (`x_y_cell`) → the node id whose `out` handle carries that cell's output. */
  cellOutputs: Map<string, string>
  /** registered cells (flip-flops). Each has a STATE node in `stateNodes` carrying its stored Q (drive it to run
   *  a cycle) and a `cellD` node carrying the next-state D its LUT computes. */
  registered: CellRef[]
  /** cellKey → the node carrying a registered cell's stored value Q. This is what `cellOutputs` names for a
   *  registered cell, so consumers read Q (as on real silicon), not the LUT. Drive it per cycle to animate. */
  stateNodes: Map<string, string>
  /** cellKey → the node carrying a registered cell's NEXT-state D (its LUT's output). Read it to latch. */
  cellD: Map<string, string>
  /** inputs that could not be lowered faithfully — a carry-unit source, or a pin the LUT DEPENDS on whose driver
   *  could not be resolved. Reported, never silently mis-wired. */
  unlowered: { cell: CellRef; pin: number; reason: string }[]
  /** cells whose lowered gates do NOT faithfully compute the cell's function (they have an entry in `unlowered`,
   *  or they read a registered cell's LUT output rather than its stored Q). Their `cellOutputs` node still exists
   *  so the graph is complete, but its value must not be trusted — surface this to the user. */
  unfaithful: CellRef[]
}

const cellKey = (ref: CellRef): string => `${ref.x}_${ref.y}_${ref.cell}`

/** A bare canvas node carrying one logic primitive (the fast logic engine keys off `block.name`). */
function gateNode(id: string, name: string, x: number, y: number): CanvasNodeLike {
  const block: BlockData = { name, origin: { x, y }, nodes: [], edges: [], ports: [] }
  return { id, position: { x, y }, data: { definition: 'block', block } }
}

/** The handle a node drives from: a power source drives its positive terminal; a gate drives `out`. */
const SOURCE_HANDLE = 'terminal_positive'

/** A power source that drives a primary input (5 V = logic HIGH, 0 V = LOW). */
function sourceNode(id: string, x: number, y: number, high: boolean): CanvasNodeLike {
  return {
    id,
    position: { x, y },
    data: {
      definition: 'power_source',
      parameters: {
        nominal_voltage: { value: { kind: 'scalar', amount: high ? 5 : 0, unit: 'volt' } },
      },
    },
  }
}

/**
 * Lower a recovered netlist onto the canvas: every cell's LUT4 becomes real AND/OR/NOT gates (sum of products),
 * every primary input becomes a power source, and the routing becomes wires. The result feeds straight into
 * `compileLogic` / `simulateLogic` — the same engine the rest of the app's digital work uses.
 */
export function lowerNetlistToCanvas(netlist: RecoveredNetlist): LoweredCanvas {
  const nodes: CanvasNodeLike[] = []
  const edges: CanvasEdgeLike[] = []
  const inputNodes = new Map<number, string>()
  const cellOutputs = new Map<string, string>()
  const unlowered: LoweredCanvas['unlowered'] = []
  const registered = netlist.cells.filter((c) => c.config.dffEnable).map((c) => c.ref)
  const stateNodes = new Map<string, string>()
  const cellD = new Map<string, string>()
  const unfaithfulKeys = new Set<string>()
  let wire = 0
  const sourceIds = new Set<string>() // power-source nodes drive `terminal_positive`, gates drive `out`
  const connect = (source: string, target: string, targetHandle: string): void => {
    edges.push({
      id: `w${wire++}`,
      source,
      sourceHandle: sourceIds.has(source) ? SOURCE_HANDLE : 'out',
      target,
      targetHandle,
    })
  }

  // One power source per distinct primary net (a fan-out signal drives every consumer from the same source).
  const primaryNode = (net: number, index: number): string => {
    const existing = inputNodes.get(net)
    if (existing !== undefined) return existing
    const id = `in_${net}`
    nodes.push(sourceNode(id, -200, index * 60, false))
    sourceIds.add(id)
    inputNodes.set(net, id)
    return id
  }
  // PASS 1 — every cell's terminal node id is deterministic, so register them ALL before any wiring. Without this
  // a cell whose driver appears LATER in `cells` would resolve to nothing and silently lose that input.
  for (const cell of netlist.cells) {
    const key = cellKey(cell.ref)
    const minterms = cell.config.truth.filter(Boolean).length
    if (cell.config.dffEnable) {
      // A flip-flop's output is its stored Q. Create it HERE, in the pre-pass, so it is a known source before any
      // consumer is wired (a source is connected from its terminal handle, not a gate's `out`).
      const qId = `${key}_q`
      nodes.push(sourceNode(qId, -120, stateNodes.size * 60 + 20, false))
      sourceIds.add(qId)
      stateNodes.set(key, qId)
      cellOutputs.set(key, qId)
      continue
    }
    cellOutputs.set(key, minterms === 0 || minterms === 16 ? `${key}_const` : `${key}_out`)
  }
  netlist.cells.forEach((cell, ci) => {
    cell.inputs.forEach((source, pin) => {
      if (source.kind === 'primary') primaryNode(source.net, inputNodes.size)
      else if (source.kind === 'carry') {
        unlowered.push({
          cell: cell.ref,
          pin,
          reason: 'driven by the carry unit, which has no gate-level equivalent here',
        })
        unfaithfulKeys.add(cellKey(cell.ref)) // this cell's lowered gates cannot compute its real function
      }
      void ci
    })
  })

  // Each cell: its LUT4 truth table as a sum of products over its four inputs.
  netlist.cells.forEach((cell, ci) => {
    const key = cellKey(cell.ref)
    const x = ci * 260
    // The node id that carries each input pin's value, or null for a pin with no usable source.
    const pinSource = (pin: number): string | null => {
      const source = cell.inputs[pin] as InputSource | undefined
      if (source === undefined) return null
      if (source.kind === 'primary') return inputNodes.get(source.net) ?? null
      if (source.kind === 'cell') return cellOutputs.get(cellKey(source.driver)) ?? null
      return null // carry (reported above) or unused
    }

    const minterms = [...cell.config.truth.keys()].filter((i) => cell.config.truth[i])
    if (minterms.length === 0 || minterms.length === 16) {
      // A constant LUT: a Buffer fed by a fixed source is the honest gate-level equivalent.
      const constId = `${key}_const`
      nodes.push(sourceNode(`${constId}_src`, x, -80, minterms.length === 16))
      sourceIds.add(`${constId}_src`)
      nodes.push(gateNode(constId, 'Buffer', x, 0))
      connect(`${constId}_src`, constId, 'in')
      if (cell.config.dffEnable) {
        cellD.set(key, constId) // a constant next-state D; the OUTPUT stays the pre-created Q node
        return
      }
      cellOutputs.set(key, constId)
      return
    }

    // Per input pin, a NOT gate for the minterms that need it (built once, reused).
    const inverters = new Map<number, string>()
    const pinValue = (pin: number, invert: boolean): string | null => {
      const src = pinSource(pin)
      if (src === null) return null
      if (!invert) return src
      const existing = inverters.get(pin)
      if (existing !== undefined) return existing
      const id = `${key}_not${pin}`
      nodes.push(gateNode(id, 'NOT', x, 40 + pin * 40))
      connect(src, id, 'in')
      inverters.set(pin, id)
      return id
    }

    // Each minterm: AND the four (possibly inverted) pin values, two at a time.
    const mintermOuts: string[] = []
    minterms.forEach((m, mi) => {
      let acc: string | null = null
      let unsatisfiable = false
      for (let pin = 0; pin < 4; pin++) {
        const src = pinValue(pin, ((m >> pin) & 1) === 0)
        if (src === null) {
          // A pin with no usable source reads as 0 (exactly what the FPGA simulator does for it). So a minterm
          // that needs this pin HIGH can never be satisfied — drop the whole minterm, don't just drop the literal
          // (dropping it would wrongly make the product true when the pin is 0). A minterm that needs it LOW is
          // already satisfied by that pin, so only the literal goes.
          if (((m >> pin) & 1) === 1) {
            unsatisfiable = true
            break
          }
          // A pin the LUT DEPENDS on whose driver could not be resolved (carry / a missing driver) is reported —
          // the lowered gates cannot be trusted for this cell.
          if ((cell.inputs[pin] as InputSource | undefined)?.kind !== 'unused')
            unfaithfulKeys.add(key)
          continue
        }
        if (acc === null) {
          acc = src
          continue
        }
        const id = `${key}_m${mi}_a${pin}`
        nodes.push(gateNode(id, 'AND', x + 120, mi * 50 + pin * 12))
        connect(acc, id, 'a')
        connect(src, id, 'b')
        acc = id
      }
      if (!unsatisfiable && acc !== null) mintermOuts.push(acc)
    })

    // OR the minterms together; a single minterm needs no OR.
    let out = mintermOuts[0] ?? null
    for (let i = 1; i < mintermOuts.length; i++) {
      const id = `${key}_or${i}`
      nodes.push(gateNode(id, 'OR', x + 200, i * 50))
      connect(out as string, id, 'a')
      connect(mintermOuts[i] as string, id, 'b')
      out = id
    }
    // A Buffer terminates every cell, so `cellOutputs` always names a node with a stable `out` handle.
    const outId = cell.config.dffEnable ? `${key}_d` : `${key}_out`
    nodes.push(gateNode(outId, 'Buffer', x + 240, 0))
    if (out !== null) connect(out, outId, 'in')
    if (cell.config.dffEnable) {
      // A REGISTER boundary: these gates compute the next-state D; the cell's OUTPUT is the stored Q created in
      // the pre-pass, so consumers read Q exactly as on real silicon.
      cellD.set(key, outId)
      return
    }
    cellOutputs.set(key, outId)
  })

  const unfaithful = netlist.cells
    .filter((c) => unfaithfulKeys.has(cellKey(c.ref)))
    .map((c) => c.ref)
  return {
    nodes,
    edges,
    inputNodes,
    cellOutputs,
    registered,
    stateNodes,
    cellD,
    unlowered,
    unfaithful,
  }
}

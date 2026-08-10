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
 * user can open and inspect, not an opaque black box. A cell whose LUT is constant emits a fixed level instead,
 * and a pin held at a fixed level (an unrouted iCE40 pin, a Gowin supply tie) is wired to a real `tied_low` /
 * `tied_high` source rather than being offered as a drivable input.
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
 *
 * And the DECODER'S own caveats come through with them. Lowering is where a bitstream stops being a decoder's
 * result and becomes an ordinary circuit, so it is the last place anything can say "this cell was read but must
 * not be trusted" or "this cell could not be read at all". It used to say neither: the ECP5 wide-multiplexer and
 * distributed-memory findings and the Gowin unsupported list all arrived on the netlist and were dropped on the
 * floor, so an untrustworthy cell became two ordinary gates with nothing left to warn anyone. `unfaithful` now
 * carries the decoder's findings merged with this lowering's own, and `undecoded` / `incomplete` pass through.
 */

import type { BlockData, CanvasEdgeLike, CanvasNodeLike } from './blocks.ts'
import type { CellCaveat, CellRef, InputSource, RecoveredNetlist } from './fpga-icebox-run.ts'

/** A canvas graph lowered from a recovered netlist, plus what could not be lowered faithfully. */
export type LoweredCanvas = {
  nodes: CanvasNodeLike[]
  edges: CanvasEdgeLike[]
  /** primary-input net → the power-source node id driving it (set its voltage to drive that input). Pins held at
   *  a fixed level (`kind: 'const'` — an unrouted iCE40 pin, a Gowin supply tie) are NOT here: they get their own
   *  shared `tied_low` / `tied_high` source node, because they are not inputs anyone can drive. */
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
  /** cells on the canvas whose value must not be trusted: the DECODER's own `unfaithful` findings, plus the ones
   *  this lowering could not wire faithfully. One entry per cell — a cell flagged for several reasons carries
   *  them all in one string — so a count of this list is a count of untrustworthy cells. Their `cellOutputs`
   *  node still exists so the graph is complete; surface the reason to the user. */
  unfaithful: CellCaveat[]
  /** cells the decoder could not describe at all. They are on NO canvas node — whatever they drove is simply
   *  missing — so this list is the only trace of them. Empty for a decoder with nothing to declare. */
  undecoded: CellCaveat[]
  /** cells that are on the canvas and right for everything that reads them, but with something the silicon holds
   *  left out (a flip-flop whose reader could not be followed). Not a wrong value; an incomplete picture. */
  incomplete: CellCaveat[]
  /** cell key (`x_y_cell`) → every canvas node that cell became. A caveat about a cell has to end up ON the
   *  parts the user can see, and one cell becomes a dozen gates, so naming them is the only way a warning can
   *  travel from the decoder to the thing on the screen instead of to a card that gets dismissed. */
  cellNodes: Map<string, string[]>
}

const cellKey = (ref: CellRef): string => `${ref.x}_${ref.y}_${ref.cell}`

/** A bare canvas node carrying one logic primitive (the fast logic engine keys off `block.name`). */
function gateNode(id: string, name: string): CanvasNodeLike {
  const block: BlockData = { name, origin: { x: 0, y: 0 }, nodes: [], edges: [], ports: [] }
  return { id, position: { x: 0, y: 0 }, data: { definition: 'block', block } }
}

/** The handle a node drives from: a power source drives its positive terminal; a gate drives `out`. */
const SOURCE_HANDLE = 'terminal_positive'

/** A power source that drives a primary input (5 V = logic HIGH, 0 V = LOW). */
function sourceNode(id: string, high: boolean): CanvasNodeLike {
  return {
    id,
    position: { x: 0, y: 0 },
    data: {
      definition: 'power_source',
      parameters: {
        nominal_voltage: { value: { kind: 'scalar', amount: high ? 5 : 0, unit: 'volt' } },
      },
    },
  }
}

/**
 * THE LAYOUT.
 *
 * Every node above is created at (0, 0) and given a LANE — which column of the dataflow it belongs to, and
 * which row within that column. `arrangeNodes` turns lanes into canvas coordinates at the end, because a
 * position is only meaningful once it is known how big everything else is.
 *
 * The sizes are the ones the app actually draws with: a logic gate is 76 wide and 54 tall (`gate-symbol.tsx`),
 * a power source's box is 80 by 44 (`symbols.tsx`), so 80 by 54 covers every node this lowering emits. The
 * pitch adds a channel for the wires to run in.
 *
 * This used to be one row of cells 260 apart — which made the smallest iCE40 chip's dense design 35,758 wide
 * and 1,134 tall (measured). Fitted to a pane it was a 33-to-1 hairline in which one gate came out two pixels
 * across: a design nobody could see.
 */
const NODE_WIDTH = 80
const NODE_HEIGHT = 54
const COLUMN_PITCH = NODE_WIDTH + 40
const ROW_PITCH = NODE_HEIGHT + 26
/** Clear water between one recovered logic part and the next, so the parts read as separate things. */
const CELL_GAP_X = 60
const CELL_GAP_Y = 50
/**
 * How much wider than tall the whole design should come out.
 *
 * A recovered chip design has no natural shape of its own — the parts are a list — so the shape is chosen,
 * and it is chosen to match the thing it is shown in. A canvas pane is wider than it is tall, and a design
 * whose proportions match its pane wastes the least of it when fitted to the screen. 1.6 is close to the
 * proportions of the canvas area in a normal window and is not a measurement of anything else.
 */
const TARGET_ASPECT = 1.6

/**
 * The columns of one recovered part's dataflow, left to right: the literals its products are built from, the
 * AND stages (up to three, one per extra input), the OR chain that sums the products, the part's output, and
 * for a flip-flop the value it has stored. A part that skips a stage leaves no gap — `packLanes` squeezes the
 * columns it actually used together.
 */
const LITERAL_COLUMN = 0
const PRODUCT_COLUMN = 1
const SUM_COLUMN = 4
const OUTPUT_COLUMN = 5
const STORED_COLUMN = 6
/** Above the products: the one power source standing in for a product that is true whatever the inputs do. */
const ALWAYS_TRUE_ROW = -1

/** Which column of a part's dataflow a node sits in, and which row of that column. */
type Lane = { column: number; row: number }

/** The parts in the chip's own reading order — down each column of the fabric, and within a tile by position. */
const chipOrder = (refs: readonly CellRef[]): string[] =>
  [...refs]
    .sort((a, b) => a.x - b.x || a.y - b.y || a.cell - b.cell)
    .map((ref) => `${ref.x}_${ref.y}_${ref.cell}`)

/** A laid-out group of nodes: where each one sits relative to the group, and how big the group is. */
type LocalPlacement = {
  offsets: Map<string, { x: number; y: number }>
  width: number
  height: number
}

/**
 * One recovered part's own gates, packed.
 *
 * The lanes are the dataflow ones (the literals, then the AND stages, then the OR chain, then the output), and
 * a part that skips a stage must not leave a hole where it would have been. So the columns actually used are
 * squeezed up against each other, keeping their order, and each column's gates then stack from its top in
 * their own order rather than at the row their lane names.
 *
 * That second squeeze is what most of the emptiness was. A part with one inverter on the fourth input, one
 * product and one output is three gates, and holding each of them at the row its lane named made a box four
 * rows deep and four columns across to draw three things in. Their wires still say which feeds which.
 */
function packLanes(ids: readonly string[], laneOf: ReadonlyMap<string, Lane>): LocalPlacement {
  const placed = ids.flatMap((id) => {
    const lane = laneOf.get(id)
    return lane === undefined ? [] : [{ id, lane }]
  })
  const columns = [...new Set(placed.map(({ lane }) => lane.column))].sort((a, b) => a - b)
  const columnAt = new Map(columns.map((column, index) => [column, index]))
  const offsets = new Map<string, { x: number; y: number }>()
  let deepest = 0
  for (const column of columns) {
    const inColumn = placed
      .filter(({ lane }) => lane.column === column)
      .sort((a, b) => a.lane.row - b.lane.row)
    inColumn.forEach(({ id }, row) => {
      offsets.set(id, { x: (columnAt.get(column) ?? 0) * COLUMN_PITCH, y: row * ROW_PITCH })
    })
    deepest = Math.max(deepest, inColumn.length)
  }
  return {
    offsets,
    width: Math.max(0, columns.length - 1) * COLUMN_PITCH + NODE_WIDTH,
    height: Math.max(0, deepest - 1) * ROW_PITCH + NODE_HEIGHT,
  }
}

type Arrangement = { origins: { x: number; y: number }[]; width: number; height: number }

/**
 * The parts in rows, each row taking parts in order until it reaches `rowWidth`.
 *
 * Rows, not a grid of equal cells: recovered parts differ enormously in size — on one real design they run
 * from two gates to forty — and a grid makes every column as wide as its widest part and every row as tall as
 * its tallest, which is most of a design spent on nothing.
 */
function rowsOf(
  sizes: readonly { width: number; height: number }[],
  rowWidth: number,
): Arrangement {
  const origins: { x: number; y: number }[] = []
  let x = 0
  let y = 0
  let rowHeight = 0
  let width = 0
  for (const size of sizes) {
    if (x > 0 && x + size.width > rowWidth) {
      y += rowHeight + CELL_GAP_Y
      x = 0
      rowHeight = 0
    }
    origins.push({ x, y })
    x += size.width + CELL_GAP_X
    width = Math.max(width, x - CELL_GAP_X)
    rowHeight = Math.max(rowHeight, size.height)
  }
  return { origins, width, height: y + rowHeight }
}

/**
 * How big the design comes out ON SCREEN, as one number to be made small.
 *
 * A design is fitted to the pane by whichever of its two dimensions runs out first, so what decides how big
 * the parts are drawn is `max(width ÷ the pane's proportions, height)` — and nothing else. Judging the
 * arrangement by that one number weighs "too empty" and "the wrong shape" against each other honestly,
 * instead of pitting two rules against one another.
 */
const screenCost = (laid: Arrangement): number => Math.max(laid.width / TARGET_ASPECT, laid.height)

/** The parts laid out in the arrangement that draws them biggest. */
function bestArrangement(sizes: readonly { width: number; height: number }[]): Arrangement {
  if (sizes.length === 0) return { origins: [], width: 0, height: 0 }
  // The row width a perfect packing would want, then a spread around it — the parts do not pack perfectly,
  // so which width wins is decided by laying them out and measuring, not by the estimate.
  const area = sizes.reduce(
    (sum, size) => sum + (size.width + CELL_GAP_X) * (size.height + CELL_GAP_Y),
    0,
  )
  const widest = Math.max(...sizes.map((size) => size.width))
  const ideal = Math.sqrt(area * TARGET_ASPECT)
  let best = rowsOf(sizes, Math.max(widest, ideal))
  for (const scale of [0.6, 0.75, 0.9, 1.1, 1.3, 1.6, 2, 2.5]) {
    const laid = rowsOf(sizes, Math.max(widest, ideal * scale))
    if (screenCost(laid) < screenCost(best)) best = laid
  }
  return best
}

/**
 * Give every node a position: the parts on a grid in the chip's own order, the chip's inputs down the left.
 *
 * The order is the chip's — column, then row, then which of the tile's positions the part sits in — so parts
 * that are neighbours on the silicon are neighbours here, and the "column 4, row 12, position 3" a warning
 * names can be walked to. The rows WRAP rather than following the chip's own row count, because a chip's
 * fabric is many short columns and following it literally produces a design hundreds of times taller than it
 * is wide, which is the same unreadable shape in the other direction.
 */
function arrangeNodes(
  nodes: readonly CanvasNodeLike[],
  cellOrder: readonly string[],
  cellNodes: ReadonlyMap<string, string[]>,
  laneOf: ReadonlyMap<string, Lane>,
  sharedIds: readonly string[],
): void {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const packed = cellOrder.map((key) => packLanes(cellNodes.get(key) ?? [], laneOf))
  const grid = bestArrangement(packed)

  // The chip's own inputs stand to the left of everything they drive, in as many short columns as it takes to
  // stay inside the design's own height — one endless column of switches beside a wide design is the same
  // out-of-proportion problem in miniature.
  const perColumn = Math.max(1, Math.floor((grid.height + CELL_GAP_Y) / ROW_PITCH))
  const inputColumns = Math.ceil(sharedIds.length / perColumn)
  sharedIds.forEach((id, index) => {
    const node = byId.get(id)
    if (node === undefined) return
    node.position = {
      x: Math.floor(index / perColumn) * COLUMN_PITCH,
      y: (index % perColumn) * ROW_PITCH,
    }
  })
  const left = inputColumns === 0 ? 0 : inputColumns * COLUMN_PITCH + CELL_GAP_X

  packed.forEach((placement, index) => {
    const origin = grid.origins[index] as { x: number; y: number }
    for (const [id, offset] of placement.offsets) {
      const node = byId.get(id)
      if (node === undefined) continue
      node.position = { x: left + origin.x + offset.x, y: origin.y + offset.y }
    }
  })
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
  // The decoder's findings SEED this, so they survive the hop, and this lowering's own findings are added to the
  // same map keyed by cell — a cell both of them distrust must not be counted twice.
  const caveats = new Map<string, { ref: CellRef; reasons: string[] }>()
  // Which nodes each cell became. The shared nodes — a primary input's power source, the tied-high / tied-low
  // sources — belong to no one cell and are deliberately left out of it.
  const cellNodes = new Map<string, string[]>()
  // Where each node sits in its cell's dataflow, resolved into real coordinates by `arrangeNodes` at the end.
  const laneOf = new Map<string, Lane>()
  const sharedIds: string[] = []
  const ownNode = (
    key: string,
    node: CanvasNodeLike,
    column: number,
    row: number,
  ): CanvasNodeLike => {
    nodes.push(node)
    laneOf.set(node.id, { column, row })
    const owned = cellNodes.get(key)
    if (owned === undefined) cellNodes.set(key, [node.id])
    else owned.push(node.id)
    return node
  }
  const distrust = (ref: CellRef, reason: string): void => {
    const key = cellKey(ref)
    const existing = caveats.get(key)
    if (existing === undefined) {
      caveats.set(key, { ref, reasons: [reason] })
      return
    }
    if (!existing.reasons.includes(reason)) existing.reasons.push(reason)
  }
  for (const listed of netlist.unfaithful ?? []) distrust(listed.ref, listed.reason)
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

  // A pin held at a FIXED level — an iCE40 pin the bitstream never routed (which reads LOW on silicon), or a
  // Gowin pin tied to a supply rail — gets a real power source, one shared node per level. It is deliberately NOT
  // in `inputNodes`: a tied pin is not something the user can drive, and offering it as one is the phantom-input
  // trap this whole classification exists to close.
  //
  // Both halves of that matter. Before this, `pinSource` returned null for a `const`, which (a) read a HIGH tie as
  // 0 — simply the wrong value — and (b) counted the cell as `unfaithful` even for a LOW tie, whose 0 the lowering
  // got right by accident. So a faithful iCE40 design would have been reported untrustworthy en masse.
  const constNodes = new Map<boolean, string>()
  const constNode = (value: boolean): string => {
    const existing = constNodes.get(value)
    if (existing !== undefined) return existing
    const id = value ? 'tied_high' : 'tied_low'
    nodes.push(sourceNode(id, value))
    sharedIds.push(id)
    sourceIds.add(id)
    constNodes.set(value, id)
    return id
  }

  // One power source per distinct primary net (a fan-out signal drives every consumer from the same source).
  const primaryNode = (net: number): string => {
    const existing = inputNodes.get(net)
    if (existing !== undefined) return existing
    const id = `in_${net}`
    nodes.push(sourceNode(id, false))
    sharedIds.push(id)
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
      ownNode(key, sourceNode(qId, false), STORED_COLUMN, 0)
      sourceIds.add(qId)
      stateNodes.set(key, qId)
      cellOutputs.set(key, qId)
      continue
    }
    cellOutputs.set(key, minterms === 0 || minterms === 16 ? `${key}_const` : `${key}_out`)
  }
  for (const cell of netlist.cells) {
    cell.inputs.forEach((source, pin) => {
      if (source.kind === 'primary') primaryNode(source.net)
      else if (source.kind === 'carry') {
        unlowered.push({
          cell: cell.ref,
          pin,
          reason: 'driven by the carry unit, which has no gate-level equivalent here',
        })
        // this cell's lowered gates cannot compute its real function
        distrust(
          cell.ref,
          'one of its inputs comes from the carry unit, which has no equivalent in ordinary gates, so the gates built here do not compute what this cell really computes',
        )
      }
    })
  }

  // Each cell: its LUT4 truth table as a sum of products over its four inputs.
  for (const cell of netlist.cells) {
    const key = cellKey(cell.ref)
    // The node id that carries each input pin's value, or null for a pin with no usable source.
    const pinSource = (pin: number): string | null => {
      const source = cell.inputs[pin] as InputSource | undefined
      if (source === undefined) return null
      if (source.kind === 'primary') return inputNodes.get(source.net) ?? null
      if (source.kind === 'cell') return cellOutputs.get(cellKey(source.driver)) ?? null
      if (source.kind === 'const') return constNode(source.value)
      return null // carry (reported above) or unused
    }

    const minterms = [...cell.config.truth.keys()].filter((i) => cell.config.truth[i])
    if (minterms.length === 0 || minterms.length === 16) {
      // A constant LUT: a Buffer fed by a fixed source is the honest gate-level equivalent.
      const constId = `${key}_const`
      ownNode(key, sourceNode(`${constId}_src`, minterms.length === 16), LITERAL_COLUMN, 0)
      sourceIds.add(`${constId}_src`)
      ownNode(key, gateNode(constId, 'Buffer'), OUTPUT_COLUMN, 0)
      connect(`${constId}_src`, constId, 'in')
      // A constant next-state D leaves the OUTPUT as the pre-created Q node.
      if (cell.config.dffEnable) cellD.set(key, constId)
      else cellOutputs.set(key, constId)
      continue
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
      ownNode(key, gateNode(id, 'NOT'), LITERAL_COLUMN, pin)
      connect(src, id, 'in')
      inverters.set(pin, id)
      return id
    }

    // Each minterm: AND the four (possibly inverted) pin values, two at a time.
    const mintermOuts: string[] = []
    let alwaysTrue = false
    minterms.forEach((m, mi) => {
      let acc: string | null = null
      let unsatisfiable = false
      let stage = 0
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
          // A pin the LUT DEPENDS on whose driver could not be resolved is reported — the lowered gates cannot be
          // trusted for this cell. A carry pin is skipped only because the pass above already said so in words
          // that fit it better; it is flagged there, never left unflagged.
          const kind = (cell.inputs[pin] as InputSource | undefined)?.kind
          if (kind !== 'unused' && kind !== 'carry')
            distrust(
              cell.ref,
              `input ${pin} of this cell has no driver that could be followed, so the gates built here do not compute what this cell really computes`,
            )
          continue
        }
        if (acc === null) {
          acc = src
          continue
        }
        const id = `${key}_m${mi}_a${pin}`
        ownNode(key, gateNode(id, 'AND'), PRODUCT_COLUMN + stage, mi)
        stage++
        connect(acc, id, 'a')
        connect(src, id, 'b')
        acc = id
      }
      // ORDER MATTERS. Unsatisfiable is checked FIRST: an impossible product must vanish, and treating it as
      // the always-true case below would invert the cell's function.
      if (unsatisfiable) return
      // `acc === null` with the minterm still satisfiable means every pin was satisfied by ABSENCE — each one
      // reads 0 and the minterm wanted it low — so the product is unconditionally TRUE. It built no gate, and
      // this used to discard it, which lowered a genuinely programmed vendor lookup table to a dangling buffer
      // reading 0 while the simulator read true. Nothing reported it: `unfaithful` stayed empty.
      if (acc === null) alwaysTrue = true
      else mintermOuts.push(acc)
    })

    // An always-true product makes the whole function true, so it replaces the ORed minterms outright. It needs
    // a real power source: registering it in `sourceIds` is what gives the node its `terminal_positive` handle,
    // and without that it wires from `out` and still reads 0 — the fix would look applied and change nothing.
    if (alwaysTrue) {
      const oneId = `${key}_one`
      ownNode(key, sourceNode(`${oneId}_src`, true), LITERAL_COLUMN, ALWAYS_TRUE_ROW)
      sourceIds.add(`${oneId}_src`)
      ownNode(key, gateNode(oneId, 'Buffer'), PRODUCT_COLUMN, ALWAYS_TRUE_ROW)
      connect(`${oneId}_src`, oneId, 'in')
      mintermOuts.length = 0
      mintermOuts.push(oneId)
    }

    // OR the minterms together; a single minterm needs no OR.
    let out = mintermOuts[0] ?? null
    for (let i = 1; i < mintermOuts.length; i++) {
      const id = `${key}_or${i}`
      ownNode(key, gateNode(id, 'OR'), SUM_COLUMN, i)
      connect(out as string, id, 'a')
      connect(mintermOuts[i] as string, id, 'b')
      out = id
    }
    // A Buffer terminates every cell, so `cellOutputs` always names a node with a stable `out` handle.
    const outId = cell.config.dffEnable ? `${key}_d` : `${key}_out`
    ownNode(key, gateNode(outId, 'Buffer'), OUTPUT_COLUMN, 0)
    if (out !== null) connect(out, outId, 'in')
    // A REGISTER boundary: these gates compute the next-state D; the cell's OUTPUT is the stored Q created in
    // the pre-pass, so consumers read Q exactly as on real silicon.
    if (cell.config.dffEnable) cellD.set(key, outId)
    else cellOutputs.set(key, outId)
  }

  arrangeNodes(
    nodes,
    chipOrder(netlist.cells.map((cell) => cell.ref)),
    cellNodes,
    laneOf,
    sharedIds,
  )

  const unfaithful = [...caveats.values()].map(({ ref, reasons }) => ({
    ref,
    reason: reasons.join('; also: '),
  }))
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
    // Copied, not aliased: a caller sorting or trimming the canvas's list must not rewrite the decoder's.
    undecoded: [...(netlist.undecoded ?? [])],
    incomplete: [...(netlist.incomplete ?? [])],
    cellNodes,
  }
}

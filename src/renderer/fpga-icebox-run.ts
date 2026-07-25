/**
 * FPGA fabric — Stage 3a (real iCE40): "watch it run" — reconstruct a parsed design's netlist and simulate it.
 * The full staging is FPGA-FABRIC-RESEARCH.md §5. `fpga-icebox-parse.ts` recovered a bitstream's placed cells
 * + ON routing pips; this rebuilds the LOGICAL netlist from them and computes what it does — the last step of
 * the "load a bitstream and watch it run" payoff.
 *
 * The new piece is CONNECTIVITY reconstruction: the parsed ON pips form the routed wires, so for each recovered
 * cell's input pin (`lutff_<cell>/in_<p>`) we trace BACKWARD along those pips (each routed sink has one driving
 * source) until we reach some cell's output wire (`lutff_<cell>/out`) — that cell drives this input. An input
 * whose trace dead-ends at a wire no cell drives is a PRIMARY input (an external signal the testbench sets);
 * an input whose wire is not on the device at all is unused. With the netlist rebuilt, `simulateCombinational`
 * evaluates it: drive the primary inputs, evaluate each cell's LUT (`evalLut4`) in dependency order, read the
 * outputs. So a design that was synthesized to a bitstream (increments 4–6), read back (parse), and rebuilt
 * here computes the SAME function it started with.
 *
 * Honest scope: this simulates the COMBINATIONAL logic. A registered cell (its `dffEnable` bit set) is a
 * flip-flop whose output is its stored value, NOT its LUT output, and computing that needs clock stepping —
 * so registered cells are reported in `registered` and hold `false` in this pass; a clocked simulation is the
 * follow-up. It also inherits the parser's limits (the cell POOL / routing come from the bitstream; primary
 * inputs are named by their net, left for the caller to drive). Nothing is invented — an input that cannot be
 * traced to a driver is reported as primary, not guessed.
 */

import type { IceboxDevice } from './fpga-icebox.ts'
import { evalLut4, type LcConfig } from './fpga-icebox-logic.ts'
import type { ParsedDesign } from './fpga-icebox-parse.ts'
import { buildWireIndex } from './fpga-icebox-synth.ts'

/** A recovered cell's location. */
export type CellRef = { x: number; y: number; cell: number }
const cellKey = (ref: CellRef): string => `${ref.x}_${ref.y}_${ref.cell}`

/** What drives one input pin of a recovered cell. `net` is the SOURCE net (the driver cell's output net for a
 *  cell source, or the external wire the trace dead-ended at for a primary) — so a signal that fans out to
 *  several pins carries the same `net` at every consumer. */
export type InputSource =
  | { kind: 'cell'; driver: CellRef; net: number } // another placed cell's output, reached over routed pips
  | { kind: 'primary'; net: number } // an external input the LUT uses, driven from outside the design
  | { kind: 'unused' } // this LUT does not depend on the pin (a don't-care), or the pin has no wire

/** Whether a 16-entry LUT truth table actually depends on input `pin` (some index pair differing only in that
 *  bit disagrees) — used to tell a genuine external input from a don't-care pin a real cell still declares. */
function dependsOnInput(truth: readonly boolean[], pin: number): boolean {
  const bit = 1 << pin
  for (let idx = 0; idx < 16; idx++) {
    if ((idx & bit) === 0 && truth[idx] !== truth[idx | bit]) return true
  }
  return false
}

/** A recovered logic cell: where it is, its function, and the source of each of its four LUT inputs. */
export type RecoveredCell = { ref: CellRef; config: LcConfig; inputs: InputSource[] }
export type RecoveredNetlist = { cells: RecoveredCell[] }

/**
 * Rebuild the logical netlist from a parsed design: for each recovered cell, resolve the source of each of its
 * four input pins by tracing the routed pips backward to a driving cell (or to a primary input / unused pin).
 */
export function reconstructNetlist(parsed: ParsedDesign, device: IceboxDevice): RecoveredNetlist {
  const wireIndex = buildWireIndex(device)
  const at = (x: number, y: number, name: string): number | undefined =>
    wireIndex.get(`${x}_${y}_${name}`)
  // Each routed sink net has one source (from the ON pips): net → the net that drives it.
  const driverOf = new Map<number, number>()
  for (const pip of parsed.onPips) driverOf.set(pip.dst, pip.src)
  // Each placed cell's output net → the cell it belongs to.
  const cellByOutNet = new Map<number, CellRef>()
  for (const c of parsed.cells) {
    const out = at(c.x, c.y, `lutff_${c.cell}/out`)
    if (out !== undefined) cellByOutNet.set(out, { x: c.x, y: c.y, cell: c.cell })
  }

  const cells: RecoveredCell[] = parsed.cells.map((c) => {
    const inputs: InputSource[] = [0, 1, 2, 3].map((pin) => {
      const inNet = at(c.x, c.y, `lutff_${c.cell}/in_${pin}`)
      if (inNet === undefined) return { kind: 'unused' }
      // Trace backward through routed pips to a cell output, or dead-end at a primary input.
      let cur = inNet
      const seen = new Set<number>([cur])
      while (!cellByOutNet.has(cur) && driverOf.has(cur)) {
        cur = driverOf.get(cur) as number
        if (seen.has(cur)) break // cycle guard on a malformed routing
        seen.add(cur)
      }
      const driver = cellByOutNet.get(cur)
      if (driver !== undefined) return { kind: 'cell', driver, net: cur }
      // No cell drives this pin. It is a real external PRIMARY only if the LUT actually depends on it; a pin a
      // real cell declares but the LUT ignores (a don't-care) is unused, not a phantom input to drive.
      return dependsOnInput(c.config.truth, pin)
        ? { kind: 'primary', net: cur }
        : { kind: 'unused' }
    })
    return { ref: { x: c.x, y: c.y, cell: c.cell }, config: c.config, inputs }
  })
  return { cells }
}

/** The result of a combinational simulation: each cell's output value, and any registered cells left uncomputed. */
export type SimResult = {
  /** cellKey → the cell's output value (combinational cells only). */
  outputs: Map<string, boolean>
  /** cells with a flip-flop, held `false` here — they need a clocked simulation (the follow-up). */
  registered: CellRef[]
}

/**
 * Simulate the recovered netlist's combinational logic: given primary input values keyed by net index, evaluate
 * each cell's LUT (`evalLut4`) in dependency order and return every cell's output. A registered cell (dffEnable)
 * is not combinational, so it holds `false` and is listed in `registered` rather than being evaluated wrongly.
 */
export function simulateCombinational(
  netlist: RecoveredNetlist,
  primary: Map<number, boolean>,
): SimResult {
  const byKey = new Map(netlist.cells.map((c) => [cellKey(c.ref), c]))
  const outputs = new Map<string, boolean>()
  const registered = netlist.cells.filter((c) => c.config.dffEnable).map((c) => c.ref)

  const evalCell = (cell: RecoveredCell, stack: Set<string>): boolean => {
    const key = cellKey(cell.ref)
    const done = outputs.get(key)
    if (done !== undefined) return done
    if (cell.config.dffEnable) {
      outputs.set(key, false) // registered — its output is a stored value, not its LUT; needs clocking
      return false
    }
    if (stack.has(key)) return false // combinational cycle — bail rather than loop
    stack.add(key)
    const readInput = (source: InputSource): boolean => {
      if (source.kind === 'cell') {
        const driver = byKey.get(cellKey(source.driver))
        return driver === undefined ? false : evalCell(driver, stack)
      }
      if (source.kind === 'primary') return primary.get(source.net) ?? false
      return false // unused
    }
    const out = evalLut4(
      cell.config.truth,
      readInput(cell.inputs[0] as InputSource),
      readInput(cell.inputs[1] as InputSource),
      readInput(cell.inputs[2] as InputSource),
      readInput(cell.inputs[3] as InputSource),
    )
    stack.delete(key)
    outputs.set(key, out)
    return out
  }

  for (const cell of netlist.cells) evalCell(cell, new Set())
  return { outputs, registered }
}

/** A clocked run: each cycle's per-cell output values, and the flip-flop state after the last cycle. */
export type ClockedResult = {
  /** trace[cycle].get(cellKey) = that cell's output at that cycle. */
  trace: Map<string, boolean>[]
  /** the flip-flop state (Q per registered cell) after the final cycle. */
  finalState: Map<string, boolean>
}

/**
 * Simulate a SEQUENTIAL netlist over `cycles` clock ticks. A registered cell (dffEnable) is a D flip-flop: its
 * OUTPUT during a cycle is its stored value Q (so a feedback loop through it is well-defined — the register is
 * the state boundary), and its LUT computes the next-state D from this cycle's values; on the clock edge every
 * flip-flop latches Q ← D at once. Combinational cells evaluate their LUT as usual. Primary inputs are held at
 * `primary` for the whole run. Flip-flops start at 0 (reset).
 *
 * Honest scope (matches the cell model recovered from the bitstream): this is a plain rising-edge D flip-flop
 * per registered cell. The set/reset and clock-enable config bits (`setNoReset` / `asyncSetReset`, and the
 * tile's clock-enable) are recovered by the parser but NOT applied here — every flip-flop simply latches D each
 * cycle from a 0 reset; a per-cycle input sequence and those control semantics are the follow-up.
 */
export function simulateClocked(
  netlist: RecoveredNetlist,
  primary: Map<number, boolean>,
  cycles: number,
): ClockedResult {
  const byKey = new Map(netlist.cells.map((c) => [cellKey(c.ref), c]))
  let state = new Map<string, boolean>() // registered cell Q; absent ⇒ false (reset 0)
  const trace: Map<string, boolean>[] = []

  const readSource = (source: InputSource, outputs: Map<string, boolean>): boolean => {
    if (source.kind === 'cell') return outputs.get(cellKey(source.driver)) ?? false
    if (source.kind === 'primary') return primary.get(source.net) ?? false
    return false // unused
  }

  for (let cy = 0; cy < cycles; cy++) {
    const outputs = new Map<string, boolean>()
    // A cell's OUTPUT this cycle: a flip-flop shows its stored Q; a combinational cell evaluates its LUT.
    const evalOut = (cell: RecoveredCell, stack: Set<string>): boolean => {
      const key = cellKey(cell.ref)
      const done = outputs.get(key)
      if (done !== undefined) return done
      if (cell.config.dffEnable) {
        const q = state.get(key) ?? false
        outputs.set(key, q)
        return q
      }
      if (stack.has(key)) return false // combinational cycle
      stack.add(key)
      const out = evalLut4(
        cell.config.truth,
        readViaEval(cell.inputs[0] as InputSource, evalOut, stack, byKey, primary),
        readViaEval(cell.inputs[1] as InputSource, evalOut, stack, byKey, primary),
        readViaEval(cell.inputs[2] as InputSource, evalOut, stack, byKey, primary),
        readViaEval(cell.inputs[3] as InputSource, evalOut, stack, byKey, primary),
      )
      stack.delete(key)
      outputs.set(key, out)
      return out
    }
    for (const cell of netlist.cells) evalOut(cell, new Set())

    // Latch: every flip-flop's next Q is its LUT's D, computed from this cycle's outputs, all at once.
    const nextState = new Map(state)
    for (const cell of netlist.cells) {
      if (!cell.config.dffEnable) continue
      nextState.set(
        cellKey(cell.ref),
        evalLut4(
          cell.config.truth,
          readSource(cell.inputs[0] as InputSource, outputs),
          readSource(cell.inputs[1] as InputSource, outputs),
          readSource(cell.inputs[2] as InputSource, outputs),
          readSource(cell.inputs[3] as InputSource, outputs),
        ),
      )
    }
    trace.push(outputs)
    state = nextState
  }
  return { trace, finalState: state }
}

/** Read one input pin's value during combinational evaluation (recursing into a driver cell's output). */
function readViaEval(
  source: InputSource,
  evalOut: (cell: RecoveredCell, stack: Set<string>) => boolean,
  stack: Set<string>,
  byKey: Map<string, RecoveredCell>,
  primary: Map<number, boolean>,
): boolean {
  if (source.kind === 'cell') {
    const driver = byKey.get(cellKey(source.driver))
    return driver === undefined ? false : evalOut(driver, stack)
  }
  if (source.kind === 'primary') return primary.get(source.net) ?? false
  return false // unused
}

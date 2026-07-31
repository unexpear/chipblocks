/**
 * FPGA fabric — Stage 3a (real iCE40): "watch it run" — reconstruct a parsed design's netlist and simulate it.
 * The full staging is FPGA-FABRIC-RESEARCH.md §5. `fpga-icebox-parse.ts` recovered a bitstream's placed cells
 * + ON routing pips; this rebuilds the LOGICAL netlist from them and computes what it does — the last step of
 * the "load a bitstream and watch it run" payoff.
 *
 * The new piece is CONNECTIVITY reconstruction: the parsed ON pips form the routed wires, so for each recovered
 * cell's input pin (`lutff_<cell>/in_<p>`) that the LUT actually depends on, we trace BACKWARD along those pips
 * (each routed sink has one driving source) until we reach some cell's output wire (`lutff_<cell>/out`) — that
 * cell drives this input. A depended-on pin whose trace dead-ends at a wire no cell drives is a PRIMARY input (an
 * external signal the testbench sets); a pin the LUT ignores (a don't-care), or one whose wire is not on the
 * device at all, is unused (it contributes no logical edge — see `dependsOnInput`). With the netlist rebuilt,
 * `simulateCombinational` evaluates it: drive the primary inputs, evaluate each cell's LUT (`evalLut4`) in
 * dependency order, read the outputs. So a design that was synthesized to a bitstream (increments 4–6), read back
 * (parse), and rebuilt here computes the SAME function it started with.
 *
 * Honest scope: this simulates the COMBINATIONAL logic. A registered cell (its `dffEnable` bit set) is a
 * flip-flop whose output is its stored value, NOT its LUT output, and computing that needs clock stepping —
 * so registered cells are reported in `registered` and hold `false` in this pass; a clocked simulation is the
 * follow-up. It also inherits the parser's limits (the cell POOL / routing come from the bitstream; primary
 * inputs are named by their net, left for the caller to drive). Nothing is invented — a pin becomes a primary
 * input only when the LUT depends on it and no cell drives it (else it is unused), never a guessed connection.
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
  | { kind: 'carry'; driver: CellRef; net: number } // a cell's CARRY output (`lutff_c/cout`), reached over routed pips
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
export type RecoveredCell = {
  ref: CellRef
  config: LcConfig
  inputs: InputSource[]
  /** The tile-shared set/reset signal driving this flip-flop, if the bitstream routed one into the tile's
   *  `lutff_global/s_r` sink (a cell output or an external primary). `null`/absent ⇒ a plain flip-flop with no
   *  set/reset. Only set for registered cells. */
  setReset?: InputSource | null
  /** The tile-shared clock-enable signal driving this flip-flop, if the bitstream routed one into the tile's
   *  `lutff_global/cen` sink. `null`/absent ⇒ the flip-flop is always enabled (cen tied high). Only set for
   *  registered cells. */
  clockEnable?: InputSource | null
  /** For a carry-enabled cell (`carryEnable`), the cell whose carry output feeds this cell's carry-in — the
   *  previous cell in the tile's carry chain `(x, y, cell-1)`. `null`/absent ⇒ carry-in is 0 (cell 0 of a chain;
   *  the tile CarryInSet bit is not decoded, so a set carry-in is not modelled). */
  carryIn?: CellRef | null
  /** The carry unit's own two operands (`in_1`, `in_2`), resolved WITHOUT the LUT's don't-care mask. The carry
   *  unit is independent of the LUT (icebox fetches in_1/in_2 for the carry regardless of `lut_bits`), so a
   *  carry-only cell — or one whose LUT ignores an operand it still adds — carries the real signal here while
   *  `inputs` stays don't-care-masked (which keeps phantom LUT edges out). Absent ⇒ fall back to `inputs`. */
  carryOperands?: [InputSource, InputSource] | null
}
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
  // Each placed cell's LUT output net → the cell it belongs to; and (for carry-enabled cells) each carry-output net
  // `lutff_c/cout` → its cell, plus the set of carry-enabled cells (for chaining the carry-in).
  const cellByOutNet = new Map<number, CellRef>()
  const cellByCoutNet = new Map<number, CellRef>()
  const carryCells = new Set<string>()
  for (const c of parsed.cells) {
    const out = at(c.x, c.y, `lutff_${c.cell}/out`)
    if (out !== undefined) cellByOutNet.set(out, { x: c.x, y: c.y, cell: c.cell })
    if (c.config.carryEnable) {
      carryCells.add(`${c.x}_${c.y}_${c.cell}`)
      const cout = at(c.x, c.y, `lutff_${c.cell}/cout`)
      if (cout !== undefined) cellByCoutNet.set(cout, { x: c.x, y: c.y, cell: c.cell })
    }
  }

  // Trace a routed wire backward to its ultimate source net (a cell LUT output, a cell CARRY output, or a driven
  // external wire), following each sink's single driver until it reaches such a source or dead-ends. A `seen` set
  // guards a malformed cycle.
  const traceBack = (startNet: number): number => {
    let cur = startNet
    const seen = new Set<number>([cur])
    while (!cellByOutNet.has(cur) && !cellByCoutNet.has(cur) && driverOf.has(cur)) {
      cur = driverOf.get(cur) as number
      if (seen.has(cur)) break
      seen.add(cur)
    }
    return cur
  }
  // The source of a routed sink net: the cell whose LUT drives it, else the cell whose CARRY output drives it, else
  // the external wire it dead-ends at (a primary).
  const sourceOf = (net: number): InputSource => {
    const cur = traceBack(net)
    const cellDriver = cellByOutNet.get(cur)
    if (cellDriver !== undefined) return { kind: 'cell', driver: cellDriver, net: cur }
    const carryDriver = cellByCoutNet.get(cur)
    if (carryDriver !== undefined) return { kind: 'carry', driver: carryDriver, net: cur }
    return { kind: 'primary', net: cur }
  }

  const cells: RecoveredCell[] = parsed.cells.map((c) => {
    const inputs: InputSource[] = [0, 1, 2, 3].map((pin) => {
      const inNet = at(c.x, c.y, `lutff_${c.cell}/in_${pin}`)
      if (inNet === undefined) return { kind: 'unused' }
      // A pin the LUT ignores (a don't-care) is unused no matter what drives it — classify that FIRST, before
      // tracing. Otherwise a wire a cell happens to drive into a masked pin becomes a phantom logical edge, which
      // can even close a false combinational cycle and corrupt the simulation. Only a pin the LUT truly depends
      // on can be a real cell/primary source.
      if (!dependsOnInput(c.config.truth, pin)) return { kind: 'unused' }
      return sourceOf(inNet)
    })
    // The tile-shared set/reset signal: present only if the bitstream actually routed something into the tile's
    // `lutff_global/s_r` sink. A registered cell whose s_r is routed carries that source (a cell or a primary); a
    // plain flip-flop (nothing routed to s_r) carries none. Combinational cells never carry one.
    const srNet = at(c.x, c.y, 'lutff_global/s_r')
    const setReset: InputSource | null =
      c.config.dffEnable && srNet !== undefined && driverOf.has(srNet) ? sourceOf(srNet) : null
    // The tile-shared clock-enable, likewise present only if the bitstream routed something into `lutff_global/cen`.
    const cenNet = at(c.x, c.y, 'lutff_global/cen')
    const clockEnable: InputSource | null =
      c.config.dffEnable && cenNet !== undefined && driverOf.has(cenNet) ? sourceOf(cenNet) : null
    // The carry-in of a carry-enabled cell chains structurally from the previous cell in the tile (cell-1), when
    // that cell is present and also carry-enabled; otherwise 0 (cell 0 of a chain — the CarryInSet bit is undecoded).
    const carryIn: CellRef | null =
      c.config.carryEnable && c.cell > 0 && carryCells.has(`${c.x}_${c.y}_${c.cell - 1}`)
        ? { x: c.x, y: c.y, cell: c.cell - 1 }
        : null
    // The carry unit's operands are resolved WITHOUT the LUT don't-care mask: icebox fetches in_1/in_2 for the
    // carry independently of the truth table, so a carry-only cell (all-zero LUT) or an operand the LUT happens
    // to ignore still carries its real signal. `inputs` stays masked, so no phantom LUT edge is created.
    const carryPin = (pin: 1 | 2): InputSource => {
      const net = at(c.x, c.y, `lutff_${c.cell}/in_${pin}`)
      return net === undefined ? { kind: 'unused' } : sourceOf(net)
    }
    const carryOperands: [InputSource, InputSource] | null = c.config.carryEnable
      ? [carryPin(1), carryPin(2)]
      : null
    return {
      ref: { x: c.x, y: c.y, cell: c.cell },
      config: c.config,
      inputs,
      setReset,
      clockEnable,
      carryIn,
      carryOperands,
    }
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
  const carryOut = new Map<string, boolean>() // cellKey → carry-out of a carry-enabled cell
  const registered = netlist.cells.filter((c) => c.config.dffEnable).map((c) => c.ref)

  function readInput(source: InputSource, stack: Set<string>): boolean {
    if (source.kind === 'cell') {
      const driver = byKey.get(cellKey(source.driver))
      return driver === undefined ? false : evalCell(driver, stack)
    }
    if (source.kind === 'carry') {
      const driver = byKey.get(cellKey(source.driver))
      return driver === undefined ? false : coutOf(driver, stack)
    }
    if (source.kind === 'primary') return primary.get(source.net) ?? false
    return false // unused
  }

  // A carry-enabled cell's carry-out = majority(in1, in2, carry-in); carry-in chains from the previous cell.
  function coutOf(cell: RecoveredCell, stack: Set<string>): boolean {
    if (!cell.config.carryEnable) return false
    const key = cellKey(cell.ref)
    const done = carryOut.get(key)
    if (done !== undefined) return done
    const guard = `cout:${key}`
    if (stack.has(guard)) return false // guard a malformed carry cycle
    stack.add(guard)
    const ops = cell.carryOperands ?? [cell.inputs[1] as InputSource, cell.inputs[2] as InputSource]
    const in1 = readInput(ops[0], stack)
    const in2 = readInput(ops[1], stack)
    const prev = cell.carryIn ? byKey.get(cellKey(cell.carryIn)) : undefined
    const cin = prev === undefined ? false : coutOf(prev, stack)
    const cout = (in1 && in2) || ((in1 || in2) && cin)
    stack.delete(guard)
    carryOut.set(key, cout)
    return cout
  }

  function evalCell(cell: RecoveredCell, stack: Set<string>): boolean {
    const key = cellKey(cell.ref)
    const done = outputs.get(key)
    if (done !== undefined) return done
    if (cell.config.dffEnable) {
      outputs.set(key, false) // registered — its output is a stored value, not its LUT; needs clocking
      return false
    }
    if (stack.has(key)) return false // combinational cycle — bail rather than loop
    stack.add(key)
    const out = evalLut4(
      cell.config.truth,
      readInput(cell.inputs[0] as InputSource, stack),
      readInput(cell.inputs[1] as InputSource, stack),
      readInput(cell.inputs[2] as InputSource, stack),
      readInput(cell.inputs[3] as InputSource, stack),
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
 * Per-cycle primary-input stimulus for a clocked run. Three forms: a single map held constant every cycle
 * (back-compatible); one map per cycle (an array — the last entry holds for any cycles beyond its length); or a
 * function of the cycle index. Values are keyed by net index (the primary's `net`), missing ⇒ false.
 */
export type Stimulus =
  | Map<number, boolean>
  | Map<number, boolean>[]
  | ((cycle: number) => Map<number, boolean>)

const EMPTY_INPUTS: Map<number, boolean> = new Map()
/** The primary-input values for one cycle, resolving any of the three `Stimulus` forms. */
function inputsAt(stimulus: Stimulus, cycle: number): Map<number, boolean> {
  if (typeof stimulus === 'function') return stimulus(cycle)
  if (Array.isArray(stimulus)) return stimulus[Math.min(cycle, stimulus.length - 1)] ?? EMPTY_INPUTS
  return stimulus
}

/**
 * Simulate a SEQUENTIAL netlist over `cycles` clock ticks. A registered cell (dffEnable) is a D flip-flop: its
 * OUTPUT during a cycle is its stored value Q (so a feedback loop through it is well-defined — the register is
 * the state boundary), and its LUT computes the next-state D from this cycle's values; on the clock edge every
 * flip-flop latches Q ← D at once. Combinational cells evaluate their LUT as usual. Flip-flops start at 0 (reset).
 *
 * Set/reset: if the bitstream routed a signal into the tile's shared `lutff_global/s_r` (recovered as the cell's
 * `setReset` source), an asserted s_r overrides D at the clock edge — Q ← 1 when `setNoReset`, else Q ← 0. An
 * ASYNCHRONOUS flip-flop (`asyncSetReset`) additionally forces its OUTPUT the instant s_r is asserted (the same
 * cycle); a SYNCHRONOUS one changes only at the next edge — so the two differ observably by one cycle. A
 * flip-flop with no routed s_r is a plain D flip-flop.
 *
 * Clock-enable: if the bitstream routed a signal into the tile's shared `lutff_global/cen` (recovered as the
 * cell's `clockEnable` source), the flip-flop latches only on cycles where cen is HIGH; when cen is LOW it HOLDS
 * its Q. An asynchronous set/reset still overrides even a disabled clock (matching the SB_DFFE*R hardware, where
 * async set/reset sits outside the enable), while a synchronous set/reset is gated by cen along with the D latch.
 * A flip-flop with no routed cen is always enabled (cen tied high).
 *
 * Carry chain: a carry-enabled cell (`carryEnable`) produces a carry-out `cout = majority(in1, in2, carry-in)`
 * (icebox's `(in1 & in2) | ((in1 | in2) & cin)`), with the carry-in chaining structurally from the previous cell
 * in the tile (`carryIn`). A pin routed from a cell's `lutff_c/cout` reads that carry-out (so an adder's sum LUT,
 * which routes the carry into an input, sees it). Honest scope: within-tile chains only; cell 0's carry-in is 0
 * (the tile CarryInSet bit is not decoded), and tile-to-tile carry cascade is not modeled.
 *
 * Stimulus: `stimulus` drives the primary inputs each cycle (constant map / per-cycle array / function — see
 * `Stimulus`).
 */
export function simulateClocked(
  netlist: RecoveredNetlist,
  stimulus: Stimulus,
  cycles: number,
): ClockedResult {
  const byKey = new Map(netlist.cells.map((c) => [cellKey(c.ref), c]))
  let state = new Map<string, boolean>() // registered cell Q; absent ⇒ false (reset 0)
  const trace: Map<string, boolean>[] = []

  for (let cy = 0; cy < cycles; cy++) {
    const inputs = inputsAt(stimulus, cy)
    const outputs = new Map<string, boolean>()
    const carryOut = new Map<string, boolean>() // carry-out per carry-enabled cell, this cycle

    // A carry-enabled cell's carry-out this cycle: majority(in1, in2, carry-in), carry-in chaining from the prev cell.
    function coutOfCycle(cell: RecoveredCell, stack: Set<string>): boolean {
      if (!cell.config.carryEnable) return false
      const ckey = cellKey(cell.ref)
      const cdone = carryOut.get(ckey)
      if (cdone !== undefined) return cdone
      const guard = `cout:${ckey}`
      if (stack.has(guard)) return false
      stack.add(guard)
      const ops = cell.carryOperands ?? [
        cell.inputs[1] as InputSource,
        cell.inputs[2] as InputSource,
      ]
      const in1 = readViaEval(ops[0], evalOut, stack, byKey, inputs, coutOfCycle)
      const in2 = readViaEval(ops[1], evalOut, stack, byKey, inputs, coutOfCycle)
      const prevCell = cell.carryIn ? byKey.get(cellKey(cell.carryIn)) : undefined
      const cin = prevCell === undefined ? false : coutOfCycle(prevCell, stack)
      const cout = (in1 && in2) || ((in1 || in2) && cin)
      stack.delete(guard)
      carryOut.set(ckey, cout)
      return cout
    }

    // A cell's OUTPUT this cycle: a flip-flop shows its stored Q (an async set/reset forces it immediately); a
    // combinational cell evaluates its LUT.
    function evalOut(cell: RecoveredCell, stack: Set<string>): boolean {
      const key = cellKey(cell.ref)
      const done = outputs.get(key)
      if (done !== undefined) return done
      if (cell.config.dffEnable) {
        const stored = state.get(key) ?? false
        outputs.set(key, stored) // provisional — lets an async s_r that reads this same flip-flop see its Q
        if (cell.config.asyncSetReset && cell.setReset) {
          // Asynchronous set/reset forces the output the moment s_r is asserted, not at the clock edge.
          if (readViaEval(cell.setReset, evalOut, stack, byKey, inputs, coutOfCycle)) {
            const forced = cell.config.setNoReset // s_r asserted ⇒ SET (1) or RESET (0) per the config bit
            outputs.set(key, forced)
            return forced
          }
        }
        return stored
      }
      if (stack.has(key)) return false // combinational cycle
      stack.add(key)
      const out = evalLut4(
        cell.config.truth,
        readViaEval(cell.inputs[0] as InputSource, evalOut, stack, byKey, inputs, coutOfCycle),
        readViaEval(cell.inputs[1] as InputSource, evalOut, stack, byKey, inputs, coutOfCycle),
        readViaEval(cell.inputs[2] as InputSource, evalOut, stack, byKey, inputs, coutOfCycle),
        readViaEval(cell.inputs[3] as InputSource, evalOut, stack, byKey, inputs, coutOfCycle),
      )
      stack.delete(key)
      outputs.set(key, out)
      return out
    }
    for (const cell of netlist.cells) evalOut(cell, new Set())
    // Ensure every carry-out is computed (a flip-flop's D may read a carry no LUT touched in the output phase).
    for (const cell of netlist.cells) if (cell.config.carryEnable) coutOfCycle(cell, new Set())

    // Latch: compute each flip-flop's next Q. An asynchronous set/reset forces it (ignoring clock-enable); a LOW
    // clock-enable holds Q (which also gates a synchronous set/reset); otherwise, when enabled, an asserted s_r
    // sets/resets and a de-asserted one latches the LUT's D — all at once, from this cycle's outputs.
    const nextState = new Map(state)
    for (const cell of netlist.cells) {
      if (!cell.config.dffEnable) continue
      const key = cellKey(cell.ref)
      const sr = cell.setReset ? readSource(cell.setReset, outputs, inputs, carryOut) : false
      const cen = cell.clockEnable ? readSource(cell.clockEnable, outputs, inputs, carryOut) : true
      const forced = cell.config.setNoReset // s_r asserted ⇒ SET (1) or RESET (0)
      let next: boolean
      if (cell.config.asyncSetReset && sr)
        next = forced // async set/reset: immediate, ignores clock-enable
      else if (!cen)
        next = state.get(key) ?? false // clock disabled ⇒ hold Q (gates a sync s_r too)
      else if (sr)
        next = forced // synchronous set/reset (clock enabled)
      else
        next = evalLut4(
          cell.config.truth,
          readSource(cell.inputs[0] as InputSource, outputs, inputs, carryOut),
          readSource(cell.inputs[1] as InputSource, outputs, inputs, carryOut),
          readSource(cell.inputs[2] as InputSource, outputs, inputs, carryOut),
          readSource(cell.inputs[3] as InputSource, outputs, inputs, carryOut),
        )
      nextState.set(key, next)
    }
    trace.push(outputs)
    state = nextState
  }
  return { trace, finalState: state }
}

/** Read one input's value at latch time from this cycle's outputs (cell source), carry-outs, or primary inputs. */
function readSource(
  source: InputSource,
  outputs: Map<string, boolean>,
  inputs: Map<number, boolean>,
  carryOut: Map<string, boolean>,
): boolean {
  if (source.kind === 'cell') return outputs.get(cellKey(source.driver)) ?? false
  if (source.kind === 'carry') return carryOut.get(cellKey(source.driver)) ?? false
  if (source.kind === 'primary') return inputs.get(source.net) ?? false
  return false // unused
}

/** Read one input pin's value during combinational evaluation (recursing into a driver cell's LUT or carry out). */
function readViaEval(
  source: InputSource,
  evalOut: (cell: RecoveredCell, stack: Set<string>) => boolean,
  stack: Set<string>,
  byKey: Map<string, RecoveredCell>,
  inputs: Map<number, boolean>,
  coutOf: (cell: RecoveredCell, stack: Set<string>) => boolean,
): boolean {
  if (source.kind === 'cell') {
    const driver = byKey.get(cellKey(source.driver))
    return driver === undefined ? false : evalOut(driver, stack)
  }
  if (source.kind === 'carry') {
    const driver = byKey.get(cellKey(source.driver))
    return driver === undefined ? false : coutOf(driver, stack)
  }
  if (source.kind === 'primary') return inputs.get(source.net) ?? false
  return false // unused
}

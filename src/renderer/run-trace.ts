/**
 * The run-trace inspector's engine — clock a synthesized digital design for N cycles and look for the
 * behaviour that a single-step debugger can't surface: a cycle that oscillates instead of settling, a cycle
 * that takes a much longer logic path than its neighbours, an output that flickers for one cycle in an
 * otherwise-steady run, and outputs whose values depend on the flip-flops' random power-up state (a missing
 * reset). It answers the "is the 5th cycle different — on purpose or not?" question directly.
 *
 * It runs on the SAME real logic engine as everything else (buildLogicHarness → stepLogic), so every value
 * is what the actual gates + flip-flops settle to. Pure (no React) and unit-tested against known designs.
 */

import type { BlockData } from './blocks.ts'
import { type LogicResult, stepLogic } from './logic-sim.ts'
import { buildLogicHarness, type DebugSignal, HARNESS_BLOCK_ID } from './verilog-debug.ts'

export type CycleSnapshot = {
  /** 1-based cycle index (after this clock edge). */
  cycle: number
  /** Did BOTH clock half-phases reach a steady state? (false ⇒ oscillation / ring). */
  settled: boolean
  /** Gate-sweeps the slower half-phase took — the logic depth exercised this cycle. */
  sweeps: number
  /** Each output/input signal's value this cycle (decimal, LSB→bit0). */
  values: Map<string, number>
  /** How many internal registers (flip-flop state nets) changed value from the previous cycle. */
  registersChanged: number
}

export type Anomaly = {
  kind: 'unsettled' | 'slow-cycle' | 'power-up-dependent' | 'pulse'
  cycle: number
  signal?: string
  detail: string
}

export type TraceResult = {
  inputs: DebugSignal[]
  outputs: DebugSignal[]
  registerCount: number
  clocked: boolean
  cycles: CycleSnapshot[]
  anomalies: Anomaly[]
}

/** Constant input values to hold across the whole run, by signal name (LSB→bit0). Missing inputs = 0. */
export type TraceInputs = Map<string, number>

export const MAX_TRACE_CYCLES = 256

function readSignal(last: LogicResult, sig: DebugSignal): number | undefined {
  let value = 0
  for (let i = 0; i < sig.bits.length; i++) {
    const bit = last.value(HARNESS_BLOCK_ID, sig.bits[i] as string)
    if (bit === undefined) return undefined
    if (bit) value |= 1 << i
  }
  return value
}

/**
 * Trace a design for `cycles` clock cycles, holding the given input values constant. Returns null if the
 * block has no drivable inputs/outputs (nothing to clock/observe).
 */
export function runTrace(
  block: BlockData,
  cycles: number,
  inputs?: TraceInputs,
): TraceResult | null {
  const harness = buildLogicHarness(block)
  if (!harness) return null
  const n = Math.max(1, Math.min(cycles, MAX_TRACE_CYCLES))
  const { compiled, driven, clockPortId, srcId } = harness
  const watched = [...harness.inputSignals, ...harness.outputSignals]

  // Per-input-bit held level, from the requested signal values (default 0).
  const level = new Map<string, boolean>(driven.map((id) => [id, false]))
  if (inputs) {
    for (const sig of harness.inputSignals) {
      const v = inputs.get(sig.name)
      if (v === undefined) continue
      sig.bits.forEach((id, i) => {
        level.set(id, ((v >> i) & 1) === 1)
      })
    }
  }
  const overrides = (clk: boolean): Map<string, boolean> => {
    const o = new Map<string, boolean>()
    for (const [port, high] of level) {
      const nodeId = srcId.get(port)
      if (nodeId) o.set(nodeId, port === clockPortId ? clk : high)
    }
    return o
  }

  // One full run from a chosen power-up state (registers all low, or all high) — used twice: the shown run
  // (cold, all-low) plus the comparison runs (below) that reveal power-up dependence. `seed(i)` picks each
  // register's power-up bit; the ones left false are cold-kicked to 0 by the engine.
  const run = (seed: (registerIndex: number) => boolean): CycleSnapshot[] => {
    const state = new Map<string, boolean>()
    compiled.cutNets.forEach((net, i) => {
      if (seed(i)) state.set(net, true)
    })
    const snaps: CycleSnapshot[] = []
    let prevRegs: boolean[] | null = null
    for (let i = 0; i < n; i++) {
      let last: LogicResult
      let settled: boolean
      let sweeps: number
      if (clockPortId) {
        const lo = stepLogic(compiled, overrides(false), state)
        const hi = stepLogic(compiled, overrides(true), state)
        last = hi
        settled = lo.settled && hi.settled
        sweeps = Math.max(lo.sweeps, hi.sweeps)
      } else {
        last = stepLogic(compiled, overrides(false), state)
        settled = last.settled
        sweeps = last.sweeps
      }
      const values = new Map<string, number>()
      for (const sig of watched) {
        const v = readSignal(last, sig)
        if (v !== undefined) values.set(sig.name, v)
      }
      const regs = compiled.cutNets.map((net) => state.get(net) === true)
      const registersChanged = prevRegs
        ? regs.reduce((acc, r, k) => acc + (r !== prevRegs?.[k] ? 1 : 0), 0)
        : 0
      prevRegs = regs
      snaps.push({ cycle: i + 1, settled, sweeps, values, registersChanged })
    }
    return snaps
  }

  const cyclesLow = run(() => false) // the shown run: cold, all registers power up to 0
  // Power-up patterns to probe beyond all-0. all-1 catches value dependence; the two alternating patterns
  // break the register-equal symmetry, so an output that depends on register DIFFERENCES (a parity/XOR that
  // reads the same at all-0 and all-1) is still caught. Not exhaustive — a handful of the 2^registers corners,
  // not all of them — but far better than the two-corner test.
  const powerUpRuns = (): CycleSnapshot[][] => [
    run(() => true),
    run((i) => i % 2 === 0),
    run((i) => i % 2 === 1),
  ]
  const anomalies = detectAnomalies(cyclesLow, harness.outputSignals, powerUpRuns)

  return {
    inputs: harness.inputSignals,
    outputs: harness.outputSignals,
    registerCount: compiled.cutNets.length,
    clocked: clockPortId !== null,
    cycles: cyclesLow,
    anomalies,
  }
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2
}

/** The anomaly detectors, over the shown run plus extra power-up-pattern runs for power-up divergence. */
function detectAnomalies(
  cycles: CycleSnapshot[],
  outputs: DebugSignal[],
  powerUpRuns: () => CycleSnapshot[][],
): Anomaly[] {
  const anomalies: Anomaly[] = []

  // (1) A cycle that never settled — an oscillator / ring, or logic too deep for the sweep budget.
  for (const c of cycles) {
    if (!c.settled) {
      anomalies.push({
        kind: 'unsettled',
        cycle: c.cycle,
        detail: `cycle ${c.cycle} never reached a steady state — the logic oscillates (a combinational loop with no register to break it)`,
      })
    }
  }

  // (2) A slow cycle — took a much longer logic path (more gate-sweeps) than the run's typical cycle. The
  // FIRST cycle is skipped both as a baseline and as a candidate: powering the flip-flops up from cold always
  // costs extra sweeps, and that's expected, not an anomaly. UNSETTLED cycles are skipped too — their sweep
  // count is the loop cap (a huge number), which isn't a real settle time and is already flagged by (1).
  const steady = cycles.slice(1).filter((c) => c.settled)
  const med = median(steady.map((c) => c.sweeps))
  for (const c of steady) {
    if (c.sweeps > med * 2 && c.sweeps - med >= 2) {
      anomalies.push({
        kind: 'slow-cycle',
        cycle: c.cycle,
        detail: `cycle ${c.cycle} settled in ${c.sweeps} gate-sweeps vs a typical ${med} — a longer logic path is active this cycle`,
      })
    }
  }

  // (3) A one-cycle pulse — an output steady for a while, changes for exactly one cycle, then reverts. This
  // is INTENDED for a strobe (a done/valid/carry pulse) and a bug for a signal that should hold, so it's
  // surfaced neutrally for the user to judge — not asserted to be a glitch.
  for (const sig of outputs) {
    for (let i = 2; i + 1 < cycles.length; i++) {
      const a = cycles[i - 2]?.values.get(sig.name)
      const b = cycles[i - 1]?.values.get(sig.name)
      const cur = cycles[i]?.values.get(sig.name)
      const d = cycles[i + 1]?.values.get(sig.name)
      if (a === undefined || b === undefined || cur === undefined || d === undefined) continue
      if (a === b && b === d && cur !== b) {
        anomalies.push({
          kind: 'pulse',
          cycle: cycles[i]?.cycle ?? i + 1,
          signal: sig.name,
          detail: `"${sig.name}" held ${b}, changed to ${cur} for exactly one cycle, then returned to ${b} — intended if it's a strobe (done/valid/carry), a glitch if it should have held`,
        })
      }
    }
  }

  // (4) Power-up dependence — do the OUTPUTS differ across power-up states? Compare the shown all-0 run to a
  // few other register power-up patterns (all-1 + alternating); any divergence means the output isn't
  // determined by its inputs alone (it needs a reset / initialization).
  const others = powerUpRuns()
  outer: for (const sig of outputs) {
    for (let i = 0; i < cycles.length; i++) {
      const lo = cycles[i]?.values.get(sig.name)
      if (lo === undefined) continue
      for (const other of others) {
        const alt = other[i]?.values.get(sig.name)
        if (alt !== undefined && alt !== lo) {
          anomalies.push({
            kind: 'power-up-dependent',
            cycle: cycles[i]?.cycle ?? i + 1,
            signal: sig.name,
            detail: `"${sig.name}" reads ${lo} from one flip-flop power-up state but ${alt} from another at cycle ${cycles[i]?.cycle} — the output depends on the start state, so it needs a reset to be predictable`,
          })
          break outer // one representative divergence is enough; don't flood
        }
      }
    }
  }

  return anomalies
}

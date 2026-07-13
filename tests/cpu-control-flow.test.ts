/**
 * The CPU on-ramp, increment 3 — CONTROL FLOW, all real clocked gates on the fast logic engine (no
 * code in the loop). Increment 2 made the machine COMPUTE in a straight line; this proves it can
 * BRANCH, LOOP, and STOP: JMP redirects the program counter to a target address; JZ does the same
 * only when the accumulator is zero (the zero flag is a real NOR of the accumulator bits); and HLT
 * latches a real gate freeze — a self-holding flip-flop that stops the machine so no further clock
 * edge changes any state, with a HALT output the harness reads to know when to stop clocking (the
 * accepted "JS toggles the clock + reads a gate flag" pattern, never sequencing in code). RESET
 * clears the halt and homes the machine. The payoff: a genuine countdown loop built from JMP + JZ.
 */

import { describe, expect, test } from 'vitest'
import type { BlockData, CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { buildCpu, CPU_OPCODES, cpuInstr } from '../src/renderer/builtin-blocks.ts'
import { simulateLogic } from '../src/renderer/logic-sim.ts'

const supply = (volts: number) => ({
  nominal_voltage: { value: { kind: 'scalar', amount: volts, unit: 'volt' } },
})
const src = (id: string, hi: boolean): CanvasNodeLike => ({
  id,
  position: { x: 0, y: 0 },
  data: { definition: 'power_source', parameters: supply(hi ? 5 : 0) },
})
const gnd = (id: string): CanvasNodeLike => ({
  id,
  position: { x: 0, y: 0 },
  data: { definition: 'ground' },
})
const w = (id: string, s: string, sh: string, t: string, th: string): CanvasEdgeLike => ({
  id,
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
})

type Control = { reset?: boolean }
type State = { acc: number; out: number; pc: number; halt: boolean }

/** A fresh, isolated driver over one CPU block (its own persistent state Map). clock() runs a
 *  CLK-low then a CLK-high solve — one rising edge — and returns ACC, OUT, PC, and the HALT flag. */
function driver(cpu: BlockData) {
  const state = new Map<string, boolean>()
  const step = (ctrl: Control, clk: boolean): State => {
    const nodes: CanvasNodeLike[] = [
      { id: 'C', position: { x: 0, y: 0 }, data: { definition: 'block', block: cpu } },
      src('vp', true),
      gnd('g'),
      src('vclk', clk),
      src('vrst', ctrl.reset ?? false),
    ]
    const edges: CanvasEdgeLike[] = [
      w('ep', 'vp', 'terminal_positive', 'C', 'v_dd'),
      w('eg', 'C', 'gnd', 'g', 'reference_terminal'),
      w('eclk', 'vclk', 'terminal_positive', 'C', 'clk'),
      w('erst', 'vrst', 'terminal_positive', 'C', 'reset'),
      w('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
      w('eclkn', 'vclk', 'terminal_negative', 'g', 'reference_terminal'),
      w('erstn', 'vrst', 'terminal_negative', 'g', 'reference_terminal'),
    ]
    const r = simulateLogic(nodes, edges, state)
    const read = (prefix: string, bits: number) => {
      let v = 0
      for (let i = 0; i < bits; i++) if (r.value('C', `${prefix}${i}`) === true) v |= 1 << i
      return v
    }
    return {
      acc: read('acc', 4),
      out: read('out', 4),
      pc: read('pc', 4),
      halt: r.value('C', 'halt') === true,
    }
  }
  const clock = (ctrl: Control = {}): State => {
    step(ctrl, false)
    return step(ctrl, true)
  }
  return {
    clock,
    /** Clock (the calcSolve pattern) until the machine raises its HALT flag, up to a safety cap. */
    runUntilHalt: (maxClocks: number): { halted: boolean; clocks: number; state: State } => {
      let last: State = { acc: 0, out: 0, pc: 0, halt: false }
      for (let n = 1; n <= maxClocks; n++) {
        last = clock()
        if (last.halt) return { halted: true, clocks: n, state: last }
      }
      return { halted: false, clocks: maxClocks, state: last }
    },
  }
}

/** Assemble a program of (opcode, operand) pairs into ROM words. */
const prog = (...ops: [number, number?][]): number[] => ops.map(([op, n]) => cpuInstr(op, n))
const { HLT, LDI, ADD, SUB, OUT, JMP, JZ } = CPU_OPCODES

describe('CPU control flow — JMP, JZ, and a real HLT freeze', () => {
  test('JMP redirects the fetch to the target address', () => {
    // JMP 3 must skip the two HLTs at addr 1–2 and land on LDI 7; a broken JMP would fall through to
    // the addr-1 HLT and halt with OUT still 0.
    const d = driver(buildCpu(prog([JMP, 3], [HLT], [HLT], [LDI, 7], [OUT], [HLT])))
    d.clock({ reset: true })
    const { halted, state } = d.runUntilHalt(60)
    expect(halted).toBe(true)
    expect(state.out).toBe(7) // reached LDI 7 → OUT, proving the jump was taken (not 0 from a fall-through)
  })

  test('JZ jumps when the accumulator is zero and falls through when it is not', () => {
    // One program shape, two runs. JZ 6 targets a "load 7, show it" tail; the fall-through path is
    // "load 9, show it". A TAKEN jump shows 7, a NOT-taken jump shows 9 — a clean discriminator.
    const jzProgram = (loadVal: number) =>
      prog([LDI, loadVal], [JZ, 6], [LDI, 9], [OUT], [HLT], [HLT], [LDI, 7], [OUT], [HLT])

    const taken = driver(buildCpu(jzProgram(0))) // ACC = 0 → JZ taken
    taken.clock({ reset: true })
    const t = taken.runUntilHalt(60)
    expect(t.halted).toBe(true)
    expect(t.state.out).toBe(7) // jumped to the tail

    const notTaken = driver(buildCpu(jzProgram(3))) // ACC = 3 ≠ 0 → JZ falls through
    notTaken.clock({ reset: true })
    const nt = notTaken.runUntilHalt(60)
    expect(nt.halted).toBe(true)
    expect(nt.state.out).toBe(9) // fell through to LDI 9 → OUT, did NOT jump
  })

  test('HLT freezes the machine in gates, and RESET un-freezes it', () => {
    const d = driver(buildCpu(prog([LDI, 5], [OUT], [HLT])))
    d.clock({ reset: true })
    const run = d.runUntilHalt(30)
    expect(run.halted).toBe(true)
    expect(run.state.out).toBe(5)
    const frozen = run.state
    // Keep clocking WITHOUT reset — a real gate freeze means every extra clock is a no-op.
    let after = frozen
    for (let i = 0; i < 6; i++) after = d.clock()
    expect(after).toEqual(frozen) // ACC, OUT, PC, HALT all unchanged — frozen in gates, not "JS stopped"
    // RESET clears the halt latch and homes the machine.
    const reset = d.clock({ reset: true })
    expect(reset.halt).toBe(false)
    expect(reset.pc).toBe(0)
  })

  test('a real loop: a JMP + JZ countdown terminates at zero', () => {
    // LDI 5; then {SUB 1; JZ exit; JMP back}. The accumulator counts 5→0; JZ exits the loop when it
    // reaches zero; OUT shows 0; HLT. A genuine JMP + JZ loop that TERMINATES. (A summing loop that
    // keeps a running total alongside the counter needs a second variable → data memory, increment 4.)
    const d = driver(buildCpu(prog([LDI, 5], [SUB, 1], [JZ, 4], [JMP, 1], [OUT], [HLT])))
    d.clock({ reset: true })
    const { halted, clocks, state } = d.runUntilHalt(200)
    expect(halted).toBe(true) // the loop terminated — it did not run away
    expect(state.out).toBe(0) // counted down to zero and showed it
    expect(clocks).toBeLessThan(80) // ~5 iterations, not a runaway
  })

  test('no spurious halt: the flag stays low through LDI/ADD/OUT and only rises at HLT', () => {
    const d = driver(buildCpu(prog([LDI, 3], [ADD, 4], [OUT], [HLT])))
    d.clock({ reset: true })
    let s: State = { acc: 0, out: 0, pc: 0, halt: false }
    for (let i = 0; i < 3; i++) s = d.clock() // LDI 3
    expect(s.halt).toBe(false)
    for (let i = 0; i < 3; i++) s = d.clock() // ADD 4
    expect(s.halt).toBe(false)
    for (let i = 0; i < 3; i++) s = d.clock() // OUT
    expect(s.halt).toBe(false)
    expect(s.out).toBe(7)
    for (let i = 0; i < 3; i++) s = d.clock() // HLT
    expect(s.halt).toBe(true) // only now does the machine halt
  })
})

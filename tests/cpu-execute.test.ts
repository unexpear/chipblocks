/**
 * The CPU on-ramp, increment 2 — DECODE + EXECUTE, all real clocked gates on the fast logic engine
 * (no code in the loop). The fetch engine (increment 1) reads a stored program out of the ROM; this
 * proves the machine then DECODES each instruction and EXECUTES it on a real datapath — an
 * accumulator, the 4-bit adder/subtractor as the ALU, an opcode decoder, and an output register.
 * Three clocked microsteps per instruction: T0 loads the IR, T1 advances the PC, T2 executes. The
 * instruction set: LDI n (ACC ← n), ADD n (ACC ← ACC+n), SUB n (ACC ← ACC−n, two's complement, mod
 * 16), OUT (OUTREG ← ACC), HLT (a no-op for now). What must be true: the demo program 3 + 4 lands 7
 * in the output register; SUB subtracts and its borrow wraps; OUT shows the accumulator itself (never
 * the operand-polluted ALU sum); the accumulator accumulates across ADDs and holds across
 * non-arithmetic ops; execution happens at T2 (not T0/T1); and a cold power-up runs from address 0.
 */

import { describe, expect, test } from 'vitest'
import type { BlockData, CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import {
  buildCpu,
  CPU_DEMO_PROGRAM,
  CPU_OPCODES,
  cpuInstr,
} from '../src/renderer/builtin-blocks.ts'
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
type State = { acc: number; out: number; pc: number }

/** A fresh, isolated driver over one CPU block (its own persistent state Map). clock() runs a
 *  CLK-low then a CLK-high solve — one rising edge — and returns the accumulator, output register,
 *  and program counter. Reset is the only external control this increment exercises (JMP lands next).*/
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
      w('eldpc', 'vp', 'terminal_negative', 'C', 'loadpc'), // JMP unused here — tie LOADPC low
      w('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
      w('eclkn', 'vclk', 'terminal_negative', 'g', 'reference_terminal'),
      w('erstn', 'vrst', 'terminal_negative', 'g', 'reference_terminal'),
    ]
    for (let i = 0; i < 4; i++) {
      edges.push(w(`epl${i}`, 'vp', 'terminal_negative', 'C', `pl${i}`)) // PL0..3 tied low
    }
    const r = simulateLogic(nodes, edges, state)
    const read = (prefix: string, bits: number) => {
      let v = 0
      for (let i = 0; i < bits; i++) if (r.value('C', `${prefix}${i}`) === true) v |= 1 << i
      return v
    }
    return { acc: read('acc', 4), out: read('out', 4), pc: read('pc', 4) }
  }
  return {
    step,
    clock: (ctrl: Control = {}) => {
      step(ctrl, false)
      return step(ctrl, true)
    },
  }
}

/** Assemble a program of (opcode, operand) pairs into ROM words. */
const prog = (...ops: [number, number?][]): number[] => ops.map(([op, n]) => cpuInstr(op, n))

describe('CPU decode + execute — a real datapath driven by a real gate control', () => {
  test('runs the demo program on real gates: LDI 3; ADD 4; OUT → 7', () => {
    const d = driver(buildCpu())
    d.clock({ reset: true }) // home PC = 0, T-counter = 0
    // Instruction 0 = LDI 3. Execute happens at T2 (the third microstep) and NOT before.
    expect(d.clock().acc).toBe(0) // T0: IR ← ROM[0]; nothing executed yet
    expect(d.clock().acc).toBe(0) // T1: PC advances; still not executed
    expect(d.clock().acc).toBe(3) // T2: LDI 3 executes → ACC ← 3
    // Instruction 1 = ADD 4.
    d.clock() // T0
    d.clock() // T1
    expect(d.clock().acc).toBe(7) // T2: ADD 4 → 3 + 4 = 7
    // Instruction 2 = OUT.
    d.clock() // T0
    d.clock() // T1
    const outStep = d.clock() // T2: OUTREG ← ACC
    expect(outStep.out).toBe(7) // the machine's result register shows 7
    expect(outStep.acc).toBe(7) // OUT does not disturb the accumulator
  })

  test('OUT shows the accumulator itself, never the operand-polluted ALU sum', () => {
    // The output register's data comes straight off ACC, not through the ALU. A hand-encoded OUT with
    // a nonzero operand (0x49 = OUT 9) must still show ACC, not ACC+9 — proving OUT.D ← ACC.Q wiring.
    const d = driver(buildCpu(prog([CPU_OPCODES.LDI, 5], [CPU_OPCODES.OUT, 9])))
    for (let i = 0; i < 3; i++) d.clock() // execute LDI 5 → ACC = 5
    let last = { acc: 0, out: 0, pc: 0 }
    for (let i = 0; i < 3; i++) last = d.clock() // execute OUT 9
    expect(last.acc).toBe(5)
    expect(last.out).toBe(5) // 5, NOT 5 + 9 = 14 — the operand field of OUT is ignored
  })

  test('LDI overwrites the accumulator — an immediate replaces the running value, not adds to it', () => {
    // The ALU's A side is gated to 0 during LDI, so LDI computes 0 + operand REGARDLESS of the current
    // accumulator. Every other test runs its first LDI against a zero accumulator, where "load n" and
    // "add n" are indistinguishable; this one loads OVER a non-zero accumulator to pin the A-zeroing
    // gate — if it regressed (A never zeroed), the second LDI would add instead (5 + 3 = 8).
    const d = driver(buildCpu(prog([CPU_OPCODES.LDI, 5], [CPU_OPCODES.LDI, 3], [CPU_OPCODES.OUT])))
    d.clock({ reset: true })
    let s = { acc: 0, out: 0, pc: 0 }
    for (let i = 0; i < 3; i++) s = d.clock() // LDI 5 → ACC 5
    expect(s.acc).toBe(5)
    for (let i = 0; i < 3; i++) s = d.clock() // LDI 3 → ACC 3, NOT 5 + 3 = 8
    expect(s.acc).toBe(3)
    for (let i = 0; i < 3; i++) s = d.clock() // OUT → OUTREG 3
    expect(s.out).toBe(3)
  })

  test('SUB subtracts, and its two-complement borrow wraps mod 16', () => {
    const easy = driver(
      buildCpu(prog([CPU_OPCODES.LDI, 7], [CPU_OPCODES.SUB, 4], [CPU_OPCODES.OUT])),
    )
    for (let i = 0; i < 6; i++) easy.clock() // LDI 7, SUB 4
    expect(easy.clock().acc).toBe(3) // 7 − 4 = 3 (a clean subtract)  [T0 of OUT re-reads, acc unchanged]

    // A borrow: 2 − 5 = −3, which in 4-bit two's complement is 13 (2 + ~5 + 1 = 2 + 10 + 1 = 13).
    const borrow = driver(buildCpu(prog([CPU_OPCODES.LDI, 2], [CPU_OPCODES.SUB, 5])))
    for (let i = 0; i < 5; i++) borrow.clock() // LDI 2, then SUB's T0+T1
    expect(borrow.clock().acc).toBe(13) // SUB's T2 → 2 − 5 wraps to 13
  })

  test('the accumulator accumulates across ADDs and holds across non-arithmetic ops', () => {
    // A running sum: 1 + 2 + 3 = 6, then OUT, then HLT — ACC must hold 6 through OUT and HLT (the
    // non-arithmetic ops leave acc_load low), proving the register holds and HLT is a real no-op.
    const p = prog(
      [CPU_OPCODES.LDI, 1],
      [CPU_OPCODES.ADD, 2],
      [CPU_OPCODES.ADD, 3],
      [CPU_OPCODES.OUT],
      [CPU_OPCODES.HLT],
    )
    const d = driver(buildCpu(p))
    d.clock({ reset: true })
    for (let i = 0; i < 3; i++) d.clock() // LDI 1 → ACC 1
    for (let i = 0; i < 3; i++) d.clock() // ADD 2 → ACC 3
    let s = { acc: 0, out: 0, pc: 0 }
    for (let i = 0; i < 3; i++) s = d.clock() // ADD 3 → ACC 6
    expect(s.acc).toBe(6)
    for (let i = 0; i < 3; i++) s = d.clock() // OUT → OUTREG 6, ACC held
    expect(s.out).toBe(6)
    expect(s.acc).toBe(6)
    for (let i = 0; i < 3; i++) s = d.clock() // HLT → no-op, ACC + OUT held
    expect(s.acc).toBe(6)
    expect(s.out).toBe(6)
  })

  test('powers up cleanly and executes from address 0 with no reset pulse', () => {
    // A fresh CPU (empty state Map = every flip-flop 0) already sits at PC = 0, T-state 0, so it
    // fetches and executes program[0] with no reset — the binary T-counter boots to T0.
    const d = driver(buildCpu()) // demo program: LDI 3 first
    d.clock() // T0
    d.clock() // T1
    expect(d.clock().acc).toBe(3) // T2 → LDI 3 executed from a cold start
    expect(CPU_DEMO_PROGRAM[0]).toBe(cpuInstr(CPU_OPCODES.LDI, 3)) // (the program really is LDI 3 first)
  })
})

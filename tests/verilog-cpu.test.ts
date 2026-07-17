/**
 * RTL synthesis (increment 5) — THE PAYOFF: a whole CPU written in Verilog that builds itself from real gates
 * and flip-flops. This is the climax of the HDL-bridge arc — combinational synthesis (parts 1-2) gave the
 * datapath and ROM, sequential (part 3) gave the registers, and memory (part 4) gave the data RAM. Put
 * together they are exactly the RTL a processor needs, so a SAP-1-style teaching CPU — program counter,
 * instruction register, a 3-microstep control sequencer, an accumulator, an ALU built from `+`/`-`, a
 * `case`-decoded control unit, and a `reg [3:0] mem [0:15]` data RAM — authored ENTIRELY in Verilog imports to
 * one gate block. We then CLOCK that block on the real logic engine and watch it run a real program: multiply
 * 3 × 4 by repeated addition, using the RAM to hold the running sum and a loop counter, and read 12 out of the
 * output register. Every flip-flop and gate is real (it flattens to the fast logic engine); nothing is
 * sequenced in JS — the T-state counter and gate-decoded control drive it, exactly like the hand-wired buildCpu.
 */

import { describe, expect, test } from 'vitest'
import type { BlockData, CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { simulateLogic } from '../src/renderer/logic-sim.ts'
import {
  buildDemoCpu,
  cpu8Verilog,
  cpuVerilog,
  DEMO_RESULT,
  DEMO8_PROGRAM,
  DEMO8_RESULT,
  instr,
  instr12,
  multiplyProgram,
  OP,
  OP8,
} from '../src/renderer/verilog-cpu-demo.ts'
import { importVerilog } from '../src/renderer/verilog-import.ts'

const supply = (volts: number) => ({
  nominal_voltage: { value: { kind: 'scalar', amount: volts, unit: 'volt' } },
})
const src = (id: string, volts: number): CanvasNodeLike => ({
  id,
  position: { x: 0, y: 0 },
  data: { definition: 'power_source', parameters: supply(volts) },
})
const w = (id: string, s: string, sh: string, t: string, th: string): CanvasEdgeLike => ({
  id,
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
})

function solve(block: BlockData, inputs: Record<string, boolean>, state: Map<string, boolean>) {
  const nodes: CanvasNodeLike[] = [
    { id: 'M', position: { x: 0, y: 0 }, data: { definition: 'block', block } },
    { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
    src('vp', 5),
  ]
  const edges: CanvasEdgeLike[] = [
    w('ep', 'vp', 'terminal_positive', 'M', 'v_dd'),
    w('eg', 'M', 'gnd', 'g', 'reference_terminal'),
    w('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
  ]
  let k = 0
  for (const [port, val] of Object.entries(inputs)) {
    const vid = `v${k++}`
    nodes.push(src(vid, val ? 5 : 0))
    edges.push(w(`e${vid}`, vid, 'terminal_positive', 'M', port))
    edges.push(w(`e${vid}n`, vid, 'terminal_negative', 'g', 'reference_terminal'))
  }
  return simulateLogic(nodes, edges, state)
}

/** One rising clock edge: clk LOW then HIGH, rst held steady across both half-solves; returns the high solve. */
function tick(block: BlockData, rst: boolean, state: Map<string, boolean>) {
  solve(block, { rst, clk: false }, state)
  return solve(block, { rst, clk: true }, state)
}

const readReg = (
  r: { value: (n: string, p: string) => boolean | undefined },
  name: string,
  width: number,
): number => {
  let v = 0
  for (let i = 0; i < width; i++) if (r.value('M', `${name}[${i}]`) === true) v |= 1 << i
  return v
}

// The CPU generator is shared with the in-app "watch it run" demo — one source of truth (no drift between the
// processor the app builds and the one this test proves). This test uses 3 × 4 = 12 (the flagship result).
const PROGRAM = multiplyProgram(3, 4)

describe('a whole CPU written in Verilog builds itself from real gates and runs a program', () => {
  test('the CPU imports to one gate block with no unbuildable constructs', () => {
    const { block, warnings } = importVerilog(cpuVerilog(PROGRAM))
    expect(warnings, `warnings: ${warnings.join(' | ')}`).toEqual([])
    expect(block).not.toBeNull()
  })

  test('the imported CPU is genuinely real flip-flops and gates — no faked or opaque nodes', () => {
    // Proves the headline claim IN the test: the block is nothing but real cells. Every top-level node is a
    // composite cell (never a placeholder), with exactly one D flip-flop per state bit and a large body of
    // real logic gates around them.
    const { block } = importVerilog(cpuVerilog(PROGRAM))
    const cpu = block as BlockData
    expect(cpu.nodes.every((n) => n.definition === 'block' && n.block != null)).toBe(true)
    // pc4 + ir8 + t2 + acc4 + out4 + halted1 + mem(16×4) = 87 real positive-edge D flip-flops
    const flops = cpu.nodes.filter((n) => n.block?.name === 'D Flip-Flop')
    expect(flops.length).toBe(87)
    expect(cpu.nodes.length - flops.length).toBeGreaterThan(200) // surrounded by real logic gates
  })

  test('it multiplies 3 × 4 by repeated addition and halts with 12 in the output register', () => {
    const { block } = importVerilog(cpuVerilog(PROGRAM))
    const cpu = block as BlockData
    const state = new Map<string, boolean>()
    tick(cpu, true, state) // reset: pc/acc/out/halted ← 0

    let halted = false
    let earlyOut = -1
    let last = solve(cpu, { rst: false, clk: false }, state)
    for (let i = 0; i < 400 && !halted; i++) {
      last = tick(cpu, false, state)
      if (i === 10) earlyOut = readReg(last, 'out', 4) // OUT hasn't run yet — result is still building
      halted = last.value('M', 'halted') === true
    }
    expect(earlyOut).toBe(0) // proof the 12 is computed over real clocked steps, not a combinational shortcut
    expect(halted, 'the CPU should reach HLT within the tick budget').toBe(true)
    expect(last.settled, 'the gate network must converge on every solve').toBe(true)
    expect(readReg(last, 'out', 4)).toBe(12) // 3 × 4 = 12, computed on real gates
  })

  test('the in-app demo CPU (buildDemoCpu) computes 3 × 3 = 9 with live pc/acc readouts — the app block', () => {
    const cpu = buildDemoCpu()
    expect(cpu).not.toBeNull()
    const state = new Map<string, boolean>()
    tick(cpu as BlockData, true, state)
    let halted = false
    let last = solve(cpu as BlockData, { rst: false, clk: false }, state)
    for (let i = 0; i < 400 && !halted; i++) {
      last = tick(cpu as BlockData, false, state)
      halted = last.value('M', 'halted') === true
    }
    expect(halted).toBe(true)
    expect(readReg(last, 'out', 4)).toBe(DEMO_RESULT) // 9 = 3 × 3, a single hex digit for the 7-seg display
    // the demo's debug readouts the on-screen displays hang off: accumulator holds the answer, pc reached HLT
    expect(readReg(last, 'accv', 4)).toBe(9)
    expect(readReg(last, 'pcv', 4)).toBe(15)
  })

  test('a non-terminating program does NOT report halted (the halt check has teeth)', () => {
    // A negative control: `JMP 0` loops forever, so the machine must never set halted — proving the halt
    // assertions above catch a real HLT, not a net that trivially reads true.
    const { block } = importVerilog(cpuVerilog([instr(OP.JMP, 0)]))
    const cpu = block as BlockData
    const state = new Map<string, boolean>()
    tick(cpu, true, state)
    let halted = false
    for (let i = 0; i < 40 && !halted; i++) {
      halted = tick(cpu, false, state).value('M', 'halted') === true
    }
    expect(halted).toBe(false)
  })

  test('a different program (5 + 6 = 11) runs on the same CPU', () => {
    // Straight-line add with no loop, exercising the datapath independent of the multiply program.
    const add = [instr(OP.LDI, 5), instr(OP.ADD, 6), instr(OP.OUT), instr(OP.HLT)]
    const { block, warnings } = importVerilog(cpuVerilog(add))
    expect(warnings).toEqual([])
    const cpu = block as BlockData
    const state = new Map<string, boolean>()
    tick(cpu, true, state)
    let halted = false
    let last = solve(cpu, { rst: false, clk: false }, state)
    for (let i = 0; i < 120 && !halted; i++) {
      last = tick(cpu, false, state)
      halted = last.value('M', 'halted') === true
    }
    expect(halted).toBe(true)
    expect(readReg(last, 'out', 4)).toBe(11) // (5 + 6) mod 16
  })
})

describe('the 8-bit CPU in Verilog uses the increment-6 operators as real hardware', () => {
  const runToHalt = (program: number[], budget = 120) => {
    const { block, warnings } = importVerilog(cpu8Verilog(program))
    expect(warnings, `warnings: ${warnings.join(' | ')}`).toEqual([])
    const cpu = block as BlockData
    const state = new Map<string, boolean>()
    tick(cpu, true, state) // reset
    let halted = false
    let last = solve(cpu, { rst: false, clk: false }, state)
    for (let i = 0; i < budget && !halted; i++) {
      last = tick(cpu, false, state)
      halted = last.value('M', 'halted') === true
    }
    expect(halted, 'should reach HLT').toBe(true)
    return readReg(last, 'out', 8)
  }

  test('the demo CPU multiplies 12 × 10 = 120 in ONE hardware-multiply instruction', () => {
    expect(runToHalt(DEMO8_PROGRAM)).toBe(DEMO8_RESULT) // 120
  })

  test('shift instructions: 5 << 2 >> 1 = 10 (barrel shifters in the datapath)', () => {
    const program = [
      instr12(OP8.LDI, 5),
      instr12(OP8.SHL, 2), // acc = 5 << 2 = 20
      instr12(OP8.SHR, 1), // acc = 20 >> 1 = 10
      instr12(OP8.OUT),
      instr12(OP8.HLT),
    ]
    expect(runToHalt(program)).toBe(10)
  })

  test('a less-than comparison branch (JLT) is taken when acc < the immediate', () => {
    // acc=3; JLT 4 compares acc < 4 and jumps to address 4 (taken) → loads 42; the fall-through path loads 99
    const program = [
      instr12(OP8.LDI, 3),
      instr12(OP8.JLT, 4), // 3 < 4 → jump to addr 4
      instr12(OP8.LDI, 99), // (skipped when the branch is taken)
      instr12(OP8.HLT),
      instr12(OP8.LDI, 42), // addr 4
      instr12(OP8.OUT),
      instr12(OP8.HLT),
    ]
    expect(runToHalt(program)).toBe(42)
  })

  test('a bigger multiply overflows the byte honestly (20 × 20 = 400 mod 256 = 144)', () => {
    const program = [instr12(OP8.LDI, 20), instr12(OP8.MUL, 20), instr12(OP8.OUT), instr12(OP8.HLT)]
    expect(runToHalt(program)).toBe(400 % 256) // 144 — real 8-bit wraparound, not a lie
  })
})

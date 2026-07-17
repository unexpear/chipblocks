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

// ── the CPU, authored in Verilog ────────────────────────────────────────────────
// 4-bit datapath; 8-bit instruction = {opcode[3:0], operand[3:0]}. Three microsteps per instruction:
//   T0  ir  <- rom[pc]     load the instruction
//   T1  pc  <- pc + 1      advance the program counter
//   T2  execute            (a taken jump overwrites the T1 increment; load wins)
const OP = { LDI: 1, ADD: 2, SUB: 3, OUT: 4, JMP: 5, JZ: 6, LDA: 7, STA: 8, HLT: 15 } as const
const instr = (op: number, arg = 0): number => ((op << 4) | (arg & 0xf)) & 0xff

// Multiply 3 × 4 by repeated addition: mem[0] = running sum, mem[1] = loop counter.
const PROGRAM: number[] = [
  instr(OP.LDI, 0), //  0: acc = 0
  instr(OP.STA, 0), //  1: mem[0] = 0        (sum)
  instr(OP.LDI, 3), //  2: acc = 3
  instr(OP.STA, 1), //  3: mem[1] = 3        (counter)
  instr(OP.LDA, 0), //  4: acc = sum         ← loop
  instr(OP.ADD, 4), //  5: acc = sum + 4
  instr(OP.STA, 0), //  6: sum = acc
  instr(OP.LDA, 1), //  7: acc = counter
  instr(OP.SUB, 1), //  8: acc = counter - 1
  instr(OP.STA, 1), //  9: counter = acc
  instr(OP.JZ, 12), // 10: if acc == 0 goto end
  instr(OP.JMP, 4), // 11: goto loop
  instr(OP.LDA, 0), // 12: acc = sum (= 12)  ← end
  instr(OP.OUT), //    13: out = acc
  instr(OP.HLT), //    14: halt
  0, //                15: (unused)
]

/** The instruction ROM as a combinational `assign`: a pc-keyed ternary chain of the program's bytes. */
function romAssign(program: number[]): string {
  const chain = program
    .map((byte, addr) => `(pc == 4'd${addr}) ? 8'h${byte.toString(16).padStart(2, '0')} : `)
    .join('\n           ')
  return `assign rom = ${chain}8'h00;`
}

function cpuVerilog(program: number[]): string {
  return `module cpu(input clk, input rst, output reg [3:0] out, output reg halted);
      reg [3:0] pc;
      reg [7:0] ir;
      reg [1:0] t;
      reg [3:0] acc;
      reg [3:0] mem [0:15];
      wire [7:0] rom;
      ${romAssign(program)}
      always @(posedge clk) begin
        if (rst) begin
          pc <= 4'd0; ir <= 8'd0; t <= 2'd0; acc <= 4'd0; out <= 4'd0; halted <= 1'b0;
        end else if (!halted) begin
          t <= (t == 2'd2) ? 2'd0 : t + 2'd1;
          if (t == 2'd0) ir <= rom;
          if (t == 2'd1) pc <= pc + 4'd1;
          if (t == 2'd2) case (ir[7:4])
            4'd1:  acc <= ir[3:0];             // LDI
            4'd2:  acc <= acc + ir[3:0];       // ADD
            4'd3:  acc <= acc - ir[3:0];       // SUB
            4'd4:  out <= acc;                 // OUT
            4'd5:  pc <= ir[3:0];              // JMP
            4'd6:  if (acc == 4'd0) pc <= ir[3:0];   // JZ
            4'd7:  acc <= mem[ir[3:0]];        // LDA
            4'd8:  mem[ir[3:0]] <= acc;        // STA
            4'd15: halted <= 1'b1;             // HLT
          endcase
        end
      end
    endmodule`
}

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

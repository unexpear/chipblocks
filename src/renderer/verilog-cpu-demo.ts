/**
 * The teaching CPU, authored in Verilog — shared by the in-app "watch it run" demo and the test that proves it
 * (tests/verilog-cpu.test.ts). `cpuVerilog(program)` emits a small SAP-1-style processor as Verilog text: a
 * program counter, instruction register, a 3-microstep sequencer, an accumulator, an adder/subtractor ALU, a
 * `case`-decoded control unit, and a `reg [3:0] mem [0:15]` data RAM — every piece a `reg`/`always`/`assign`,
 * nothing hand-wired. Run it through `importVerilog` and it becomes ONE block of real gates + flip-flops (the
 * HDL-synthesis arc, parts 1-5). It is 4-bit, so a single-digit result shows cleanly on one hex display; the
 * in-app demo multiplies 3 × 3 = 9 by repeated addition, keeping the running total and a countdown in its RAM.
 */

import { type BlockData, cloneBlockData } from './blocks.ts'
import { importVerilog } from './verilog-import.ts'

/** Opcodes (4-bit); an instruction is {opcode[3:0], operand[3:0]}. */
export const OP = {
  LDI: 1,
  ADD: 2,
  SUB: 3,
  OUT: 4,
  JMP: 5,
  JZ: 6,
  LDA: 7,
  STA: 8,
  HLT: 15,
} as const
export const instr = (op: number, arg = 0): number => ((op << 4) | (arg & 0xf)) & 0xff

/** The instruction ROM as a combinational `assign`: a pc-keyed ternary chain of the program's bytes. */
function romAssign(program: number[]): string {
  const chain = program
    .map((byte, addr) => `(pc == 4'd${addr}) ? 8'h${byte.toString(16).padStart(2, '0')} : `)
    .join('\n           ')
  return `assign rom = ${chain}8'h00;`
}

/**
 * The CPU as Verilog text, with `program` baked into its ROM. Three microsteps per instruction:
 *   T0  ir <- rom[pc]   load the instruction
 *   T1  pc <- pc + 1    advance the program counter
 *   T2  execute         (a taken jump overwrites the T1 increment; load wins)
 * Instruction set: LDI, ADD, SUB, OUT, JMP, JZ, LDA (load from RAM), STA (store to RAM), HLT.
 *
 * `exposeState` adds two DEBUG output buses — `pcv` (the program counter) and `accv` (the accumulator) — as
 * plain `assign`s off the internal registers, so the in-app demo can show them stepping/computing live. They
 * add no flip-flops or logic to the datapath, so the processor the test proves (default, no debug ports) is
 * identical to the one the demo runs.
 */
export function cpuVerilog(program: number[], exposeState = false): string {
  const dbgPorts = exposeState ? ', output [3:0] pcv, output [3:0] accv' : ''
  const dbgAssigns = exposeState ? '\n      assign pcv = pc;\n      assign accv = acc;' : ''
  return `module cpu(input clk, input rst, output reg [3:0] out, output reg halted${dbgPorts});
      reg [3:0] pc;
      reg [7:0] ir;
      reg [1:0] t;
      reg [3:0] acc;
      reg [3:0] mem [0:15];
      wire [7:0] rom;
      ${romAssign(program)}${dbgAssigns}
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

/** Multiply `a × b` by repeated addition, result in the output register (a, b small enough that a×b ≤ 15).
 *  mem[0] = running sum, mem[1] = loop counter; add `a` to the sum `b` times. */
export function multiplyProgram(a: number, b: number): number[] {
  return [
    instr(OP.LDI, 0), //  0: acc = 0
    instr(OP.STA, 0), //  1: mem[0] = 0        (sum)
    instr(OP.LDI, b), //  2: acc = b
    instr(OP.STA, 1), //  3: mem[1] = b        (counter)
    instr(OP.LDA, 0), //  4: acc = sum         ← loop
    instr(OP.ADD, a), //  5: acc = sum + a
    instr(OP.STA, 0), //  6: sum = acc
    instr(OP.LDA, 1), //  7: acc = counter
    instr(OP.SUB, 1), //  8: acc = counter - 1
    instr(OP.STA, 1), //  9: counter = acc
    instr(OP.JZ, 12), // 10: if acc == 0 goto end
    instr(OP.JMP, 4), // 11: goto loop
    instr(OP.LDA, 0), // 12: acc = sum (= a×b)  ← end
    instr(OP.OUT), //    13: out = acc
    instr(OP.HLT), //    14: halt
    0, //                15: (unused)
  ]
}

/** The in-app demo program: 3 × 3 = 9 (a single hex digit, so it reads correctly on one 7-segment display). */
export const DEMO_PROGRAM: number[] = multiplyProgram(3, 3)
export const DEMO_RESULT = 9

/** Build the demo CPU by SYNTHESIZING it from Verilog — the block is real gates + flip-flops, not hand-wired.
 *  The demo variant exposes pcv/accv debug buses so the on-screen readouts can show it stepping + computing.
 *  `idSuffix` keeps node ids unique when the block is dropped alongside others on the canvas. */
export function buildDemoCpu(idSuffix = 'vcpu'): BlockData | null {
  const { block } = importVerilog(cpuVerilog(DEMO_PROGRAM, true))
  return block === null ? null : cloneBlockData(block, idSuffix)
}

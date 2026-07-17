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

// ── the 8-bit CPU ────────────────────────────────────────────────────────────────
// A bigger processor authored in Verilog: an 8-bit datapath (values 0..255), a 16-word × 8-bit RAM, and a
// richer instruction set that uses the operators from HDL increment 6 as REAL hardware — a one-instruction
// hardware MULTIPLY, barrel SHIFTS, and a less-than COMPARISON branch. 12-bit instructions = 4-bit opcode +
// 8-bit operand, so an immediate can be any byte.
export const OP8 = {
  LDI: 1, // acc <- imm
  ADD: 2, // acc <- acc + imm
  SUB: 3, // acc <- acc - imm
  MUL: 4, // acc <- acc * imm   (real hardware multiplier)
  SHL: 5, // acc <- acc << imm  (barrel shifter)
  SHR: 6, // acc <- acc >> imm
  OUT: 7, // out <- acc
  JMP: 8, // pc  <- addr
  JZ: 9, // if acc == 0: pc <- addr
  JLT: 10, // if acc < imm: pc <- addr  (magnitude comparison)
  LDA: 11, // acc <- mem[addr]
  STA: 12, // mem[addr] <- acc
  HLT: 15,
} as const
/** A 12-bit instruction word: 4-bit opcode + 8-bit operand. */
export const instr12 = (op: number, arg = 0): number => (((op & 0xf) << 8) | (arg & 0xff)) & 0xfff

function romAssign12(program: number[]): string {
  const chain = program
    .map((word, addr) => `(pc == 4'd${addr}) ? 12'h${word.toString(16).padStart(3, '0')} : `)
    .join('\n           ')
  return `assign rom = ${chain}12'h000;`
}

/** The 8-bit CPU as Verilog text — same three-microstep fetch/advance/execute as the 4-bit CPU, but 8-bit
 *  data and an instruction set with hardware MUL / SHL / SHR / JLT. `exposeState` adds pcv/accv debug buses. */
export function cpu8Verilog(program: number[], exposeState = false): string {
  const dbgPorts = exposeState ? ', output [3:0] pcv, output [7:0] accv' : ''
  const dbgAssigns = exposeState ? '\n      assign pcv = pc;\n      assign accv = acc;' : ''
  return `module cpu8(input clk, input rst, output reg [7:0] out, output reg halted${dbgPorts});
      reg [3:0] pc;
      reg [11:0] ir;
      reg [1:0] t;
      reg [7:0] acc;
      reg [7:0] mem [0:15];
      wire [11:0] rom;
      ${romAssign12(program)}${dbgAssigns}
      always @(posedge clk) begin
        if (rst) begin
          pc <= 4'd0; ir <= 12'd0; t <= 2'd0; acc <= 8'd0; out <= 8'd0; halted <= 1'b0;
        end else if (!halted) begin
          t <= (t == 2'd2) ? 2'd0 : t + 2'd1;
          if (t == 2'd0) ir <= rom;
          if (t == 2'd1) pc <= pc + 4'd1;
          if (t == 2'd2) case (ir[11:8])
            4'd1:  acc <= ir[7:0];              // LDI
            4'd2:  acc <= acc + ir[7:0];        // ADD
            4'd3:  acc <= acc - ir[7:0];        // SUB
            4'd4:  acc <= acc * ir[7:0];        // MUL  (hardware multiplier)
            4'd5:  acc <= acc << ir[7:0];       // SHL  (barrel shifter)
            4'd6:  acc <= acc >> ir[7:0];       // SHR
            4'd7:  out <= acc;                  // OUT
            4'd8:  pc <= ir[3:0];               // JMP
            4'd9:  if (acc == 8'd0) pc <= ir[3:0];       // JZ
            4'd10: if (acc < ir[7:0]) pc <= ir[3:0];     // JLT (acc < imm → branch)
            4'd11: acc <= mem[ir[3:0]];         // LDA
            4'd12: mem[ir[3:0]] <= acc;         // STA
            4'd15: halted <= 1'b1;              // HLT
          endcase
        end
      end
    endmodule`
}

/** The 8-bit demo program: 12 × 10 = 120 in a SINGLE hardware-multiply instruction (vs the 4-bit CPU's
 *  repeated-addition loop). Result 120 fits in a byte. */
export const DEMO8_PROGRAM: number[] = [
  instr12(OP8.LDI, 12), // acc = 12
  instr12(OP8.MUL, 10), // acc = 12 * 10 = 120   ← one instruction, a real multiplier
  instr12(OP8.OUT), //     out = 120
  instr12(OP8.HLT),
]
export const DEMO8_RESULT = 120

/** Build the 8-bit demo CPU from Verilog (exposes pcv/accv for on-screen readouts). */
export function buildDemoCpu8(idSuffix = 'vcpu8'): BlockData | null {
  const { block } = importVerilog(cpu8Verilog(DEMO8_PROGRAM, true))
  return block === null ? null : cloneBlockData(block, idSuffix)
}

/**
 * The internal gate cells a yosys-written netlist is made of.
 *
 * `write_verilog` on a synthesized design emits instances of cells named `$_NAND_`, `$_DFF_P_` and friends
 * whose definitions live in yosys's own simulation library, NOT in the file it just wrote. An importer that
 * reads only the files it is given therefore finds no module for them and — correctly — refuses the whole
 * design. Supplying the definitions here turns a flattened netlist into ordinary structural Verilog.
 *
 * Every body below is written to MEAN exactly what yosys's simulation library `simcells.v` says the cell
 * means; `tests/verilog-yosys-cells.test.ts` holds the truth table of each one, taken from Icarus Verilog
 * 14.0 driving yosys's own model. The set is deliberately partial: a cell this importer would build WRONG is
 * left out, so the design keeps refusing rather than building a CPU on a bad gate. Left out for that reason —
 * `$_TBUF_` (tri-state: a two-valued netlist has no Z), the `$_DLATCH_*` and `$_SR_*` level-sensitive cells,
 * and every negative-edge or asynchronous-reset flip-flop (`$_DFF_N_`, `$_DFF_PP0_`, …), which this importer
 * already refuses by name when they are written out by hand.
 */
export const YOSYS_CELLS: Record<string, string> = {
  $_BUF_: 'module \\$_BUF_ (A, Y); input A; output Y; assign Y = A; endmodule',
  $_NOT_: 'module \\$_NOT_ (A, Y); input A; output Y; assign Y = ~A; endmodule',
  $_AND_: 'module \\$_AND_ (A, B, Y); input A, B; output Y; assign Y = A & B; endmodule',
  $_NAND_: 'module \\$_NAND_ (A, B, Y); input A, B; output Y; assign Y = ~(A & B); endmodule',
  $_OR_: 'module \\$_OR_ (A, B, Y); input A, B; output Y; assign Y = A | B; endmodule',
  $_NOR_: 'module \\$_NOR_ (A, B, Y); input A, B; output Y; assign Y = ~(A | B); endmodule',
  $_XOR_: 'module \\$_XOR_ (A, B, Y); input A, B; output Y; assign Y = A ^ B; endmodule',
  $_XNOR_: 'module \\$_XNOR_ (A, B, Y); input A, B; output Y; assign Y = ~(A ^ B); endmodule',
  $_ANDNOT_: 'module \\$_ANDNOT_ (A, B, Y); input A, B; output Y; assign Y = A & (~B); endmodule',
  $_ORNOT_: 'module \\$_ORNOT_ (A, B, Y); input A, B; output Y; assign Y = A | (~B); endmodule',
  $_MUX_: 'module \\$_MUX_ (A, B, S, Y); input A, B, S; output Y; assign Y = S ? B : A; endmodule',
  $_NMUX_:
    'module \\$_NMUX_ (A, B, S, Y); input A, B, S; output Y; assign Y = S ? !B : !A; endmodule',
  $_AOI3_:
    'module \\$_AOI3_ (A, B, C, Y); input A, B, C; output Y; assign Y = ~((A & B) | C); endmodule',
  $_OAI3_:
    'module \\$_OAI3_ (A, B, C, Y); input A, B, C; output Y; assign Y = ~((A | B) & C); endmodule',
  $_AOI4_:
    'module \\$_AOI4_ (A, B, C, D, Y); input A, B, C, D; output Y; assign Y = ~((A & B) | (C & D)); endmodule',
  $_OAI4_:
    'module \\$_OAI4_ (A, B, C, D, Y); input A, B, C, D; output Y; assign Y = ~((A | B) & (C | D)); endmodule',
  $_DFF_P_:
    'module \\$_DFF_P_ (D, C, Q); input D, C; output reg Q; always @(posedge C) Q <= D; endmodule',
}

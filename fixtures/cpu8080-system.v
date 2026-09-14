// A whole small 8080 computer, in hardware only.
//   - vm80a_core           the die-derived Intel 8080, from cpu8080-vm80a-core.v
//                          (Copyright (c) 2014-2018 by 1801BM1@gmail.com, CC-BY 3.0,
//                          https://github.com/1801BM1/vm80a)
//   - phase generator      a real toggling flip-flop making the 8080's two clock phases
//   - 32-byte mask ROM     a combinational decode matrix holding the test program
//   - 16-byte RAM          real registers + a decoder + a read multiplexer
// No testbench, no software driving it: everything below synthesizes to gates and flip-flops.
//
// This file is ChipBlocks' own work (MIT, see LICENSE). It INSTANTIATES the CC-BY 3.0 vm80a core but
// contains none of its expression. Read the pair together — one alone is not a computer.

module sys8080(
   input        clk,
   input        reset,
   input        i_hold,
   input        i_int,
   input        i_ready,
   output [15:0] o_addr,
   output [7:0]  o_data,
   output        o_wr_n,
   output        o_sync,
   output        o_dbin,
   output        o_wait,
   output [7:0]  o_ram0,
   output [7:0]  o_ram1,
   output [7:0]  o_ram2
);

   // ---- two-phase clock: F1 then F2, one system clock each -------------------
   reg phase;
   initial phase = 1'b0;
   always @(posedge clk) phase <= ~phase;
   wire f1 = ~phase;
   wire f2 =  phase;

   wire [15:0] a;
   wire [7:0]  dout;
   wire        wr_n, sync, dbin, waitr, aena, dena, hlda, inte;

   // ---- 32-byte mask ROM -----------------------------------------------------
   reg [7:0] rom;
   always @* begin
      case (a[4:0])
         5'h00: rom = 8'h3E;  // MVI A,05h
         5'h01: rom = 8'h05;
         5'h02: rom = 8'h06;  // MVI B,07h
         5'h03: rom = 8'h07;
         5'h04: rom = 8'h80;  // ADD B            A = 0Ch
         5'h05: rom = 8'h32;  // STA 0040h
         5'h06: rom = 8'h40;
         5'h07: rom = 8'h00;
         5'h08: rom = 8'h3A;  // LDA 0040h
         5'h09: rom = 8'h40;
         5'h0A: rom = 8'h00;
         5'h0B: rom = 8'h07;  // RLC              A = 18h
         5'h0C: rom = 8'h32;  // STA 0041h
         5'h0D: rom = 8'h41;
         5'h0E: rom = 8'h00;
         5'h0F: rom = 8'hD6;  // SUI 18h          A = 00h, zero flag set
         5'h10: rom = 8'h18;
         5'h11: rom = 8'hCA;  // JZ 0016h
         5'h12: rom = 8'h16;
         5'h13: rom = 8'h00;
         5'h14: rom = 8'h76;  // HLT   (skipped if the jump is taken)
         5'h15: rom = 8'h00;  // NOP
         5'h16: rom = 8'h3E;  // MVI A,AAh
         5'h17: rom = 8'hAA;
         5'h18: rom = 8'h32;  // STA 0042h
         5'h19: rom = 8'h42;
         5'h1A: rom = 8'h00;
         5'h1B: rom = 8'h76;  // HLT
         default: rom = 8'h00;
      endcase
   end

   // ---- 16-byte RAM at 0040h..004Fh -----------------------------------------
   wire ram_sel = (a[15:4] == 12'h004);
   reg [7:0] ram [0:15];
   always @(posedge clk)
      if (ram_sel & ~wr_n) ram[a[3:0]] <= dout;

   wire [7:0] din = ram_sel ? ram[a[3:0]] : rom;

   vm80a_core core(
      .pin_clk   (clk),
      .pin_f1    (f1),
      .pin_f2    (f2),
      .pin_reset (reset),
      .pin_a     (a),
      .pin_dout  (dout),
      .pin_din   (din),
      .pin_aena  (aena),
      .pin_dena  (dena),
      .pin_hold  (i_hold),
      .pin_hlda  (hlda),
      .pin_ready (i_ready),
      .pin_wait  (waitr),
      .pin_int   (i_int),
      .pin_inte  (inte),
      .pin_sync  (sync),
      .pin_dbin  (dbin),
      .pin_wr_n  (wr_n)
   );

   assign o_addr = a;
   assign o_data = dout;
   assign o_wr_n = wr_n;
   assign o_sync = sync;
   assign o_dbin = dbin;
   assign o_wait = waitr;
   assign o_ram0 = ram[0];
   assign o_ram1 = ram[1];
   assign o_ram2 = ram[2];
endmodule

`timescale 1ns/100ps
// Reference run: the ORIGINAL, unmodified vm80a core in Icarus Verilog — the oracle the ChipBlocks
// result in tests/verilog-8080.test.ts is checked against. Drives nothing but the clock and the reset
// line, exactly like the ChipBlocks harness does.
//
//   iverilog -g2005 -DRESET_CLKS=60 -DRUN_CLKS=401 -o run.out \
//            fixtures/cpu8080-system.v fixtures/cpu8080-vm80a-core.v fixtures/cpu8080-icarus-testbench.v
//   vvp run.out
//
// Icarus counts n at the posedge BEFORE it prints, so its clock numbers read one higher than the
// ChipBlocks harness's, which counts the edge it has just applied. The addresses and data are the same.
//
// ChipBlocks' own work (MIT, see LICENSE).
module tb_sys();
   reg clk = 0;
   reg reset = 1;
   wire [15:0] o_addr;
   wire [7:0]  o_data;
   wire o_wr_n, o_sync, o_dbin, o_wait;
   wire [7:0] o_ram0, o_ram1, o_ram2;
   integer n = 0;
   reg prev_wr_n = 1;

   sys8080 dut(.clk(clk), .reset(reset), .i_hold(1'b0), .i_int(1'b0), .i_ready(1'b1), .o_addr(o_addr), .o_data(o_data),
               .o_wr_n(o_wr_n), .o_sync(o_sync), .o_dbin(o_dbin), .o_wait(o_wait),
               .o_ram0(o_ram0), .o_ram1(o_ram1), .o_ram2(o_ram2));

   always #10 clk = ~clk;

   always @(posedge clk) begin
      n = n + 1;
      if (n == `RESET_CLKS) reset <= 0;
      if (n < `RESET_CLKS + 40)
        $display("t %0d rst=%b a=%h din=%h dbin=%b wr_n=%b sync=%b wait=%b", n, reset, o_addr, dut.din, o_dbin, o_wr_n, o_sync, o_wait);
      if (prev_wr_n === 1'b1 && o_wr_n === 1'b0)
         $display("clk %0d  WRITE addr=%04h data=%02h", n, o_addr, o_data);
      prev_wr_n <= o_wr_n;
      if (n > `RUN_CLKS) begin
         $display("END clk=%0d ram[0]=%02h ram[1]=%02h ram[2]=%02h wait=%b", n, o_ram0, o_ram1, o_ram2, o_wait);
         $finish;
      end
   end
endmodule

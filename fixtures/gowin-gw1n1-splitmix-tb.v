// Testbench for gowin-gw1n1-splitmix.v, used to produce gowin-gw1n1-splitmix-vectors.json.
//
// The design has no reset, so its registers start unknown in a Verilog simulation and zero in the recovered
// one; they are cleared here so the two start in the same state. Each cycle drives a, reads y just BEFORE the
// clock edge, and then clocks — which is where a scope triggered on the clock would sample, and which is the
// same instant the recovered design's per-cycle trace records.
`timescale 1ns/1ps
module tb;
  reg clk = 0;
  reg [3:0] a = 0;
  wire [1:0] y;
  top dut(.clk(clk), .a(a), .y(y));
  integer i;
  reg [3:0] pattern [0:31];
  initial begin
    for (i = 0; i < 16; i = i + 1) pattern[i] = i[3:0];
    for (i = 0; i < 16; i = i + 1) pattern[16+i] = (i * 7) % 16;
  end
  initial begin
    dut.r = 8'b0;
    for (i = 0; i < 32; i = i + 1) begin
      a = pattern[i];
      #4;
      $display("CYCLE %0d a=%0d y0=%0b y1=%0b", i, a, y[0], y[1]);
      #1 clk = 1;
      #5 clk = 0;
    end
    $finish;
  end
endmodule

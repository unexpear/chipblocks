module top(input clk, input we, input a0, input a1, input a2, input a3, input d, output q);
  reg mem [15:0];
  always @(posedge clk) if (we) mem[{a3, a2, a1, a0}] <= d;
  assign q = mem[{a3, a2, a1, a0}];
endmodule

module top(input clk, input a, input b, output q);
  reg r0, r1;
  always @(negedge clk) r0 <= a & b;
  always @(posedge clk) r1 <= r0;
  assign q = r1;
endmodule

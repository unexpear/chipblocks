module top(input clk, input ce_n, input a, output q);
  reg r;
  always @(posedge clk) if (!ce_n) r <= a;
  assign q = r;
endmodule

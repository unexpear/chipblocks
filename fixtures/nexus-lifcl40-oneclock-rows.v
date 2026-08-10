module top(input clk, input d, output q);
  reg [127:0] sr;
  always @(posedge clk) sr <= {sr[126:0], d};
  assign q = sr[127];
endmodule

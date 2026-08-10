module top(input clk, input a, input b, output q);
  reg [15:0] acc;
  always @(posedge clk) acc <= acc + {15'b0, a};
  assign q = acc[15] ^ b;
endmodule

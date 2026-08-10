module top(input clk, input a, input b, output q);
  reg [7:0] acc;
  always @(posedge clk) acc <= acc + {7'b0, a};
  assign q = acc[7] ^ b;
endmodule

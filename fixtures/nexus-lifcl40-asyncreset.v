module top(input clk, input rst, input a, input b, output q);
  reg [1:0] s;
  always @(posedge clk or posedge rst)
    if (rst) s <= 2'b0;
    else s <= {s[0], a & b};
  assign q = s[1];
endmodule

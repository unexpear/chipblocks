module top(input clk, input rst, input ce, input a, output q);
  reg [3:0] s;
  always @(posedge clk)
    if (rst) s <= 4'b0;
    else if (ce) s <= {s[2:0], a};
  assign q = s[3];
endmodule

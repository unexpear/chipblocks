module top(input [7:0] a, output y);
  assign y = (a == 8'h5a) | (a == 8'ha5) | (a == 8'h3c);
endmodule

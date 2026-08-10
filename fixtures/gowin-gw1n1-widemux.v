module top(input [7:0] d, input [2:0] s, input g, output y, output z);
  wire m = d[s];
  assign y = m ^ g;
  assign z = m ~^ (d[0] & g);
endmodule

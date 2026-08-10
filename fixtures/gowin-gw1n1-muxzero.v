module top(input [7:0] i, input s, input [2:0] p, output y);
  wire w0, w1, m;
  (* BEL="X8Y7/LUT0" *) LUT4 #(.INIT(16'h0000)) l0 (.F(w0), .I0(i[0]), .I1(i[1]), .I2(i[2]), .I3(i[3]));
  (* BEL="X8Y7/LUT1" *) LUT4 #(.INIT(16'h8118)) l1 (.F(w1), .I0(i[4]), .I1(i[5]), .I2(i[6]), .I3(i[7]));
  (* BEL="X8Y7/MUX0" *) MUX2_LUT5 m0 (.O(m), .I0(w0), .I1(w1), .S0(s));
  (* BEL="X9Y7/LUT0" *) LUT4 #(.INIT(16'h6996)) l2 (.F(y), .I0(m), .I1(p[0]), .I2(p[1]), .I3(p[2]));
endmodule

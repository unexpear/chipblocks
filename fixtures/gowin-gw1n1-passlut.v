module top(input [7:0] i, output y, output z);
  wire w2, w4;
  (* BEL="X9Y7/LUT2" *) LUT4 #(.INIT(16'h6996)) l2 (.F(w2), .I0(i[0]), .I1(i[1]), .I2(i[2]), .I3(i[3]));
  (* BEL="X9Y7/LUT4" *) LUT4 #(.INIT(16'h8118)) l4 (.F(w4), .I0(i[4]), .I1(i[5]), .I2(i[6]), .I3(i[7]));
  (* BEL="X9Y7/LUT0" *) LUT4 #(.INIT(16'hE81C)) l0 (.F(y), .I0(i[0]), .I1(i[4]), .I2(w4), .I3(w2));
  (* BEL="X9Y7/LUT6" *) LUT4 #(.INIT(16'h1EE1)) l6 (.F(z), .I0(i[1]), .I1(i[5]), .I2(i[6]), .I3(i[7]));
endmodule

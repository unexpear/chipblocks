module top(input c0, input c1, input c2, input c3, input d, output q);
  reg [7:0] a, b, c, e;
  always @(posedge c0) a <= {a[6:0], d};
  always @(posedge c1) b <= {b[6:0], d};
  always @(posedge c2) c <= {c[6:0], d};
  always @(posedge c3) e <= {e[6:0], d};
  assign q = a[7] ^ b[7] ^ c[7] ^ e[7];
endmodule

// Dense version of the same trap: every register's data LUT is ALSO read combinationally,
// so if nextpnr can pack that at all it will do so many times over.
module top(input clk, input [3:0] a, output [3:0] y);
  reg [31:0] r;
  wire [31:0] w;
  genvar i;
  generate
    for (i = 0; i < 32; i = i + 1) begin : g
      if (i < 4)
        assign w[i] = (a[i] ^ r[i]) & (r[(i + 7) % 32] | a[(i + 1) % 4]);
      else
        assign w[i] = (r[i - 1] ^ r[(i + 5) % 32]) & (r[(i + 11) % 32] | w[i - 4]);
      always @(posedge clk) r[i] <= w[i];
    end
  endgenerate
  // read the COMBINATIONAL net as well as the registered one
  assign y[0] = w[31] ^ w[17];
  assign y[1] = r[31] ^ r[17];
  assign y[2] = w[3] ^ w[9] ^ w[21];
  assign y[3] = r[3] ^ r[9] ^ r[21];
endmodule

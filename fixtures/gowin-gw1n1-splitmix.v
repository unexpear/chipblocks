// Split-output trap, with BOTH readers inside the fabric.
// Each `f[i]` is one four-input function packed into a single lookup table; `r[i]` is that same
// lookup table's packed flip-flop. Downstream logic reads BOTH `f[i]` (straight through) and
// `r[i]` (the stored value), so a recovered cell with one output cannot serve both.
module top(input clk, input [3:0] a, output [1:0] y);
  wire [7:0] f;
  reg  [7:0] r;
  assign f[0] = (a[0] & a[1]) ^ (a[2] | a[3]);
  assign f[1] = (a[0] | a[1]) & (a[2] ^ a[3]);
  assign f[2] = ~((a[0] ^ a[1]) | (a[2] & a[3]));
  assign f[3] = (a[0] & a[2]) | (a[1] ^ a[3]);
  assign f[4] = (a[1] & a[3]) ^ (a[0] | a[2]);
  assign f[5] = ~((a[0] & a[3]) ^ (a[1] | a[2]));
  assign f[6] = (a[0] ^ a[2]) & (a[1] | a[3]);
  assign f[7] = ~((a[1] ^ a[2]) & (a[0] | a[3]));
  always @(posedge clk) r <= f;
  // the straight-through half and the stored half, each read by ordinary logic inside the chip
  assign y[0] = ((f[0] ^ f[1]) & (f[2] | f[3])) ^ ((f[4] & f[5]) | (f[6] ^ f[7]));
  assign y[1] = ((r[0] ^ r[1]) & (r[2] | r[3])) ^ ((r[4] & r[5]) | (r[6] ^ r[7]));
endmodule

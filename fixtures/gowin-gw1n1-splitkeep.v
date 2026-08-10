// The other side of the split-output trap: the plain result is read by logic INSIDE the chip and the
// stored result leaves through a package pin. There is nothing to weigh - a pin is not part of the
// recovered netlist - so the cell must be kept, carrying its plain result, and the flip-flop it also
// holds must be reported as left out rather than dropped in silence.
//
// `y` reads f[0] and f[1] together with two further inputs, so it cannot collapse into a function of
// `a` alone; that is what keeps the plain outputs really read by another lookup table.
module top(input clk, input [3:0] a, input [1:0] b, output y, output [1:0] q);
  wire [1:0] f;
  reg  [1:0] r;
  assign f[0] = (a[0] & a[1]) ^ (a[2] | a[3]);
  assign f[1] = (a[0] | a[1]) & (a[2] ^ a[3]);
  always @(posedge clk) r <= f;
  assign y = (f[0] ^ b[0]) & (f[1] | b[1]);
  assign q = r;
endmodule

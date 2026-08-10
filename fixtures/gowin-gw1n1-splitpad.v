// Register a signal AND also read it directly - the plainest form of the pattern, with BOTH readers
// off-chip. Each `f` is one four-input function, so it packs into exactly one lookup table, and every
// lookup table therefore drives its plain result to one package pin and its stored result to another.
// Nothing inside the design reads either, so there is nothing to weigh and nothing to refuse.
// Built with fixtures/gowin-gw1n1-splitpad.cst for the pin assignment.
module top(input clk, input en, input [3:0] a, output [5:0] o, output [5:0] q);
  wire [5:0] f;
  reg [5:0] r;
  assign f[0] = (a[0] & a[1]) ^ (a[2] | a[3]);
  assign f[1] = (a[0] | a[1]) & (a[2] ^ a[3]);
  assign f[2] = ~((a[0] ^ a[1]) | (a[2] & a[3]));
  assign f[3] = (a[0] & a[2]) | (a[1] ^ a[3]);
  assign f[4] = (a[1] & a[3]) ^ (a[0] | a[2]);
  assign f[5] = ~((a[0] & a[3]) ^ (a[1] | a[2]));
  always @(posedge clk) if (en) r <= f;
  assign o = f;
  assign q = r;
endmodule

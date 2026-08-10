module top(input clk, input we, input [9:0] addr, input [3:0] din, output [3:0] dout, input [9:0] raddr, output [3:0] rdata, input a, input b, input c, output y, output z);
  reg [3:0] mem [0:1023];
  reg [3:0] q;
  always @(posedge clk) begin
    if (we) mem[addr] <= din;
    q <= mem[addr];
  end
  assign dout = q;
  reg [3:0] mem2 [0:1023];
  reg [3:0] q2;
  always @(posedge clk) begin
    if (we) mem2[addr] <= din;
    q2 <= mem2[raddr];
  end
  assign rdata = q2;
  assign y = (a & b) | ~c;
  assign z = a ^ b ^ c;
endmodule

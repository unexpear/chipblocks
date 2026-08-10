module top(input clk, input we, input [7:0] adr, input [7:0] din, output reg [7:0] dout);
  reg [7:0] m [0:255];
  initial begin m[0]=8'hA5; m[1]=8'h5A; end
  always @(posedge clk) begin if (we) m[adr] <= din; dout <= m[adr]; end
endmodule

module top(input clk, input we, input ce, input [9:0] addr, input [7:0] din,
           output [3:0] dout, input a, input b, input c, output y, output z);
  wire [31:0] q;
  SP #(
    .BIT_WIDTH(8),
    .BLK_SEL(3'b111),
    .READ_MODE(1'b0),
    .WRITE_MODE(2'b00),
    .RESET_MODE("SYNC")
  ) ram (
    .DO(q), .DI({24'b0, din}), .BLKSEL(3'b111), .AD({addr, 4'b0}),
    .WRE(we), .CLK(clk), .CE(ce), .OCE(1'b0), .RESET(1'b0)
  );
  assign dout[0] = q[0] ^ q[1];
  assign dout[1] = (q[2] & q[3]) | q[4];
  assign dout[2] = q[5] ^ (q[6] & q[7]);
  assign dout[3] = q[0] & q[7];
  assign y = (a & b) | ~c;
  assign z = a ^ b ^ c;
endmodule

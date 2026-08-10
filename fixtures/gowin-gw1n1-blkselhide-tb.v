module tb;
  reg clk=0, we=0, ce=0;
  reg [9:0] addr=0;
  reg [7:0] din=0;
  reg a=0, b=0, c=0;
  wire [3:0] dout;
  wire y, z;
  integer v;
  top u(.clk(clk), .we(we), .ce(ce), .addr(addr), .din(din), .dout(dout), .a(a), .b(b), .c(c), .y(y), .z(z));
  initial begin
    $write("{\"y\":[");
    for (v = 0; v < 8; v = v + 1) begin
      {c, b, a} = v[2:0];
      #1;
      $write("%0d%s", y, (v == 7) ? "" : ",");
    end
    $write("],\"z\":[");
    for (v = 0; v < 8; v = v + 1) begin
      {c, b, a} = v[2:0];
      #1;
      $write("%0d%s", z, (v == 7) ? "" : ",");
    end
    $write("]}\n");
    $finish;
  end
endmodule

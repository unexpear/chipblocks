module top(input sel, input a, input b, input c, input d, output q);
  assign q = sel ? (a & b & c & d) : (a | b | c | d);
endmodule

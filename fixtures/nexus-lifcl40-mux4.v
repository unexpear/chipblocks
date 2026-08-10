module top(input d0, input d1, input d2, input d3, input s0, input s1, output q);
  assign q = s1 ? (s0 ? d3 : d2) : (s0 ? d1 : d0);
endmodule

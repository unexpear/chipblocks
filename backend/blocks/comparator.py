"""
Comparator block — combinational 8-bit unsigned compare with three flag outputs.

Inputs:
- `in-a`, `in-b` — 8-bit unsigned operands

Outputs:
- `eq-out` — 1-bit, set when `in_a == in_b`
- `lt-out` — 1-bit, set when `in_a < in_b`  (unsigned)
- `gt-out` — 1-bit, set when `in_a > in_b`  (unsigned)

Three outputs from a single block instead of three Equals / Less /
Greater blocks: the comparison itself is one operation (compare two
8-bit values), and the three flag views are zero-cost projections of
the same internal subtraction. Splitting them across three blocks would
busy the canvas without adding expressive power. The "no hidden
behavior" principle applies to runtime behavior switching (an ALU with
an op-code parameter); a block whose outputs are all functions of the
same inputs and that always produces all of them is fine.

Pairs naturally with Mux for branchable program control: Comparator
flags drive Mux.select, and Mux picks between two 8-bit data values.
"""

from amaranth import Elaboratable, Module, Signal, unsigned


class Comparator(Elaboratable):
    """Combinational 8-bit unsigned comparator with eq / lt / gt flags."""

    def __init__(self):
        self.in_a = Signal(unsigned(8))
        self.in_b = Signal(unsigned(8))
        self.eq_out = Signal()
        self.lt_out = Signal()
        self.gt_out = Signal()

        self.input_ports = {"in-a": self.in_a, "in-b": self.in_b}
        self.output_ports = {
            "eq-out": self.eq_out,
            "lt-out": self.lt_out,
            "gt-out": self.gt_out,
        }

    def elaborate(self, platform):
        m = Module()
        m.d.comb += [
            self.eq_out.eq(self.in_a == self.in_b),
            self.lt_out.eq(self.in_a < self.in_b),
            self.gt_out.eq(self.in_a > self.in_b),
        ]
        return m

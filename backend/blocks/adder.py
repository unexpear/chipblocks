"""
Adder block — combinational 8-bit unsigned add with carry-out.

Inputs:
- `in-a`, `in-b` — 8-bit unsigned operands

Outputs:
- `sum-out`   — 8-bit unsigned, the low 8 bits of `in_a + in_b`
- `carry-out` — 1-bit, the 9th bit of the sum (set when the unsigned
                add overflows past 255)

The two outputs land separately so the sum can flow back into another
8-bit-input block (Register, RAM, another Adder) without an external
bus-truncation step, and the carry can drive cascading add chains or
overflow indicators on its own gate-1 line. ADR-002 originally specified
a single 9-bit `sum-out`; the split shape composes more cleanly with the
8-bit data path the rest of the CPU primitives already use.

Implementation: purely combinational. Yosys collapses the `+` into a
ripple-carry chain that maps onto iCE40's `SB_CARRY` cells (≤ 8 LCs for
an 8-bit add).
"""

from amaranth import Elaboratable, Module, Signal, unsigned


class Adder(Elaboratable):
    """Combinational 8-bit unsigned adder with sum + carry-out outputs."""

    def __init__(self):
        self.in_a = Signal(unsigned(8))
        self.in_b = Signal(unsigned(8))
        self.sum_out = Signal(unsigned(8))
        self.carry_out = Signal()

        self.input_ports = {"in-a": self.in_a, "in-b": self.in_b}
        self.output_ports = {
            "sum-out": self.sum_out,
            "carry-out": self.carry_out,
        }

    def elaborate(self, platform):
        m = Module()
        # 9-bit intermediate so the carry bit isn't lost to truncation.
        wide = Signal(unsigned(9))
        m.d.comb += [
            wide.eq(self.in_a + self.in_b),
            self.sum_out.eq(wide[:8]),
            self.carry_out.eq(wide[8]),
        ]
        return m

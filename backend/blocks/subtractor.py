"""
Subtractor block — combinational 8-bit unsigned subtract with borrow-out.

Inputs:
- `in-a`, `in-b` — 8-bit unsigned operands

Outputs:
- `diff-out`   — 8-bit unsigned, the low 8 bits of `in_a - in_b`
                 (mod 256 — so 20 - 50 reads as 226)
- `borrow-out` — 1-bit, set when `in_a < in_b` (the unsigned subtract
                 underflowed and the result wrapped)

Mirrors Adder's split-output shape: the 8-bit difference flows back into
another 8-bit-input block (Register, RAM, another Adder/Subtractor)
without an external bus-truncation step, and the borrow rides its own
1-bit gate-1 line for cascading subtract chains or status flags. The
ADR-002 single-output shape is superseded by the actually-shipped Adder
pattern — same 8-bit data path, same composition story.

Implementation: purely combinational. Yosys collapses the `-` into the
same SB_CARRY chain Adder uses (the carry chain runs in subtract mode
when the second operand is inverted with carry-in high — a free
transformation in iCE40).
"""

from amaranth import Elaboratable, Module, Signal, unsigned


class Subtractor(Elaboratable):
    """Combinational 8-bit unsigned subtract with diff + borrow-out."""

    def __init__(self):
        self.in_a = Signal(unsigned(8))
        self.in_b = Signal(unsigned(8))
        self.diff_out = Signal(unsigned(8))
        self.borrow_out = Signal()

        self.input_ports = {"in-a": self.in_a, "in-b": self.in_b}
        self.output_ports = {
            "diff-out": self.diff_out,
            "borrow-out": self.borrow_out,
        }

    def elaborate(self, platform):
        m = Module()
        m.d.comb += [
            # The 8-bit difference truncates naturally — Amaranth's `-`
            # on two unsigned(8) operands produces an unsigned(9) value
            # whose low 8 bits are the mod-256 difference.
            self.diff_out.eq(self.in_a - self.in_b),
            self.borrow_out.eq(self.in_a < self.in_b),
        ]
        return m

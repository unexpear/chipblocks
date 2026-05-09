"""
XOR gate block — combinational 1-bit exclusive OR.

Inputs:  `in-1`, `in-2` — 1-bit signals
Output:  `gate-out`     — `in-1 ^ in-2`, 1-bit

Output is high exactly when the two inputs differ. Common uses:
edge-toggling against a delayed clock, building parity, or producing
half-rate dividers when chained with a register.
"""

from amaranth import Elaboratable, Module, Signal


class XorGate(Elaboratable):
    """Combinational 1-bit exclusive OR of two inputs."""

    def __init__(self):
        self.in_1 = Signal()
        self.in_2 = Signal()
        self.gate_out = Signal()

        self.input_ports = {"in-1": self.in_1, "in-2": self.in_2}
        self.output_ports = {"gate-out": self.gate_out}

    def elaborate(self, platform):
        m = Module()
        m.d.comb += self.gate_out.eq(self.in_1 ^ self.in_2)
        return m

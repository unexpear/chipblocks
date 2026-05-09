"""
OR gate block — combinational 1-bit logical OR.

Inputs:  `in-1`, `in-2` — 1-bit signals
Output:  `gate-out`     — `in-1 | in-2`, 1-bit

Useful for combining two gate sources so the output fires whenever
either one does — e.g. merge a slow regular Gate with a one-shot Gate
to drive an ADSR from either trigger.
"""

from amaranth import Elaboratable, Module, Signal


class OrGate(Elaboratable):
    """Combinational 1-bit logical OR of two inputs."""

    def __init__(self):
        self.in_1 = Signal()
        self.in_2 = Signal()
        self.gate_out = Signal()

        self.input_ports = {"in-1": self.in_1, "in-2": self.in_2}
        self.output_ports = {"gate-out": self.gate_out}

    def elaborate(self, platform):
        m = Module()
        m.d.comb += self.gate_out.eq(self.in_1 | self.in_2)
        return m

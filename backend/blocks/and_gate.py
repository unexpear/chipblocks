"""
AND gate block — combinational 1-bit logical AND.

Inputs:  `in-1`, `in-2` — 1-bit signals
Output:  `gate-out`     — `in-1 & in-2`, 1-bit

The simplest combinational primitive in the library: useful as glue logic
when building state machines, sequencers, or for combining two gate
sources into one (e.g. only fire an envelope when two clocks coincide).
"""

from amaranth import Elaboratable, Module, Signal


class AndGate(Elaboratable):
    """Combinational 1-bit logical AND of two inputs."""

    def __init__(self):
        self.in_1 = Signal()
        self.in_2 = Signal()
        self.gate_out = Signal()

        self.input_ports = {"in-1": self.in_1, "in-2": self.in_2}
        self.output_ports = {"gate-out": self.gate_out}

    def elaborate(self, platform):
        m = Module()
        m.d.comb += self.gate_out.eq(self.in_1 & self.in_2)
        return m

"""
NOT gate block — combinational 1-bit inverter.

Input:   `gate-in`  — 1-bit signal
Output:  `gate-out` — `~gate-in`, 1-bit

Inverts a gate or clock. Pair with a Gate to produce its complement
(e.g. trigger an envelope on the off-phase of a clock), or wire two
NOTs back-to-back for a one-cycle buffered copy.
"""

from amaranth import Elaboratable, Module, Signal


class NotGate(Elaboratable):
    """Combinational 1-bit logical NOT."""

    def __init__(self):
        self.gate_in = Signal()
        self.gate_out = Signal()

        self.input_ports = {"gate-in": self.gate_in}
        self.output_ports = {"gate-out": self.gate_out}

    def elaborate(self, platform):
        m = Module()
        m.d.comb += self.gate_out.eq(~self.gate_in)
        return m

"""
BusSplit block — combinational fan-out of one 8-bit bus to eight 1-bit signals.

Inputs:
- `bus-in` — 8-bit unsigned data bus

Outputs:
- `bit-0` … `bit-7` — 1-bit signals. `bit-0` is the LSB, `bit-7` is the MSB.

No parameters. v0.1 ships fixed at 8-bit width; configurable widths are
roadmap (per ADR-001 §"Future work").

Pairs with BusJoin (the inverse). Together they're the explicit escape
hatch the connection validator points users to when widths mismatch.
"""

from amaranth import Elaboratable, Module, Signal, unsigned


class BusSplit(Elaboratable):
    """Combinational 8-bit-bus → 8 × 1-bit fan-out."""

    def __init__(self):
        self.bus_in = Signal(unsigned(8))
        self.bits = [Signal(name=f"bit_{i}") for i in range(8)]

        self.input_ports = {"bus-in": self.bus_in}
        self.output_ports = {f"bit-{i}": self.bits[i] for i in range(8)}

    def elaborate(self, platform):
        m = Module()
        for i, bit in enumerate(self.bits):
            m.d.comb += bit.eq(self.bus_in[i])
        return m

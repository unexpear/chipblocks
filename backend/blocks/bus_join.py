"""
BusJoin block — combinational concat of eight 1-bit signals to one 8-bit bus.

Inputs:
- `bit-0` … `bit-7` — 1-bit signals. `bit-0` becomes the LSB of the
                      output, `bit-7` becomes the MSB. Mirrors BusSplit's
                      ordering exactly so a BusSplit → BusJoin pair is
                      identity.

Outputs:
- `bus-out` — 8-bit unsigned data bus

No parameters. v0.1 ships fixed at 8-bit width; configurable widths are
roadmap (per ADR-001 §"Future work").
"""

from amaranth import Cat, Elaboratable, Module, Signal, unsigned


class BusJoin(Elaboratable):
    """Combinational 8 × 1-bit → 8-bit-bus concat."""

    def __init__(self):
        self.bits = [Signal(name=f"bit_{i}") for i in range(8)]
        self.bus_out = Signal(unsigned(8))

        self.input_ports = {f"bit-{i}": self.bits[i] for i in range(8)}
        self.output_ports = {"bus-out": self.bus_out}

    def elaborate(self, platform):
        m = Module()
        m.d.comb += self.bus_out.eq(Cat(*self.bits))
        return m

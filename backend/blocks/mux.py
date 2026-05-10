"""
Mux block — combinational 2-to-1 multiplexer on 8-bit data.

Inputs:
- `in-a` — 8-bit unsigned data, picked when `select == 0`
- `in-b` — 8-bit unsigned data, picked when `select == 1`
- `select` — 1-bit gate / control line

Outputs:
- `data-out` — 8-bit unsigned, equal to `in-a` or `in-b` per `select`

The minimum branching primitive: pair with Comparator for "if equal,
take this value, otherwise take that value" without a state machine.
A counter that resets at a target uses Comparator(count == target) to
drive Mux.select, picking between (count + 1) and 0 — that's a
branchable program in two blocks.

Implementation: purely combinational. Amaranth's `Mux(select, b, a)`
helper compiles to a one-hot AND/OR pair; on iCE40 it lands as a
single LUT4 per output bit (8 LUT4s for an 8-bit mux).
"""

from amaranth import Elaboratable, Module, Mux as AmMux, Signal, unsigned


class Mux(Elaboratable):
    """Combinational 2-to-1 multiplexer on 8-bit unsigned data."""

    def __init__(self):
        self.in_a = Signal(unsigned(8))
        self.in_b = Signal(unsigned(8))
        self.select = Signal()
        self.data_out = Signal(unsigned(8))

        self.input_ports = {
            "in-a": self.in_a,
            "in-b": self.in_b,
            "select": self.select,
        }
        self.output_ports = {"data-out": self.data_out}

    def elaborate(self, platform):
        m = Module()
        m.d.comb += self.data_out.eq(AmMux(self.select, self.in_b, self.in_a))
        return m

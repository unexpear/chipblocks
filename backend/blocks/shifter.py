"""
Shifter block — combinational bit-shift on 8-bit unsigned data.

Inputs:
- `data-in` — 8-bit unsigned value

Output:
- `data-out` — 8-bit unsigned result of shifting `data-in` by the
               configured amount in the configured direction. Left
               shift: low N bits become 0, top N bits lost. Right
               shift (logical): top N bits become 0, low N bits lost.

Parameters:
- `direction` — "left" or "right" (default "left")
- `amount`    — shift count, 1..7 (default 1)

The shift amount is a construction-time parameter, not a runtime
input, because configurable-shift would need a 3-bit `data-u3` bus
type the project doesn't ship today and most graphs hard-wire the
amount anyway. Composes with Adder/Subtractor to build small
multiplier/divider chains (`x << 1` is `x * 2`, etc.).

Implementation: purely combinational. Yosys collapses the constant
shift into wire reorderings on iCE40 — zero LUT cost for the shift
itself.
"""

from amaranth import Elaboratable, Module, Signal, unsigned


class Shifter(Elaboratable):
    """Combinational 8-bit unsigned logical shift by a constant amount."""

    def __init__(self, direction: str = "left", amount: int = 1):
        self.direction = direction if direction in ("left", "right") else "left"
        self.amount = max(1, min(7, amount))

        self.data_in = Signal(unsigned(8))
        self.data_out = Signal(unsigned(8))

        self.input_ports = {"data-in": self.data_in}
        self.output_ports = {"data-out": self.data_out}

    def elaborate(self, platform):
        m = Module()
        if self.direction == "left":
            # Amaranth's `<<` widens the result; truncate the high N
            # bits back to 8 via slicing so the output bus is 8 bits.
            m.d.comb += self.data_out.eq((self.data_in << self.amount)[:8])
        else:
            # Logical right shift: top N bits naturally become 0 since
            # `data_in` is unsigned and Amaranth zero-extends.
            m.d.comb += self.data_out.eq(self.data_in >> self.amount)
        return m

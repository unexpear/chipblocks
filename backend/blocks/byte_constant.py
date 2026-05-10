"""
ByteConstant block — emits a fixed 8-bit unsigned value (0..255).

The CPU-domain counterpart to Constant (which emits audio-s8). Useful
as a literal in CPU graphs: a single byte hard-wired into the data
path (e.g. an Adder's in-b for "add a constant 1", or a Mux's in-a
for "if branch, write 0 to this register").

Output:
- `data-out` — `Signal(8)` (unsigned), held at the configured `value`.
"""

from amaranth import Elaboratable, Module, Signal


class ByteConstant(Elaboratable):
    """Always-emit a fixed 8-bit unsigned byte."""

    def __init__(self, value: int = 0):
        self.value = max(0, min(255, int(value)))

        self.data_out = Signal(8)

        self.input_ports: dict = {}
        self.output_ports = {"data-out": self.data_out}

    def elaborate(self, platform):
        m = Module()
        m.d.comb += self.data_out.eq(self.value)
        return m

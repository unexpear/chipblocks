"""
Register block — single 8-bit data register with gated write-enable.

Inputs:
- `data-in`       — 8-bit unsigned value to latch
- `write-enable`  — 1-bit gate; on the rising edge of the synth clock,
                    when this is high the register latches `data-in`

Output:
- `data-out` — 8-bit unsigned; whatever was last latched (zero on reset)

The store updates synchronously: hold `write-enable` high for one clock,
and on the next edge `data-out` reflects the new value. Drop the gate
low and the value stays put indefinitely. Pairs naturally with Adder for
the canonical "accumulator" pattern (Adder.sum-out → Register.data-in;
Register.data-out → Adder.in-b; pulse write-enable each cycle to add).
"""

from amaranth import Elaboratable, Module, Signal, unsigned


class Register(Elaboratable):
    """Single 8-bit register with synchronous write-enable."""

    def __init__(self):
        self.data_in = Signal(unsigned(8))
        self.write_enable = Signal()
        self.data_out = Signal(unsigned(8))

        self.input_ports = {
            "data-in": self.data_in,
            "write-enable": self.write_enable,
        }
        self.output_ports = {"data-out": self.data_out}

    def elaborate(self, platform):
        m = Module()
        stored = Signal(unsigned(8))
        with m.If(self.write_enable):
            m.d.sync += stored.eq(self.data_in)
        m.d.comb += self.data_out.eq(stored)
        return m

"""
Mixer block — combines two 8-bit signed audio signals by averaging.

Inputs:  `in-1`, `in-2` — 8-bit signed signals
Output:  `mix-out`      — 8-bit signed signal: (in_1 + in_2) / 2

Averaging keeps the result inside int8 range without clipping. (A direct
sum of two int8 values can overflow into a 9-bit result; halving makes
the operation lossless except for the bottom bit.)
"""

from amaranth import Elaboratable, Module, Signal, signed


class Mixer(Elaboratable):
    """Two-input averaging mixer for 8-bit signed audio."""

    def __init__(self):
        self.in_1 = Signal(signed(8))
        self.in_2 = Signal(signed(8))
        self.mix_out = Signal(signed(8))

        self.input_ports = {"in-1": self.in_1, "in-2": self.in_2}
        self.output_ports = {"mix-out": self.mix_out}

    def elaborate(self, platform):
        m = Module()
        # Arithmetic right shift on signed values gives signed-safe halving.
        m.d.comb += self.mix_out.eq((self.in_1 + self.in_2) >> 1)
        return m

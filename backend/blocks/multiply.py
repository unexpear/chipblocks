"""
Multiply block — combinational signed 8-bit multiply with >> 7 scale.

Useful for ring modulation (multiply two audio signals together for
metallic / inharmonic timbres) and amplitude modulation (multiply an
audio source by a control envelope to vary its loudness).

Inputs:  `in-1`, `in-2` — 8-bit signed signals
Output:  `audio-out`    — `(in-1 * in-2) >> 7`, 8-bit signed

The >> 7 keeps the result inside int8 range: full-scale ±127 × ±127 is
roughly ±16129; shifting right by 7 brings it back to ~±126.
"""

from amaranth import Elaboratable, Module, Signal, signed


class Multiply(Elaboratable):
    """Combinational signed 8-bit multiply, scaled back to int8 range."""

    def __init__(self):
        self.in_1 = Signal(signed(8))
        self.in_2 = Signal(signed(8))
        self.audio_out = Signal(signed(8))

        self.input_ports = {"in-1": self.in_1, "in-2": self.in_2}
        self.output_ports = {"audio-out": self.audio_out}

    def elaborate(self, platform):
        m = Module()
        m.d.comb += self.audio_out.eq((self.in_1 * self.in_2) >> 7)
        return m

"""
Constant block — emits a fixed 8-bit signed value.

Useful as a DC offset, ADSR test stimulus, mixer "ground" input, or
debugging probe.

Output:
- `audio-out` — `Signal(signed(8))`, held at the configured `value`.
"""

from amaranth import Elaboratable, Module, Signal, signed


class Constant(Elaboratable):
    """Always-emit a fixed 8-bit signed sample."""

    def __init__(self, value: int = 0):
        self.value = max(-128, min(127, int(value)))

        self.audio_out = Signal(signed(8))

        self.input_ports: dict = {}
        self.output_ports = {"audio-out": self.audio_out}

    def elaborate(self, platform):
        m = Module()
        m.d.comb += self.audio_out.eq(self.value)
        return m

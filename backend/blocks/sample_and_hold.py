"""
Sample-and-Hold block — captures `audio_in` on each rising edge of
`clock`, holds the sampled value at `audio_out` until the next rising
edge.

Useful for stepwise / arpeggio-style effects: feed an Oscillator's
output into `audio-in` and a Gate (or another low-rate Oscillator) into
`clock`. The output is a stair-step waveform sampling the input at the
clock rate.

Inputs:
- `audio-in` — 8-bit signed audio (the value to be sampled)
- `clock`    — 1-bit signal; rising edge triggers a new sample

Output:
- `audio-out` — 8-bit signed; the most-recently-sampled value
"""

from amaranth import Elaboratable, Module, Signal, signed


class SampleAndHold(Elaboratable):
    """Edge-triggered sample-and-hold for 8-bit signed audio."""

    def __init__(self):
        self.audio_in = Signal(signed(8))
        self.clock_in = Signal()
        self.audio_out = Signal(signed(8))

        self.input_ports = {"audio-in": self.audio_in, "clock": self.clock_in}
        self.output_ports = {"audio-out": self.audio_out}

    def elaborate(self, platform):
        m = Module()

        # Edge-detect the clock so we sample on the rising edge only,
        # not on every cycle the clock is held high.
        prev_clock = Signal()
        m.d.sync += prev_clock.eq(self.clock_in)

        with m.If(self.clock_in & ~prev_clock):
            m.d.sync += self.audio_out.eq(self.audio_in)

        return m

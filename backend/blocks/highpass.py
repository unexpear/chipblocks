"""
High-pass Filter block — 1-pole IIR high-pass over 8-bit signed audio.

Implementation: input minus a 1-pole lowpass-of-input. This is the
complement of the Lowpass block and reuses the exact same coefficient
math, so the two filters track each other and any future tuning to
Lowpass is automatically reflected here.

    lp[n] = (alpha * x[n] + (256 - alpha) * lp[n-1]) >> 8
    y[n]  = x[n] - lp[n]

`alpha` is a fixed 8-bit unsigned scalar (0..255 representing 0..1)
computed from the configured cutoff frequency at construction time:

    alpha = round(255 * (1 - exp(-2 * pi * cutoff_hz / sample_rate)))

Higher cutoff = more attenuation of low-frequency content (DC, slow
sines). Useful for removing DC offset, isolating bright content, or
chaining with a Lowpass to build a Bandpass macro.

Inputs:
- `audio-in` — 8-bit signed audio sample

Output:
- `audio-out` — 8-bit signed filtered audio sample

Parameters:
- `cutoff_hz`   — -3 dB cutoff frequency (default 800 Hz)
- `sample_rate` — project sample rate (default 44100)
"""

import math
from amaranth import Elaboratable, Module, Signal, signed


class HighPassFilter(Elaboratable):
    """1-pole IIR high-pass filter for 8-bit signed audio."""

    def __init__(self, cutoff_hz: int = 800, sample_rate: int = 44100):
        self.cutoff_hz = max(1, cutoff_hz)
        self.sample_rate = sample_rate
        # Same alpha as the Lowpass block — a 1-pole HP at cutoff `fc` is
        # x - LP(x) where LP uses the matching cutoff.
        raw_alpha = round(255 * (1 - math.exp(-2 * math.pi * self.cutoff_hz / sample_rate)))
        self.alpha = max(1, min(255, raw_alpha))

        self.audio_in = Signal(signed(8))
        self.audio_out = Signal(signed(8))

        self.input_ports = {"audio-in": self.audio_in}
        self.output_ports = {"audio-out": self.audio_out}

    def elaborate(self, platform):
        m = Module()

        alpha = self.alpha
        beta = 256 - alpha

        # Internal lowpass state — same recurrence as the Lowpass block.
        lp_state = Signal(signed(8))
        lp_next = Signal(signed(18))
        m.d.comb += lp_next.eq(alpha * self.audio_in + beta * lp_state)
        m.d.sync += lp_state.eq(lp_next >> 8)

        # y[n] = x[n] - lp[n]. Both operands fit in signed(8); their
        # difference fits in signed(9). Saturate back to signed(8) so a
        # peak-to-peak input (-128 minus +127 = -255) doesn't wrap around
        # the audio bus.
        diff = Signal(signed(9))
        m.d.comb += diff.eq(self.audio_in - (lp_next >> 8))
        with m.If(diff > 127):
            m.d.comb += self.audio_out.eq(127)
        with m.Elif(diff < -128):
            m.d.comb += self.audio_out.eq(-128)
        with m.Else():
            m.d.comb += self.audio_out.eq(diff)

        return m

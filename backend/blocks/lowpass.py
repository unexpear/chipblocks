"""
Low-pass Filter block — 1-pole IIR low-pass over 8-bit signed audio.

Filter equation:
    y[n] = (alpha * x[n] + (256 - alpha) * y[n-1]) >> 8

`alpha` is a fixed 8-bit unsigned scalar (0..255 representing 0..1) computed
from the configured cutoff frequency at construction time:

    alpha = round(255 * (1 - exp(-2 * pi * cutoff_hz / sample_rate)))

Lower cutoff = more smoothing, more group delay. Useful after a Sawtooth
or Oscillator to take the edge off the high harmonics.

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


class LowPassFilter(Elaboratable):
    """1-pole IIR low-pass filter for 8-bit signed audio."""

    def __init__(self, cutoff_hz: int = 800, sample_rate: int = 44100):
        self.cutoff_hz = max(1, cutoff_hz)
        self.sample_rate = sample_rate
        # Fixed-point alpha = 1 - exp(-2π·fc/fs), scaled to 0..255.
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

        # y_state holds y[n-1]; gets updated each cycle to the new y[n].
        y_state = Signal(signed(8))

        # y_next is the freshly-computed y[n] in this cycle. Width math:
        #   alpha * audio_in fits in 16 bits signed
        #   beta  * y_state  fits in 17 bits signed
        # Sum fits in 18 bits signed; >> 8 gives back signed(10) range, but
        # the value is bounded inside [-128, 127] because the filter is a
        # weighted average of inputs already in that range.
        y_next = Signal(signed(18))
        m.d.comb += y_next.eq(alpha * self.audio_in + beta * y_state)

        # Output is the current cycle's freshly-computed value.
        m.d.comb += self.audio_out.eq(y_next >> 8)

        # Register the new value for next cycle's recurrence.
        m.d.sync += y_state.eq(y_next >> 8)

        return m

"""
Band-pass Filter block — 1-pole IIR band-pass over 8-bit signed audio.

Implementation: a 1-pole high-pass at `low = center / sqrt(2)` feeding
a 1-pole low-pass at `high = center * sqrt(2)`. The two cutoffs frame a
fixed 1-octave bandwidth around `center_hz` — wide enough to be useful
for telephone-voice / wah / formant-style sweeps without needing a
second parameter for v0.1.

Internally this is:
    lp_low[n]  = (a_low  * x[n]      + (256 - a_low)  * lp_low[n-1])  >> 8
    hp[n]      = x[n] - lp_low[n]                  # 1-pole HP at low
    lp_high[n] = (a_high * hp[n]     + (256 - a_high) * lp_high[n-1]) >> 8
    y[n]       = lp_high[n]                        # 1-pole LP at high
                                                    # = HP-then-LP cascade

Two Lowpass primitives + one subtract — keeps the implementation
parallel to the existing Lowpass / Highpass blocks. A textbook
state-variable BP would be tighter, but this is plenty for a v0.1 that
prioritises "matches the user's mental model of HP-then-LP" over peak
DSP precision.

Inputs:
- `audio-in` — 8-bit signed audio sample

Output:
- `audio-out` — 8-bit signed filtered audio sample

Parameters:
- `center_hz`   — center frequency (default 1000 Hz). Bandwidth is
                  fixed at 1 octave (low = center / sqrt(2),
                  high = center * sqrt(2)).
- `sample_rate` — project sample rate (default 44100)
"""

import math
from amaranth import Elaboratable, Module, Signal, signed


class BandPassFilter(Elaboratable):
    """1-pole IIR band-pass filter (HP-then-LP cascade) for 8-bit signed audio."""

    def __init__(self, center_hz: int = 1000, sample_rate: int = 44100):
        self.center_hz = max(10, center_hz)
        self.sample_rate = sample_rate

        # 1-octave bandwidth: low = center / sqrt(2), high = center * sqrt(2).
        sqrt2 = math.sqrt(2.0)
        self.low_hz = max(1, int(round(self.center_hz / sqrt2)))
        # Cap the high cutoff just below Nyquist so a center near the top
        # of the audio band doesn't fold the LP coefficient out of range.
        nyquist = sample_rate // 2
        self.high_hz = max(self.low_hz + 1, min(nyquist - 1, int(round(self.center_hz * sqrt2))))

        # Two alphas — one per stage. Same formula as Lowpass.
        self.alpha_low = self._alpha_for(self.low_hz, sample_rate)
        self.alpha_high = self._alpha_for(self.high_hz, sample_rate)

        self.audio_in = Signal(signed(8))
        self.audio_out = Signal(signed(8))

        self.input_ports = {"audio-in": self.audio_in}
        self.output_ports = {"audio-out": self.audio_out}

    @staticmethod
    def _alpha_for(cutoff_hz: int, sample_rate: int) -> int:
        raw = round(255 * (1 - math.exp(-2 * math.pi * cutoff_hz / sample_rate)))
        return max(1, min(255, raw))

    def elaborate(self, platform):
        m = Module()

        a_low = self.alpha_low
        b_low = 256 - a_low
        a_high = self.alpha_high
        b_high = 256 - a_high

        # Stage 1: lowpass at low_hz — used to derive the high-pass.
        lp_low_state = Signal(signed(8))
        lp_low_next = Signal(signed(18))
        m.d.comb += lp_low_next.eq(a_low * self.audio_in + b_low * lp_low_state)
        m.d.sync += lp_low_state.eq(lp_low_next >> 8)

        # High-pass output: x - LP(x). Saturate to signed(8) to handle
        # the rare peak-to-peak case (input -128 minus lp +127 = -255).
        hp = Signal(signed(8))
        diff = Signal(signed(9))
        m.d.comb += diff.eq(self.audio_in - (lp_low_next >> 8))
        with m.If(diff > 127):
            m.d.comb += hp.eq(127)
        with m.Elif(diff < -128):
            m.d.comb += hp.eq(-128)
        with m.Else():
            m.d.comb += hp.eq(diff)

        # Stage 2: lowpass at high_hz over the high-pass output.
        lp_high_state = Signal(signed(8))
        lp_high_next = Signal(signed(18))
        m.d.comb += lp_high_next.eq(a_high * hp + b_high * lp_high_state)
        m.d.sync += lp_high_state.eq(lp_high_next >> 8)

        m.d.comb += self.audio_out.eq(lp_high_next >> 8)

        return m

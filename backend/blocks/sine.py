"""
Sine block — sine-wave signal source (8-bit signed).

Output: `audio-out` — `Signal(signed(8))`. Cleanest possible tone — pure
fundamental, no harmonics — at the configured frequency. Same 16-bit
phase-accumulator pattern as Oscillator / Triangle / Sawtooth, but the
high 8 bits of the phase index a 256-entry signed-8-bit lookup table
generated at construction time from the Python `math.sin`.

The lookup-table approach keeps the hardware cheap (no runtime trig)
while giving a clean tone at any frequency the user can ask for.
"""

import math

from amaranth import Array, Const, Elaboratable, Module, Signal, signed


class Sine(Elaboratable):
    """Sine-wave oscillator at a configurable frequency, 256-entry LUT."""

    def __init__(self, freq_hz: int = 440, sample_rate: int = 44100):
        self.freq_hz = freq_hz
        self.sample_rate = sample_rate

        self.audio_out = Signal(signed(8))

        self.input_ports: dict = {}
        self.output_ports = {"audio-out": self.audio_out}

    def elaborate(self, platform):
        m = Module()

        step = max(1, (1 << 16) * self.freq_hz // self.sample_rate)
        phase = Signal(16)
        m.d.sync += phase.eq(phase + step)

        table = [
            int(round(127 * math.sin(2 * math.pi * i / 256))) for i in range(256)
        ]
        lut = Array([Const(v, signed(8)) for v in table])

        m.d.comb += self.audio_out.eq(lut[phase[8:16]])

        return m

"""
Oscillator block — square-wave signal source (8-bit signed).

Output: `audio-out` — `Signal(signed(8))`. Alternates between +127 and
-128 at the configured frequency. Uses a 16-bit phase accumulator so
arbitrary frequencies (not just integer divisors of the sample rate)
play in tune.
"""

from amaranth import Elaboratable, Module, Signal, signed


class Oscillator(Elaboratable):
    """Square-wave oscillator at a configurable frequency."""

    def __init__(self, freq_hz: int = 440, sample_rate: int = 44100):
        self.freq_hz = freq_hz
        self.sample_rate = sample_rate

        # Output port: 8-bit signed audio sample.
        self.audio_out = Signal(signed(8))

        self.input_ports: dict = {}
        self.output_ports = {"audio-out": self.audio_out}

    def elaborate(self, platform):
        m = Module()

        # 16-bit phase accumulator. step = 2^16 * freq / sample_rate.
        # The high bit (phase[15]) toggles at the configured frequency,
        # so a 50/50 square wave drops out naturally.
        step = max(1, (1 << 16) * self.freq_hz // self.sample_rate)
        phase = Signal(16)
        m.d.sync += phase.eq(phase + step)

        with m.If(phase[15]):
            m.d.comb += self.audio_out.eq(-128)
        with m.Else():
            m.d.comb += self.audio_out.eq(127)

        return m

"""
Triangle block — triangle-wave signal source (8-bit signed).

Output: `audio-out` — `Signal(signed(8))`. Linearly ramps from -128 up to
+127 then back down, producing a triangle waveform at the configured
frequency. Mellower harmonics than a square wave; classic flute-y synth tone.

Uses the same 16-bit phase-accumulator pattern as Oscillator and
Sawtooth so all three waveform sources share a frequency-resolution
characteristic and can be driven from the same parameter (`freq_hz`).
"""

from amaranth import Elaboratable, Module, Signal, signed


class Triangle(Elaboratable):
    """Triangle-wave oscillator at a configurable frequency."""

    def __init__(self, freq_hz: int = 440, sample_rate: int = 44100):
        self.freq_hz = freq_hz
        self.sample_rate = sample_rate

        self.audio_out = Signal(signed(8))

        self.input_ports: dict = {}
        self.output_ports = {"audio-out": self.audio_out}

    def elaborate(self, platform):
        m = Module()

        # 16-bit phase accumulator (same pattern as Oscillator / Sawtooth).
        step = max(1, (1 << 16) * self.freq_hz // self.sample_rate)
        phase = Signal(16)
        m.d.sync += phase.eq(phase + step)

        # Take the high 8 bits as a 0..255 ramp through one waveform period.
        ramp = Signal(8)
        m.d.comb += ramp.eq(phase[8:16])

        # First half of the period (ramp 0..127): rise from -128 to +126.
        # Second half (ramp 128..255): fall from +127 back to -127.
        with m.If(ramp < 128):
            m.d.comb += self.audio_out.eq((ramp << 1) - 128)
        with m.Else():
            m.d.comb += self.audio_out.eq(127 - ((ramp - 128) << 1))

        return m

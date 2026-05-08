"""
Sawtooth block — sawtooth-wave signal source (8-bit signed).

Output: `audio-out` — `Signal(signed(8))`. Ramps linearly from -128 up to
+127, then snaps back to -128 at the start of each period. Brighter
harmonic content than triangle or square; classic synth-bass sound.
"""

from amaranth import Elaboratable, Module, Signal, signed


class Sawtooth(Elaboratable):
    """Sawtooth-wave oscillator at a configurable frequency."""

    def __init__(self, freq_hz: int = 440, sample_rate: int = 44100):
        self.freq_hz = freq_hz
        self.sample_rate = sample_rate

        self.audio_out = Signal(signed(8))

        self.input_ports: dict = {}
        self.output_ports = {"audio-out": self.audio_out}

    def elaborate(self, platform):
        m = Module()

        # 16-bit phase accumulator (same pattern as Oscillator / Triangle).
        step = max(1, (1 << 16) * self.freq_hz // self.sample_rate)
        phase = Signal(16)
        m.d.sync += phase.eq(phase + step)

        # High 8 bits of phase form an unsigned 0..255 sweep per period.
        # Subtract 128 to map onto signed -128..+127.
        m.d.comb += self.audio_out.eq(phase[8:16] - 128)

        return m

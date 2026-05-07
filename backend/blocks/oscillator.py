"""
Oscillator block — square-wave signal source.

Output: `audio-out` — 1-bit signal toggling at `freq_hz` when the
simulation clock runs at `sample_rate` Hz.
"""

from amaranth import Elaboratable, Module, Signal


class Oscillator(Elaboratable):
    """Square-wave oscillator at a configurable frequency."""

    def __init__(self, freq_hz: int = 440, sample_rate: int = 44100):
        self.freq_hz = freq_hz
        self.sample_rate = sample_rate

        # Output port
        self.audio_out = Signal()

        # Port maps used by the graph -> HDL translator (Sprint 2 Item 3).
        # Keys are the port-id strings used by the React Flow front-end's
        # custom node Handles (see frontend/src/blocks/OscillatorNode.tsx).
        self.input_ports: dict = {}
        self.output_ports = {"audio-out": self.audio_out}

    def elaborate(self, platform):
        m = Module()

        period = self.sample_rate // self.freq_hz
        half_period = period // 2

        # Counter wide enough to count up to (period-1).
        count = Signal(range(period))

        with m.If(count == period - 1):
            m.d.sync += count.eq(0)
        with m.Else():
            m.d.sync += count.eq(count + 1)

        m.d.sync += self.audio_out.eq(count < half_period)
        return m

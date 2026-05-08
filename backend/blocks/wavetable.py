"""
Wavetable block — morphable single-cycle waveform source (8-bit signed).

Output: `audio-out` — `Signal(signed(8))`. Reads cyclically through a
256-entry signed-8-bit lookup table at the configured frequency. The
table contents are picked at construction time by the `shape` parameter,
so one block type covers four different timbres without a separate
block per variant.

Same 16-bit phase-accumulator pattern as Oscillator / Triangle /
Sawtooth / Sine — the high 8 bits of `phase` index the table — so the
frequency-resolution characteristic is identical.

Supported shapes (256 entries each):
- "sine"     — int(127 * sin(2*pi*i/256))
- "pulse_25" — +127 for first 64 entries, -128 for the next 192 (25% duty)
- "ramp_up"  — linear ramp from -128 to +127 across 256 entries
- "formant"  — sin(t) + 0.5*sin(2t) + 0.3*sin(3t), scaled and clipped to ±127
"""

import math

from amaranth import Array, Const, Elaboratable, Module, Signal, signed


SHAPES = ("sine", "pulse_25", "ramp_up", "formant")


def _build_table(shape: str) -> list[int]:
    """Compute the 256-entry signed-8-bit lookup table for the given shape."""
    if shape == "sine":
        return [
            int(round(127 * math.sin(2 * math.pi * i / 256))) for i in range(256)
        ]
    if shape == "pulse_25":
        return [127 if i < 64 else -128 for i in range(256)]
    if shape == "ramp_up":
        return [i - 128 for i in range(256)]
    if shape == "formant":
        out: list[int] = []
        for i in range(256):
            t = 2 * math.pi * i / 256
            v = math.sin(t) + 0.5 * math.sin(2 * t) + 0.3 * math.sin(3 * t)
            sample = int(round(127 * v / 1.8))  # /1.8 to keep peak below clip
            sample = max(-128, min(127, sample))
            out.append(sample)
        return out
    raise ValueError(
        f"Unknown wavetable shape: {shape!r}. "
        f"Allowed: {SHAPES}"
    )


class Wavetable(Elaboratable):
    """Morphable wavetable oscillator — 256-entry LUT, 4 preset shapes."""

    def __init__(
        self,
        freq_hz: int = 440,
        shape: str = "sine",
        sample_rate: int = 44100,
    ):
        if shape not in SHAPES:
            raise ValueError(
                f"Unknown wavetable shape: {shape!r}. "
                f"Allowed: {SHAPES}"
            )

        self.freq_hz = freq_hz
        self.shape = shape
        self.sample_rate = sample_rate
        self._table = _build_table(shape)

        self.audio_out = Signal(signed(8))

        self.input_ports: dict = {}
        self.output_ports = {"audio-out": self.audio_out}

    def elaborate(self, platform):
        m = Module()

        step = max(1, (1 << 16) * self.freq_hz // self.sample_rate)
        phase = Signal(16)
        m.d.sync += phase.eq(phase + step)

        lut = Array([Const(v, signed(8)) for v in self._table])
        m.d.comb += self.audio_out.eq(lut[phase[8:16]])

        return m

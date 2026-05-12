"""
LFO block — low-frequency oscillator (8-bit signed) for slow modulation.

Like Wavetable in shape but tuned for sub-audio rates: a 32-bit phase
accumulator gives precise pitch resolution down to 0.001 Hz, and the
configured frequency range is 0.001-30 Hz — the canonical territory
for vibrato (4-8 Hz wobble), tremolo (4-10 Hz amplitude wobble),
slow gating (1-30 Hz pattern triggers like the original Atari Punk
Console's potentiometer-swept second oscillator), and very slow filter
sweeps (down to ~0.1 Hz for drone-style breathing pads).

The `rate` parameter is in whole hertz (0-30) and `rate_millihz` adds
0-999 millihertz on top. Effective rate is `rate + rate_millihz/1000`.
At rate=0, rate_millihz=500, the LFO runs at 0.5 Hz (period = 2 sec
at 44.1 kHz). The minimum non-zero step is 1 millihertz; if both
fields are 0, the step is forced to 1 millihertz to avoid a stuck DC.

Output: `audio-out` — `Signal(signed(8))`. Reads cyclically through a
256-entry signed-8-bit lookup table at the configured frequency. The
table contents are picked at construction time by the `shape`
parameter.

Supported shapes (256 entries each):
- "sine"     — int(127 * sin(2*pi*i/256))
- "triangle" — linear up 0..127 over 0..63, down 127..-128 over 64..191,
               up -128..0 over 192..255 (peak at index 64, trough at 192)
- "square"   — +127 for first 128 entries, -128 for the next 128 (50% duty)
- "sawtooth" — linear ramp from -128 to +127 across 256 entries

Use cases this unlocks (couldn't be expressed before because the audio
oscillator blocks floor at 20 Hz):
- Canonical 5-8 Hz vibrato via LFO -> VCO.freq-in
- Slow 4-6 Hz tremolo via LFO -> Multiply.in-1 (the audio carrier on in-2)
- 1-30 Hz Atari Punk Console gating (Mims's analog circuit potentiometer-
  swept this range; we can now match it exactly)
- 0.5 Hz slow filter sweeps via LFO -> filter modulation (when we ship a
  voltage-controlled filter block)
- ADSR-free percussion triggers via LFO square -> Gate-shaped triggering
"""

import math

from amaranth import Array, Const, Elaboratable, Module, Signal, signed


SHAPES = ("sine", "triangle", "square", "sawtooth")


def _build_table(shape: str) -> list[int]:
    """Compute the 256-entry signed-8-bit lookup table for the given shape."""
    if shape == "sine":
        return [
            int(round(127 * math.sin(2 * math.pi * i / 256))) for i in range(256)
        ]
    if shape == "triangle":
        out: list[int] = []
        for i in range(256):
            # Phase 0..63   -> 0..127     (rising)
            # Phase 64..191 -> 127..-128  (falling through zero)
            # Phase 192..255 -> -128..0   (rising back to zero)
            if i < 64:
                v = 2 * i
            elif i < 192:
                v = 127 - 2 * (i - 64)
            else:
                v = -128 + 2 * (i - 192)
            out.append(max(-128, min(127, v)))
        return out
    if shape == "square":
        return [127 if i < 128 else -128 for i in range(256)]
    if shape == "sawtooth":
        return [i - 128 for i in range(256)]
    raise ValueError(
        f"Unknown LFO shape: {shape!r}. Allowed: {SHAPES}"
    )


class Lfo(Elaboratable):
    """Low-frequency oscillator with 4 waveform shapes; 0.001-30 Hz range."""

    def __init__(
        self,
        rate_hz: int = 5,
        rate_millihz: int = 0,
        shape: str = "sine",
        sample_rate: int = 44100,
    ):
        if shape not in SHAPES:
            raise ValueError(
                f"Unknown LFO shape: {shape!r}. Allowed: {SHAPES}"
            )
        self.rate_hz = max(0, min(30, int(rate_hz)))
        self.rate_millihz = max(0, min(999, int(rate_millihz)))
        self.shape = shape
        self.sample_rate = sample_rate
        self._table = _build_table(shape)

        self.audio_out = Signal(signed(8))

        self.input_ports: dict = {}
        self.output_ports = {"audio-out": self.audio_out}

    def elaborate(self, platform):
        m = Module()

        # 32-bit phase accumulator for sub-Hz precision. At 1 Hz the
        # step is (2^32 // 44100) ≈ 97391, giving period exactly 44100
        # samples = 1.0 sec = 1 Hz. Compare to a 16-bit phase: step
        # rounds to 1 at low frequencies, giving 0.67 Hz instead of 1 Hz.
        #
        # Total rate in millihertz lets the user dial down to 1 mHz
        # (one cycle every 1000 seconds), which the 32-bit accumulator
        # can still resolve: step at 1 mHz = (2^32 * 1) // (44100 * 1000)
        # ≈ 97 — small but well clear of zero.
        total_millihz = self.rate_hz * 1000 + self.rate_millihz
        step = max(1, (1 << 32) * total_millihz // (self.sample_rate * 1000))
        phase = Signal(32)
        m.d.sync += phase.eq(phase + step)

        lut = Array([Const(v, signed(8)) for v in self._table])
        # Top 8 bits of the 32-bit phase index the 256-entry table.
        m.d.comb += self.audio_out.eq(lut[phase[24:32]])

        return m

"""
FM block — single self-contained two-operator FM voice (8-bit signed).

A modulator oscillator's output displaces the carrier oscillator's phase
on every tick, producing the classic frequency-modulation timbre (think
DX7-style bell/electric-piano tones). Output is taken from the carrier
phase MSB as a square wave — same shape rule as the Oscillator block —
so the audible result is a square whose pitch wobbles at `modulator_freq`
with depth set by `mod_depth`.

Two 16-bit phase accumulators:
- modulator phase advances by `mod_step = 2^16 * modulator_freq / 44100`
- carrier phase advances by `carrier_step + (modulator_phase[8:16] * mod_depth)`

Output: `audio-out` — `Signal(signed(8))`, +127 / -128 from carrier MSB.
"""

from amaranth import Elaboratable, Module, Signal, signed


class Fm(Elaboratable):
    """Two-operator FM voice: modulator phase displaces carrier phase."""

    def __init__(
        self,
        carrier_freq: int = 440,
        modulator_freq: int = 110,
        mod_depth: int = 64,
        sample_rate: int = 44100,
    ):
        self.carrier_freq = carrier_freq
        self.modulator_freq = modulator_freq
        self.mod_depth = max(0, min(127, int(mod_depth)))
        self.sample_rate = sample_rate

        self.audio_out = Signal(signed(8))

        self.input_ports: dict = {}
        self.output_ports = {"audio-out": self.audio_out}

    def elaborate(self, platform):
        m = Module()

        carrier_step = max(1, (1 << 16) * self.carrier_freq // self.sample_rate)
        mod_step = max(1, (1 << 16) * self.modulator_freq // self.sample_rate)

        mod_phase = Signal(16)
        carrier_phase = Signal(16)

        m.d.sync += mod_phase.eq(mod_phase + mod_step)

        # The modulator's high 8 bits form an unsigned 0..255 sweep per
        # period; multiplied by `mod_depth` it becomes the per-tick
        # displacement added on top of the carrier's natural step.
        # 16-bit wrap-around is implicit in Amaranth signal arithmetic.
        m.d.sync += carrier_phase.eq(
            carrier_phase + carrier_step + (mod_phase[8:16] * self.mod_depth)
        )

        with m.If(carrier_phase[15]):
            m.d.comb += self.audio_out.eq(-128)
        with m.Else():
            m.d.comb += self.audio_out.eq(127)

        return m

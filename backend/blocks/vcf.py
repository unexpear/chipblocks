"""
VCF block — voltage-controlled low-pass filter (1-pole IIR, 8-bit signed).

A low-pass filter whose cutoff frequency is modulated by an
audio-rate input signal, the way VCO has its pitch modulated by
freq-in. Same 1-pole-IIR shape as the static `lowpass` block; the
difference is the cutoff is dynamic per sample rather than fixed
at construction time.

Inputs:
- `audio-in`  — 8-bit signed audio sample to filter
- `cutoff-in` — 8-bit signed audio sample driving the cutoff sweep.
                0 = base cutoff; ±128 full-scale shifts cutoff by
                ±range_hz Hz.

Output:
- `audio-out` — 8-bit signed filtered audio sample

Parameters:
- `base_cutoff_hz` — centre cutoff when cutoff-in is silent, 1..22050 Hz (default 1000)
- `range_hz`       — full-scale ±128 cutoff sweep, 1..10000 Hz (default 2000)

Implementation: a precomputed 256-entry lookup table maps every
possible `cutoff_in` value (signed-8 has 256 distinct values) to
its filter coefficient `alpha` (0..255 fixed-point representation
of the 0..1 IIR smoothing factor). At runtime, `cutoff_in` indexes
the table to pick the per-sample alpha, then the same recurrence
as the static lowpass block runs:

    alpha[k] = round(255 * (1 - exp(-2π · cutoff(k) / fs)))
    y[n]     = (alpha * x[n] + (256 - alpha) * y[n-1]) >> 8

where `cutoff(k) = base_cutoff_hz + (cutoff_in_value × range_hz / 128)`.

Use cases this unlocks (couldn't be expressed with the static
`lowpass` block):
- Drone-music filter sweeps (slow LFO -> VCF.cutoff-in)
- Wow / synth-pluck "whoo" attacks (envelope-shaped Constant -> VCF.cutoff-in)
- Talk-box / vowel-shape effects (audio-rate modulator -> VCF.cutoff-in)
- Self-resonant filter screams (positive-feedback patches)

This block is the LOW-PASS variant. High-pass and band-pass VCF
variants are future work — they'd be three additional blocks
(vchighpass, vcbandpass) following the same lookup-table pattern.
"""

import math

from amaranth import Array, Const, Elaboratable, Module, Signal, signed, unsigned


class Vcf(Elaboratable):
    """Voltage-controlled 1-pole low-pass filter for 8-bit signed audio."""

    def __init__(
        self,
        base_cutoff_hz: int = 1000,
        range_hz: int = 2000,
        sample_rate: int = 44100,
    ):
        self.base_cutoff_hz = max(1, min(22050, int(base_cutoff_hz)))
        self.range_hz = max(1, min(10000, int(range_hz)))
        self.sample_rate = sample_rate

        # Precompute the 256-entry alpha lookup table. Indexed by the
        # signed-to-unsigned remapped cutoff_in (offset-binary
        # representation): address 0 corresponds to cutoff_in=-128, 128
        # to cutoff_in=0, 255 to cutoff_in=+127.
        self._alpha_table = []
        nyquist = sample_rate // 2 - 1
        for addr in range(256):
            cutoff_in_value = addr - 128  # map 0..255 -> -128..+127
            cutoff_now = self.base_cutoff_hz + (cutoff_in_value * self.range_hz) // 128
            # Clamp to avoid math.exp blowing up; the IIR is only stable
            # for cutoffs between 0 and the Nyquist rate.
            cutoff_now = max(1, min(nyquist, cutoff_now))
            raw_alpha = round(
                255 * (1 - math.exp(-2 * math.pi * cutoff_now / sample_rate))
            )
            alpha = max(1, min(255, raw_alpha))
            self._alpha_table.append(alpha)

        self.audio_in = Signal(signed(8))
        self.cutoff_in = Signal(signed(8))
        self.audio_out = Signal(signed(8))

        self.input_ports = {"audio-in": self.audio_in, "cutoff-in": self.cutoff_in}
        self.output_ports = {"audio-out": self.audio_out}

    def elaborate(self, platform):
        m = Module()

        # Remap signed cutoff_in (-128..+127) to unsigned offset-binary
        # address (0..255) by flipping the sign bit. Two's-complement
        # representation makes this a single-bit XOR.
        cutoff_addr = Signal(unsigned(8))
        m.d.comb += cutoff_addr.eq(self.cutoff_in.as_unsigned() ^ 0x80)

        # Table lookup: precomputed alpha per cutoff bin.
        alpha_lut = Array([Const(v, unsigned(8)) for v in self._alpha_table])
        alpha = Signal(unsigned(8))
        m.d.comb += alpha.eq(alpha_lut[cutoff_addr])

        # beta = 256 - alpha. At our clamp (alpha in [1, 255]) beta is
        # in [1, 255], fits in 8 bits unsigned.
        beta = Signal(unsigned(9))
        m.d.comb += beta.eq(256 - alpha)

        # Filter recurrence — same shape as the static lowpass block.
        # alpha and beta are unsigned; audio_in and y_state are signed.
        # Amaranth's mixed signed-unsigned multiply produces a signed
        # result of width sum-of-widths. Result fits in signed(18).
        y_state = Signal(signed(8))
        y_next = Signal(signed(18))
        m.d.comb += y_next.eq(alpha * self.audio_in + beta * y_state)

        m.d.comb += self.audio_out.eq(y_next >> 8)
        m.d.sync += y_state.eq(y_next >> 8)

        return m

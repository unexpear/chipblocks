"""
Noise block — pseudo-random 8-bit signed audio source.

Useful for snare drums, percussion textures, and noise modulation.

Implementation: a 16-bit Galois LFSR with taps at bits 15, 13, 12, 10
(maximal-length polynomial x^16 + x^14 + x^13 + x^11 + 1, ticked once
per sync cycle). The high 8 bits of the LFSR — re-interpreted as signed
— become `audio-out`, giving the full ±127 swing.

Output:
- `audio-out` — `Signal(signed(8))`. New pseudo-random sample each tick.
"""

from amaranth import Elaboratable, Module, Signal, signed


class Noise(Elaboratable):
    """16-bit Galois LFSR; high 8 bits become 8-bit signed audio."""

    def __init__(self):
        self.audio_out = Signal(signed(8))

        self.input_ports: dict = {}
        self.output_ports = {"audio-out": self.audio_out}

    def elaborate(self, platform):
        m = Module()

        # Seed must be nonzero — an all-zero LFSR is a fixed point.
        lfsr = Signal(16, init=1)

        # Galois LFSR: shift right; if the bit shifted out (lfsr[0]) was 1,
        # XOR a tap mask into the new state. Taps at bits 15, 13, 12, 10
        # form a maximal-length sequence (period 65535).
        feedback = lfsr[0]
        taps = (1 << 15) | (1 << 13) | (1 << 12) | (1 << 10)
        with m.If(feedback):
            m.d.sync += lfsr.eq((lfsr >> 1) ^ taps)
        with m.Else():
            m.d.sync += lfsr.eq(lfsr >> 1)

        m.d.comb += self.audio_out.eq(lfsr[8:16].as_signed())

        return m

"""
Bitcrusher block — reduces an 8-bit signed audio signal to N effective
bits by zeroing the lower (8 - N) bits.

Classic lo-fi / retro effect: at bits=8 it's pass-through; at bits=4-6
it's gentle bit reduction; at bits=2-3 it's heavy crunch; at bits=1
it's a 1-bit comparator (square wave) regardless of input shape, since
only the sign bit survives.

Inputs:
- `audio-in`  — 8-bit signed audio sample

Output:
- `audio-out` — 8-bit signed audio sample with the lower (8 - bits) bits
                cleared

Parameters:
- `bits` — effective output bit depth, 1..8 (default 4)

The mask `(-1 << (8 - bits)) & 0xFF` is precomputed at construction time
and AND-ed combinationally with the input. Amaranth treats the result as
signed because the destination signal is `signed(8)`, so negative
samples are quantized symmetrically (e.g. bits=1 maps the input to
{-128, 0} — the high half of the int8 range).
"""

from amaranth import Const, Elaboratable, Module, Signal, signed


class Bitcrusher(Elaboratable):
    """Combinational bit-depth reduction for 8-bit signed audio."""

    def __init__(self, bits: int = 4):
        self.bits = max(1, min(8, bits))
        # Mask keeps the top `bits` bits; lower bits become zero.
        # Example: bits=4 -> 0xF0; bits=1 -> 0x80; bits=8 -> 0xFF.
        self.mask = (-1 << (8 - self.bits)) & 0xFF

        self.audio_in = Signal(signed(8))
        self.audio_out = Signal(signed(8))

        self.input_ports = {"audio-in": self.audio_in}
        self.output_ports = {"audio-out": self.audio_out}

    def elaborate(self, platform):
        m = Module()
        m.d.comb += self.audio_out.eq(self.audio_in & Const(self.mask, 8))
        return m

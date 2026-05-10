"""
Reinterpret block — pure no-op bridge from `data-u8` to `audio-s8`.

Inputs:
- `data-in` — 8-bit unsigned data (`data-u8`)

Outputs:
- `audio-out` — 8-bit signed audio sample (`audio-s8`)

The two are the same 8 bits on the wire; the only thing that changes is the
sign interpretation. ADR-001's typed-bus validator correctly rejects an
implicit cross between sign classes — a `data-u8` value of 200 means
"200 unsigned" and an `audio-s8` value of 200 doesn't exist (the signed
range is -128..+127, so 200's bit pattern reads as -56). This block is the
explicit "yes, I want that bit-level reinterpretation" escape hatch, the
counterpart to BusSplit / BusJoin for cross-width composition.

Sprint 17 retro called this out as the missing primitive for graphs that
want a CPU-domain accumulator (which produces `data-u8`) to drive an audio
Output (which expects `audio-s8`). Without it the two domains stay
siloed; with it the accumulator's running sum becomes a sound — the LSBs
of the sum vary per cycle, so the reinterpreted audio carries the
accumulator's motion as crackle / rhythmic noise.

Implementation: purely combinational. Amaranth's `Signal.as_signed()`
casts the unsigned value to a signed view of the same bits without
inserting any logic — Yosys collapses the connection to a wire.
"""

from amaranth import Elaboratable, Module, Signal, signed, unsigned


class Reinterpret(Elaboratable):
    """No-op bridge — same 8 bits, unsigned in, signed out."""

    def __init__(self):
        self.data_in = Signal(unsigned(8))
        self.audio_out = Signal(signed(8))

        self.input_ports = {"data-in": self.data_in}
        self.output_ports = {"audio-out": self.audio_out}

    def elaborate(self, platform):
        m = Module()
        m.d.comb += self.audio_out.eq(self.data_in.as_signed())
        return m

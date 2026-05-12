"""
Audio Sum block — saturating sum of two 8-bit signed audio signals.

Inputs:  `in-1`, `in-2` — 8-bit signed signals
Output:  `audio-out`    — 8-bit signed signal: clamp(in_1 + in_2, -128, +127)

Behaves like Mixer except the result is NOT halved. Two full-scale
inputs combine to a full-scale output (clamped at the int8 rails)
rather than averaging to half-scale. Use this when you need each
input to contribute its full amplitude — typically in feedback
loops where Mixer's /2 halving would decay the loop too fast.

The canonical use case is Karplus-Strong plucked-string synthesis:

    excitation → audiosum.in-1 → delay → lowpass → multiply (×k) → audiosum.in-2
                       │
                       └────────────────────────────────────────► output

With Mixer in the loop, every cycle halves the loop amplitude (mix
of new excitation and feedback decays at 0.5× per cycle, so the
string rings for ~60 ms). With Audio Sum, the per-cycle loop gain
is set by the feedback multiplier alone — typically a Constant of
~120-127 giving 0.94-0.99 per loop, so the string rings for
hundreds of milliseconds (the canonical guitar-like decay).

If both inputs saturate the rails simultaneously, the output
clamps at ±127. That's a small artefact for typical audio content
but worth knowing for hard-clipped sources.

Implementation: pure combinational. The 9-bit intermediate is the
exact sum; the saturate-to-int8 step is two compares plus a 3-way
mux. On iCE40 this maps to ~12 LCs.
"""

from amaranth import Elaboratable, Module, Signal, signed


class AudioSum(Elaboratable):
    """Two-input saturating audio summer (a+b clamped to ±127)."""

    def __init__(self):
        self.in_1 = Signal(signed(8))
        self.in_2 = Signal(signed(8))
        self.audio_out = Signal(signed(8))

        self.input_ports = {"in-1": self.in_1, "in-2": self.in_2}
        self.output_ports = {"audio-out": self.audio_out}

    def elaborate(self, platform):
        m = Module()
        # Wide intermediate so the int8 + int8 sum doesn't overflow
        # (range becomes -256..254, which needs 9 bits signed).
        wide = Signal(signed(10))
        m.d.comb += wide.eq(self.in_1 + self.in_2)

        with m.If(wide > 127):
            m.d.comb += self.audio_out.eq(127)
        with m.Elif(wide < -128):
            m.d.comb += self.audio_out.eq(-128)
        with m.Else():
            m.d.comb += self.audio_out.eq(wide)

        return m

"""
Distortion block — hard-clipping waveshaper for 8-bit signed audio.

Classic guitar / synth-overdrive sound: anything past ±threshold gets
flattened to the rail, then the result is scaled back up so the output
amplitude stays loud — that's what gives overdrive its characteristic
"all the way to the rails" energy. With small `threshold` values the
output is essentially a 1-bit square; mid-range values give the buzzy
guitar-amp tone.

Inputs:
- `audio-in`  — 8-bit signed audio sample

Output:
- `audio-out` — 8-bit signed audio sample, hard-clipped at ±threshold
                and rescaled to fill the ±127 range

Parameters:
- `threshold` — clip point, 1..127 (default 32). At 127 the block is
                effectively pass-through (no clipping happens until the
                input hits ±127); below that, smaller values mean more
                aggressive overdrive.

Implementation: combinational. We saturate the input to ±threshold,
then multiply by 127 and divide by `threshold` so the result fills the
signed-8-bit range. Both operations are trivial for Yosys; the divide
becomes a constant-divide that nextpnr collapses into shifts and adds.
"""

from amaranth import Const, Elaboratable, Module, Signal, signed


class Distortion(Elaboratable):
    """Combinational hard-clip + makeup-gain waveshaper."""

    def __init__(self, threshold: int = 32):
        self.threshold = max(1, min(127, int(threshold)))

        self.audio_in = Signal(signed(8))
        self.audio_out = Signal(signed(8))

        self.input_ports = {"audio-in": self.audio_in}
        self.output_ports = {"audio-out": self.audio_out}

    def elaborate(self, platform):
        m = Module()

        thr = Const(self.threshold, signed(8))
        neg_thr = Const(-self.threshold, signed(8))

        # Saturate to [-threshold, +threshold]. The intermediate result
        # is a wider signed signal so the comparison + select works at
        # full int8 range without wrap-around.
        clipped = Signal(signed(9))
        with m.If(self.audio_in > thr):
            m.d.comb += clipped.eq(thr)
        with m.Elif(self.audio_in < neg_thr):
            m.d.comb += clipped.eq(neg_thr)
        with m.Else():
            m.d.comb += clipped.eq(self.audio_in)

        # Makeup gain: scale clipped × 127 / threshold so the output
        # spans the full ±127 range. The multiply-then-divide-by-const
        # synthesises into a small fixed-coefficient multiplier on iCE40.
        m.d.comb += self.audio_out.eq((clipped * 127) // self.threshold)

        return m

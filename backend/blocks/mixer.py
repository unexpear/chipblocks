"""
Mixer block — combines two 1-bit audio signals via XOR.

XOR-ing two square waves doesn't sum them in a linear-audio sense, but
it produces audibly interesting harmonic content (ring-modulator-ish).
For the Sprint 2 demo this is enough; a future Mixer variant can do
proper signed-sum mixing once block widths are wider than 1 bit.

Inputs:  `in-1`, `in-2` — 1-bit signals
Output:  `mix-out`      — 1-bit signal (in_1 XOR in_2)
"""

from amaranth import Elaboratable, Module, Signal


class Mixer(Elaboratable):
    """Two-input XOR mixer for 1-bit audio."""

    def __init__(self):
        # Input ports
        self.in_1 = Signal()
        self.in_2 = Signal()
        # Output port
        self.mix_out = Signal()

        # Port maps for the translator (must match React Flow handle ids
        # in frontend/src/blocks/MixerNode.tsx).
        self.input_ports = {"in-1": self.in_1, "in-2": self.in_2}
        self.output_ports = {"mix-out": self.mix_out}

    def elaborate(self, platform):
        m = Module()
        m.d.comb += self.mix_out.eq(self.in_1 ^ self.in_2)
        return m

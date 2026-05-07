"""
Output block — audio sink. Has one input port `audio-in`.

The Output block has no internal logic — it's effectively a marker
that says "sample THIS signal in the testbench to produce the WAV
file." The graph -> HDL translator and the simulation harness work
together to find the Output node and capture its `audio_in` per cycle.

Input: `audio-in` — 1-bit signal that will be sampled to produce audio
"""

from amaranth import Elaboratable, Module, Signal


class Output(Elaboratable):
    """Audio sink. The simulation harness samples `audio_in` to produce a WAV."""

    def __init__(self):
        # Input port
        self.audio_in = Signal()

        # Port maps for the translator (must match React Flow handle id
        # in frontend/src/blocks/OutputNode.tsx).
        self.input_ports = {"audio-in": self.audio_in}
        self.output_ports: dict = {}

    def elaborate(self, platform):
        # Output is a passthrough; the audio_in signal is wired to a
        # source by the parent module (the translator does this), and
        # the testbench samples self.audio_in directly each cycle.
        m = Module()
        return m

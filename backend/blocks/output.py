"""
Output block — audio sink for 8-bit signed samples.

Input: `audio-in` — `Signal(signed(8))`. The simulation harness samples
this signal each tick to produce the WAV file.

The Output block has no internal logic — it's a marker that says
"capture THIS signal as the audio output."
"""

from amaranth import Elaboratable, Module, Signal, signed


class Output(Elaboratable):
    """Audio sink. The simulation harness samples `audio_in` to produce a WAV."""

    def __init__(self):
        self.audio_in = Signal(signed(8))
        self.input_ports = {"audio-in": self.audio_in}
        self.output_ports: dict = {}

    def elaborate(self, platform):
        # Output is a passthrough; audio_in is wired by the parent module
        # (the translator does this), and the testbench samples it directly.
        m = Module()
        return m

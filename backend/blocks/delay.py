"""
Delay block — fixed-length delay line for 8-bit signed audio.

Outputs the input shifted forward in time by `delay_samples` audio-rate
samples. At 44100 Hz, 128 samples ≈ 2.9 ms (slap-back), 1024 ≈ 23 ms.

Useful for chorus (~50 samples), flange / slap-back (~500 samples), or
as a building block for echo (loop the output back through a Multiply
by 0.5 then a Mixer with the original).

Inputs:
- `audio-in`  — 8-bit signed audio sample

Output:
- `audio-out` — 8-bit signed audio sample, delayed by `delay_samples`
                cycles. Output is silent for the first `delay_samples`
                cycles after reset (the buffer is zero-initialized).

Parameters:
- `delay_samples` — delay length in audio-rate samples, 1..1024
                    (default 128)

Implementation: a single circular buffer using `amaranth.lib.memory.Memory`
(BRAM-backed on iCE40). One pointer walks the buffer; on each cycle we
read the value `delay_samples` cycles old via an asynchronous read port,
then synchronously overwrite that slot with the current input. 1024
8-bit entries fit easily in a single iCE40 4 KB BRAM.
"""

from amaranth import Elaboratable, Module, Signal, signed
from amaranth.lib.memory import Memory


class Delay(Elaboratable):
    """Fixed-length delay line over 8-bit signed audio."""

    def __init__(self, delay_samples: int = 128):
        self.delay_samples = max(1, min(1024, delay_samples))

        self.audio_in = Signal(signed(8))
        self.audio_out = Signal(signed(8))

        self.input_ports = {"audio-in": self.audio_in}
        self.output_ports = {"audio-out": self.audio_out}

    def elaborate(self, platform):
        m = Module()

        depth = self.delay_samples
        m.submodules.mem = mem = Memory(
            shape=signed(8),
            depth=depth,
            init=[0] * depth,
        )
        wp = mem.write_port()
        rp = mem.read_port(domain="comb")

        # Single pointer walks the buffer cyclically. Address-width is
        # range(depth) which Amaranth sizes to ceil_log2(depth) bits;
        # at depth=1 that's a 0-bit signal which still works.
        # When depth > 1 we increment; when depth == 1 the pointer is
        # always 0 and we get a 1-cycle delay (the read happens before
        # the synchronous write commits).
        ptr = Signal(range(max(2, depth)))
        if depth > 1:
            with m.If(ptr == depth - 1):
                m.d.sync += ptr.eq(0)
            with m.Else():
                m.d.sync += ptr.eq(ptr + 1)

        m.d.comb += [
            rp.addr.eq(ptr),
            self.audio_out.eq(rp.data),
            wp.addr.eq(ptr),
            wp.data.eq(self.audio_in),
            wp.en.eq(1),
        ]

        return m

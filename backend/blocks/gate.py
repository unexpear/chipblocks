"""
Gate block — 1-bit periodic gate signal.

Output:
- `gate-out` — 1-bit signal that pulses HIGH for a configurable fraction of
  each period. Used to trigger ADSR envelopes (or anything else that wants
  a recurring trigger). Slow gate rates (1–20 Hz) drive musically-meaningful
  attack-decay-release cycles when wired to an ADSR's `gate` input.

Parameters:
- `rate_hz`     — pulses per second (default 4)
- `duty_pct`    — duty cycle as a percentage 1..99 (default 50)
- `sample_rate` — project sample rate (default 44100)
"""

from amaranth import Elaboratable, Module, Signal


class Gate(Elaboratable):
    """1-bit periodic gate generator for triggering envelopes."""

    def __init__(self, rate_hz: int = 4, duty_pct: int = 50, sample_rate: int = 44100):
        self.rate_hz = max(1, rate_hz)
        self.duty_pct = max(1, min(99, duty_pct))
        self.sample_rate = sample_rate

        self.gate_out = Signal()
        self.input_ports: dict = {}
        self.output_ports = {"gate-out": self.gate_out}

    def elaborate(self, platform):
        m = Module()
        period = max(2, self.sample_rate // self.rate_hz)
        threshold = max(1, period * self.duty_pct // 100)

        count = Signal(range(period))
        with m.If(count == period - 1):
            m.d.sync += count.eq(0)
        with m.Else():
            m.d.sync += count.eq(count + 1)

        m.d.comb += self.gate_out.eq(count < threshold)
        return m

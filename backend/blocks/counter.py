"""
Counter block — wrapping integer counter clocked by a 1-bit signal.

On each rising edge of `clock` the internal counter increments. When
the counter reaches `max_value` it wraps back to 0 on the next edge.
Two outputs:

- `audio-out` exposes the count as an 8-bit signed sample (`count - 64`)
  so the same block can drive audio-domain targets (centred around zero,
  same offset-by-half pattern used in `sawtooth.py`).
- `addr-out` exposes the raw count's low 4 bits as `addr-u4`. Lets the
  Counter drive RAM/ROM addresses directly without a bus-conversion
  chain (the ADR-002 "Counter is the program counter" pattern).

Inputs:
- `clock` — 1-bit signal; rising edge increments the counter

Outputs:
- `audio-out` — `Signal(signed(8))`, the count minus 64
- `addr-out`  — `Signal(unsigned(4))`, the count's low 4 bits

Parameter:
- `max_value` — wrap point (1..127, default 16). The count cycles
  through 0, 1, ..., max_value-1, then resets to 0.
"""

from amaranth import Elaboratable, Module, Signal, signed, unsigned


class Counter(Elaboratable):
    """Edge-triggered wrapping counter with audio-centred + raw-address outputs."""

    def __init__(self, max_value: int = 16):
        self.max_value = max(1, min(127, int(max_value)))

        self.clock_in = Signal()
        self.audio_out = Signal(signed(8))
        self.addr_out = Signal(unsigned(4))

        self.input_ports = {"clock": self.clock_in}
        self.output_ports = {
            "audio-out": self.audio_out,
            "addr-out": self.addr_out,
        }

    def elaborate(self, platform):
        m = Module()

        # Edge-detect the clock so we increment on the rising edge only,
        # not every cycle the clock is held high (same pattern as the
        # sample-and-hold block).
        prev_clock = Signal()
        m.d.sync += prev_clock.eq(self.clock_in)

        count = Signal(range(self.max_value + 1))

        with m.If(self.clock_in & ~prev_clock):
            with m.If(count == self.max_value - 1):
                m.d.sync += count.eq(0)
            with m.Else():
                m.d.sync += count.eq(count + 1)

        # Centre the unsigned count around zero for the signed-8-bit bus.
        m.d.comb += self.audio_out.eq(count - 64)
        # Low 4 bits as a raw unsigned address — feeds ROM/RAM directly.
        m.d.comb += self.addr_out.eq(count[:4])

        return m

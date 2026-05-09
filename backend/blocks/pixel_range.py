"""
Pixel Range block — 1-bit "is the pixel coordinate inside [start, end]?".

The foundation for drawing rectangles, vertical / horizontal stripes,
and frames on a VGA monitor. Wire `VGA Timing.x` into `pixel` to test
the column; wire `VGA Timing.y` to test the row. AND two PixelRange
instances together (one for x, one for y) to draw a rectangle.

Inputs:
- `pixel` — 10-bit unsigned, the x or y coordinate from VGA Timing

Outputs:
- `inside` — 1-bit, high when start <= pixel <= end

Parameters:
- `start` — lower bound (0..639, default 100)
- `end`   — upper bound (0..639, default 200)

The bound parameters cover the full 0..639 range so the same block
works for both x and y on the canonical 640x480 raster. Note that
v0.1's iCEBreaker path runs at 320x240 / 60 Hz on the bare 12 MHz
oscillator — `start` / `end` values above 320 (for x) or 240 (for y)
are valid in the underlying timing but won't paint anywhere visible.
The 25 MHz / 640x480 path needs an SB_PLL40_CORE primitive that's
deferred for v0.1.

Behavior is purely combinational. The comparison is a pair of
range-bounded comparators — trivial on iCE40.
"""

from amaranth import Const, Elaboratable, Module, Signal, unsigned


class PixelRange(Elaboratable):
    """Combinational 1-bit window comparator: start <= pixel <= end."""

    def __init__(self, start: int = 100, end: int = 200):
        self.start = max(0, min(639, int(start)))
        self.end = max(0, min(639, int(end)))

        # 10-bit pixel coordinate matches VGA Timing's x / y outputs.
        self.pixel = Signal(unsigned(10))
        self.inside = Signal()

        self.input_ports = {"pixel": self.pixel}
        self.output_ports = {"inside": self.inside}

    def elaborate(self, platform):
        m = Module()
        m.d.comb += self.inside.eq(
            (self.pixel >= Const(self.start, 10))
            & (self.pixel <= Const(self.end, 10))
        )
        return m

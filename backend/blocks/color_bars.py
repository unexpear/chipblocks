"""
Color Bars block — generates an 8-vertical-stripe SMPTE-style color-bar
pattern for VGA output.

Inputs:
- `x`       — pixel x position (10-bit unsigned), from VGA Timing
- `visible` — 1-bit; only emit color when high

Outputs:
- `r` — 1-bit red channel
- `g` — 1-bit green channel
- `b` — 1-bit blue channel

The bar palette is the standard SMPTE NTSC test pattern, left-to-right:
white, yellow, cyan, green, magenta, red, blue, black. Each bar is 64
pixels wide so the bar index is just the next-higher 3 bits of x —
which costs zero hardware vs. a divide-by-80 ladder. 8 × 64 = 512
pixels, which fills the entire active 320-pixel-wide raster v0.1
produces on the iCEBreaker's bare 12 MHz oscillator (the right 128
pixels of the 640-pixel raster repeat / wrap, but the visible result is
still 8 SMPTE bars covering the screen).

Behavior is purely combinational. When `visible` is low (during VGA
blanking and sync intervals) all three channels are forced to 0 — that's
required by VGA: the analog R/G/B pins must be at the 0V "black" level
during sync, otherwise the monitor's sync separator can lose lock.

Common usage. Wire VGA Timing's `visible` and `x` outputs into Color
Bars, then route Color Bars' `r`/`g`/`b` plus VGA Timing's `hsync`/
`vsync` into VGA Output. That's the canonical "first visual chip" demo:
flash to an iCEBreaker with a VGA PMOD attached and you get 8 bars on
the monitor.
"""

from amaranth import Elaboratable, Module, Signal, unsigned


class ColorBars(Elaboratable):
    """Combinational SMPTE-style 8-bar color generator (no parameters)."""

    def __init__(self):
        # The VGA Timing block's x is 10-bit; we accept the same width
        # so the wiring is trivial. Only bits [6:9] matter.
        self.x = Signal(unsigned(10))
        self.visible = Signal()

        self.r = Signal()
        self.g = Signal()
        self.b = Signal()

        self.input_ports = {"x": self.x, "visible": self.visible}
        self.output_ports = {"r": self.r, "g": self.g, "b": self.b}

    def elaborate(self, platform):
        m = Module()

        # Bar index 0..7 = x / 64. Using 64-pixel-wide bars (rather
        # than the strict 1/8-of-640 = 80-pixel bars) lets the index
        # fall out as a simple bit-slice with zero arithmetic — cheap
        # on the iCE40. 8 × 64 = 512 pixels covers the full active area
        # in the 320-pixel-wide / 12 MHz mode v0.1 ships.
        bar = Signal(3)
        m.d.comb += bar.eq(self.x[6:9])

        # SMPTE color-bar palette (1-bit per channel, left to right):
        #   0 white   (R=1, G=1, B=1)
        #   1 yellow  (R=1, G=1, B=0)
        #   2 cyan    (R=0, G=1, B=1)
        #   3 green   (R=0, G=1, B=0)
        #   4 magenta (R=1, G=0, B=1)
        #   5 red     (R=1, G=0, B=0)
        #   6 blue    (R=0, G=0, B=1)
        #   7 black   (R=0, G=0, B=0)
        # Per-channel: R is high for bars {0,1,4,5}; G for {0,1,2,3};
        # B for {0,2,4,6}. Falls out as a small bit-comparison each.
        with m.If(self.visible):
            m.d.comb += [
                self.r.eq((bar == 0) | (bar == 1) | (bar == 4) | (bar == 5)),
                self.g.eq(bar < 4),  # bars 0..3 have G high
                self.b.eq(~bar[0]),  # even bars (0,2,4,6) have B high
            ]
        with m.Else():
            # During blanking the channels MUST sit at 0 — VGA monitors
            # rely on the absence of any color signal during sync to
            # keep their HSYNC/VSYNC separators in lock.
            m.d.comb += [self.r.eq(0), self.g.eq(0), self.b.eq(0)]

        return m

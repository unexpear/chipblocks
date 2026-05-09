"""
Solid Color block — constant 1-bit-per-channel RGB source.

A flat-color tile generator. Wire `r`, `g`, `b` straight into
VGA Output (or use it as a background source under a PixelRange-AND'd
foreground) to get a single-color screen without composing logic
gates by hand.

Inputs: none.

Outputs:
- `r` — 1-bit red channel
- `g` — 1-bit green channel
- `b` — 1-bit blue channel

Parameter:
- `color` — one of "black", "red", "green", "blue", "yellow", "cyan",
            "magenta", "white" (default "white"). Same 8 colors the
            Color Bars block produces.

Behavior is purely combinational: the enum is mapped at construction
time to literal 1-bit constants on each channel, so the elaborated
hardware is just three tied wires.
"""

from amaranth import Const, Elaboratable, Module, Signal


# Single source of truth for the 8 named colors. The order matches the
# Color Bars block's SMPTE palette (left-to-right).
COLOR_TABLE: dict[str, tuple[int, int, int]] = {
    "white":   (1, 1, 1),
    "yellow":  (1, 1, 0),
    "cyan":    (0, 1, 1),
    "green":   (0, 1, 0),
    "magenta": (1, 0, 1),
    "red":     (1, 0, 0),
    "blue":    (0, 0, 1),
    "black":   (0, 0, 0),
}


class SolidColor(Elaboratable):
    """Combinational 1-bit-per-channel constant RGB source."""

    def __init__(self, color: str = "white"):
        if color not in COLOR_TABLE:
            raise ValueError(
                f"Unknown color {color!r}; expected one of "
                f"{sorted(COLOR_TABLE.keys())}"
            )
        self.color = color
        self._r, self._g, self._b = COLOR_TABLE[color]

        self.r = Signal()
        self.g = Signal()
        self.b = Signal()

        self.input_ports: dict = {}
        self.output_ports = {"r": self.r, "g": self.g, "b": self.b}

    def elaborate(self, platform):
        m = Module()
        m.d.comb += [
            self.r.eq(Const(self._r, 1)),
            self.g.eq(Const(self._g, 1)),
            self.b.eq(Const(self._b, 1)),
        ]
        return m

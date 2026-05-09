"""
VGA Output block — visual sink for a five-signal VGA bus (R, G, B,
HSYNC, VSYNC).

The block has no internal logic. It's a marker that says "route these
five 1-bit signals to the FPGA's VGA pins." `build.py` looks for the
presence of a VGA Output node in the graph and, when targeting the
iCEBreaker, generates extra pin-constraint lines in the .pcf mapping
each signal to its physical PMOD1B package pin (per the open-source
amaranth_boards/icebreaker.py convention).

Inputs:
- `r`     — 1-bit red channel
- `g`     — 1-bit green channel
- `b`     — 1-bit blue channel
- `hsync` — 1-bit horizontal sync (active LOW for 640x480 @ 60 Hz)
- `vsync` — 1-bit vertical sync   (active LOW for 640x480 @ 60 Hz)

The audio-side ▶ Play path doesn't render visuals — VGA Output blocks
elaborate but contribute nothing to the WAV. To see the picture, build
to the iCEBreaker FPGA and flash the bitstream with a VGA PMOD
attached to PMOD1B.
"""

from amaranth import Elaboratable, Module, Signal


class VgaOutput(Elaboratable):
    """Visual sink — exposes R/G/B/HSYNC/VSYNC for pin routing."""

    def __init__(self):
        self.r = Signal()
        self.g = Signal()
        self.b = Signal()
        self.hsync = Signal()
        self.vsync = Signal()

        self.input_ports = {
            "r": self.r,
            "g": self.g,
            "b": self.b,
            "hsync": self.hsync,
            "vsync": self.vsync,
        }
        self.output_ports: dict = {}

    def elaborate(self, platform):
        # No internal logic. The translator wires the 5 inputs into
        # this block's signals via the standard m.d.comb edge pattern,
        # and the build wrapper picks them up by name to drive the
        # board's VGA pins.
        m = Module()
        return m

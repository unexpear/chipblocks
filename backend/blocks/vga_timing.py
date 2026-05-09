"""
VGA Timing block — generates standard 640x480 @ 60 Hz VGA timing from
the implicit pixel-clock domain.

The block has no inputs; it simply runs off the surrounding sync domain
and emits the five canonical signals every VGA pipeline needs:

- `hsync`   — horizontal sync, active LOW (standard for 640x480 @ 60 Hz)
- `vsync`   — vertical sync,   active LOW
- `visible` — high during the active display area (not during the sync /
              porch / blanking intervals)
- `x`       — current pixel column 0..639 while `visible` is high (junk
              elsewhere; downstream blocks gate on `visible`)
- `y`       — current pixel row 0..479 while `visible` is high

The pipeline assumes the surrounding clock IS the pixel clock — i.e. the
build-time wrapper feeds this block with the right pixel rate. The
audio-rate sample tick used elsewhere in ChipBlocks does not gate this
block; visual graphs run at the pixel rate, not the audio rate.

For the iCEBreaker FPGA path, `build.py` drives this from the on-board
12 MHz oscillator without a PLL, which produces 320x240 @ 60 Hz timing
out of the same counters (every horizontal/vertical period halved).
That's still a perfectly valid VGA mode that virtually every monitor
accepts; doubling to a 25 MHz pixel clock would need an SB_PLL40_CORE
that's deferred for v0.1.

Standard 640x480 @ 60 Hz timing constants (per VESA DMT):
  H: 640 visible, 16 front porch, 96 sync, 48 back porch  -> 800 total
  V: 480 visible, 10 front porch,  2 sync, 33 back porch  -> 525 total
  HSYNC active low during the 96-pixel sync interval
  VSYNC active low during the   2-line sync interval
"""

from amaranth import Elaboratable, Module, Signal, unsigned


# Canonical 640x480 timing numbers. Reusing them for both the 25 MHz
# pixel clock case (true 640x480 @ 60 Hz) and the simpler 12 MHz case
# (which results in 320x240 @ 60 Hz with the same counters) — the
# counters' behavior is identical; only the output frequency changes.
H_VISIBLE = 640
H_FRONT_PORCH = 16
H_SYNC = 96
H_BACK_PORCH = 48
H_TOTAL = H_VISIBLE + H_FRONT_PORCH + H_SYNC + H_BACK_PORCH  # 800

V_VISIBLE = 480
V_FRONT_PORCH = 10
V_SYNC = 2
V_BACK_PORCH = 33
V_TOTAL = V_VISIBLE + V_FRONT_PORCH + V_SYNC + V_BACK_PORCH  # 525


class VgaTiming(Elaboratable):
    """640x480 @ 60 Hz VGA timing generator (no parameters, no inputs)."""

    def __init__(self):
        self.hsync = Signal()
        self.vsync = Signal()
        self.visible = Signal()
        # 10 bits is enough for 0..799 (H) and 0..524 (V). Downstream
        # blocks like Color Bars only look at the high three bits of x,
        # so the 10-bit width is convenient and matches a common
        # convention in open-source VGA cores.
        self.x = Signal(unsigned(10))
        self.y = Signal(unsigned(10))

        self.input_ports: dict = {}
        self.output_ports = {
            "hsync": self.hsync,
            "vsync": self.vsync,
            "visible": self.visible,
            "x": self.x,
            "y": self.y,
        }

    def elaborate(self, platform):
        m = Module()

        # Internal counters covering the full horizontal and vertical
        # periods (visible + porches + sync). The visible-area outputs
        # are derived combinationally from these.
        h_count = Signal(range(H_TOTAL))
        v_count = Signal(range(V_TOTAL))

        # Horizontal counter wraps every H_TOTAL ticks; on wrap, the
        # vertical counter advances by one (and itself wraps every
        # V_TOTAL lines).
        with m.If(h_count == H_TOTAL - 1):
            m.d.sync += h_count.eq(0)
            with m.If(v_count == V_TOTAL - 1):
                m.d.sync += v_count.eq(0)
            with m.Else():
                m.d.sync += v_count.eq(v_count + 1)
        with m.Else():
            m.d.sync += h_count.eq(h_count + 1)

        # Sync polarity is active-low for 640x480 @ 60 Hz: the sync line
        # is normally HIGH and pulses LOW during the sync window.
        h_sync_start = H_VISIBLE + H_FRONT_PORCH
        h_sync_end = h_sync_start + H_SYNC
        v_sync_start = V_VISIBLE + V_FRONT_PORCH
        v_sync_end = v_sync_start + V_SYNC

        m.d.comb += [
            self.hsync.eq(~((h_count >= h_sync_start) & (h_count < h_sync_end))),
            self.vsync.eq(~((v_count >= v_sync_start) & (v_count < v_sync_end))),
            self.visible.eq((h_count < H_VISIBLE) & (v_count < V_VISIBLE)),
            # While visible, h_count == x and v_count == y. We expose
            # the raw counters; downstream blocks gate on `visible` so
            # they don't read the porch/sync values.
            self.x.eq(h_count),
            self.y.eq(v_count),
        ]

        return m

"""
RAM block — 16-byte synchronous read/write memory.

Inputs:
- `addr`         — 4-bit unsigned address (selects cell 0..15)
- `data-in`      — 8-bit unsigned value to write
- `write-enable` — 1-bit gate; on the rising edge of the synth clock,
                   when high the cell at `addr` is overwritten with
                   `data-in`

Output:
- `data-out` — 8-bit unsigned; combinational read of the current
               address (mirrors the Delay block's async-read pattern,
               so reads come back the same cycle the address is presented)

Implementation: a single `amaranth.lib.memory.Memory` of 16 × 8-bit
unsigned cells, zero-initialized. Both write and read share the same
address port; on iCE40 this still maps to a single BRAM (well under one
4 KB block at 16 × 8 bits = 128 bits).
"""

from amaranth import Elaboratable, Module, Signal, unsigned
from amaranth.lib.memory import Memory


RAM_DEPTH = 16


class RAM(Elaboratable):
    """16-byte synchronous RAM with combinational read."""

    def __init__(self):
        self.addr = Signal(unsigned(4))
        self.data_in = Signal(unsigned(8))
        self.write_enable = Signal()
        self.data_out = Signal(unsigned(8))

        self.input_ports = {
            "addr": self.addr,
            "data-in": self.data_in,
            "write-enable": self.write_enable,
        }
        self.output_ports = {"data-out": self.data_out}

    def elaborate(self, platform):
        m = Module()
        m.submodules.mem = mem = Memory(
            shape=unsigned(8),
            depth=RAM_DEPTH,
            init=[0] * RAM_DEPTH,
        )
        wp = mem.write_port()
        rp = mem.read_port(domain="comb")

        m.d.comb += [
            rp.addr.eq(self.addr),
            self.data_out.eq(rp.data),
            wp.addr.eq(self.addr),
            wp.data.eq(self.data_in),
            wp.en.eq(self.write_enable),
        ]
        return m

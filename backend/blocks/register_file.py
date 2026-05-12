"""
Register File block — 16 × 8-bit storage with separate read and write
address ports. The key distinction from RAM is that the read address
and write address are independent: in one cycle you can read register
N while writing register M, which is how real CPU instruction sets
work (each instruction names a destination register and one or two
source registers, all decoded in the same cycle).

Inputs:
- `read-addr`    — 4-bit unsigned address (selects which register to read)
- `write-addr`   — 4-bit unsigned address (selects which register to write)
- `data-in`      — 8-bit unsigned value to write
- `write-enable` — 1-bit gate; on the rising edge of the synth clock,
                   when high the cell at `write-addr` is overwritten
                   with `data-in`

Output:
- `data-out` — 8-bit unsigned; combinational read of the register at
               `read-addr` (mirrors RAM/Delay's async-read pattern,
               so reads come back the same cycle the address is presented)

Implementation: one `amaranth.lib.memory.Memory` of 16 × 8-bit unsigned
cells, zero-initialized, with one combinational read port and one
synchronous write port. Both ports are independently addressed.
"""

from amaranth import Elaboratable, Module, Signal, unsigned
from amaranth.lib.memory import Memory


REGISTER_FILE_DEPTH = 16


class RegisterFile(Elaboratable):
    """16 × 8-bit register file with independent read and write addresses."""

    def __init__(self):
        self.read_addr = Signal(unsigned(4))
        self.write_addr = Signal(unsigned(4))
        self.data_in = Signal(unsigned(8))
        self.write_enable = Signal()
        self.data_out = Signal(unsigned(8))

        self.input_ports = {
            "read-addr": self.read_addr,
            "write-addr": self.write_addr,
            "data-in": self.data_in,
            "write-enable": self.write_enable,
        }
        self.output_ports = {"data-out": self.data_out}

    def elaborate(self, platform):
        m = Module()
        m.submodules.mem = mem = Memory(
            shape=unsigned(8),
            depth=REGISTER_FILE_DEPTH,
            init=[0] * REGISTER_FILE_DEPTH,
        )
        wp = mem.write_port()
        rp = mem.read_port(domain="comb")

        m.d.comb += [
            rp.addr.eq(self.read_addr),
            self.data_out.eq(rp.data),
            wp.addr.eq(self.write_addr),
            wp.data.eq(self.data_in),
            wp.en.eq(self.write_enable),
        ]
        return m

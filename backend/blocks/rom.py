"""
ROM block — 16-byte combinational read-only memory.

Inputs:
- `addr` — 4-bit unsigned address (selects cell 0..15)

Output:
- `data-out` — 8-bit unsigned; combinational read of `contents[addr]`

Parameter:
- `contents` — list[int]. Each entry is the byte at the corresponding
               address. Values are clamped to 0..255 and the list is
               padded with zeros (or truncated) to exactly 16 entries.

This is the first ChipBlocks block where the parameter is a list rather
than a scalar — the typical use is hand-authoring a tiny program for a
sequencer or CPU instruction stream. The contents live in the saved
graph JSON and round-trip cleanly through Save/Load.

Implementation: `amaranth.lib.memory.Memory` initialised at construction
time with the user-supplied bytes. Combinational read on the input
address, no write port. iCE40's Yosys flow recognises constant-init
memories and instances a single BRAM for the data.
"""

from amaranth import Elaboratable, Module, Signal, unsigned
from amaranth.lib.memory import Memory


ROM_DEPTH = 16


class ROM(Elaboratable):
    """16-byte combinational ROM initialised from a list of integers."""

    def __init__(self, contents: list[int] | None = None):
        # Defensive normalisation: clamp each entry to 0..255 and pad /
        # truncate to ROM_DEPTH so the Memory init list is always the
        # right shape regardless of what the renderer sent.
        raw = list(contents) if contents else []
        clamped = [max(0, min(255, int(v))) for v in raw[:ROM_DEPTH]]
        while len(clamped) < ROM_DEPTH:
            clamped.append(0)
        self.contents = clamped

        self.addr = Signal(unsigned(4))
        self.data_out = Signal(unsigned(8))

        self.input_ports = {"addr": self.addr}
        self.output_ports = {"data-out": self.data_out}

    def elaborate(self, platform):
        m = Module()
        m.submodules.mem = mem = Memory(
            shape=unsigned(8),
            depth=ROM_DEPTH,
            init=self.contents,
        )
        rp = mem.read_port(domain="comb")
        m.d.comb += [
            rp.addr.eq(self.addr),
            self.data_out.eq(rp.data),
        ]
        return m

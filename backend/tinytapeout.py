"""
tinytapeout.py — Generate a Tiny Tapeout submission package from a graph.

Tiny Tapeout (https://tinytapeout.com) is a community shuttle that
fabricates user-submitted designs at SkyWater 130 nm (TTSKY shuttles)
or GlobalFoundries 180 nm (TTGF shuttles) and ships back real ASIC
chips. Unlike the FPGA path, **TT runs the synth + place + route on
their infrastructure** after submission — we just emit the source
files in the shape they require, plus the LibreLane config and a
cocotb testbench so the submission portal's CI accepts the project
without manual edits.

What this module produces (all zipped into chipblocks-tt.zip, in the
exact directory layout TinyTapeout/ttsky-verilog-template uses):

    src/
        tt_top.v             Thin Verilog wrapper exposing TT's
                             standard pin layout (ui_in, uo_out,
                             uio_*, ena, clk, rst_n). Clocks the
                             user's graph at the audio sample rate
                             via a counter-driven enable.
        chipblocks_user.v    The user's graph as Verilog. Emitted by
                             amaranth.back.verilog.convert with an
                             enable input that gates every internal
                             flip-flop, so the graph advances at the
                             audio sample rate even though the chip
                             clock runs much faster.
        config.json          LibreLane configuration. Default 50 MHz
                             clock, 1x1 tile, all per the upstream
                             template.
    test/
        Makefile             cocotb make rules.
        tb.v                 Verilog testbench skeleton (matches the
                             one in TinyTapeout/ttsky-verilog-template).
        test.py              cocotb test harness — clocks the design
                             and verifies it runs without errors.
        requirements.txt     pytest + cocotb pinned versions.
        tb.gtkw              GTKWave save file for visual debugging.
    docs/
        info.md              User-facing project description (TT
                             renders this into a per-design datasheet
                             on tinytapeout.com).
    info.yaml                TT project metadata (yaml_version 6).
    README.md                Project README that lands in the
                             submission repo.
    LICENSE                  MIT (matches the project license).
    .gitignore               Standard TT project gitignore.
    SUBMIT.md                ChipBlocks-side instructions: how to
                             take this zip and turn it into a real
                             submission.

Spec sources (verified May 2026 against the live repos):
    - https://tinytapeout.com/specs/pinouts/  pin layout
    - https://github.com/TinyTapeout/ttsky-verilog-template  current
      template for TTSKY26a (SkyWater 130 nm)
    - https://github.com/TinyTapeout/tt-support-tools  the validator
      that runs against submitted designs (project_info.py +
      project_checks.py)
"""

from __future__ import annotations

import sys
import uuid
import zipfile
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))

from amaranth import Elaboratable, EnableInserter, Module, Signal  # noqa: E402
from amaranth.back import verilog  # noqa: E402

from synth import GraphTop, SAMPLE_RATE  # noqa: E402


# Tiny Tapeout cohort clock rate. The TTSKY26a / TTGF26a templates ship
# config.json with CLOCK_PERIOD: 20 (nanoseconds), i.e. 50 MHz, and
# the demo board's RP2040 clock generator defaults to 50 MHz for digital
# designs. So 50 MHz is the right number to claim in info.yaml.
TT_CLOCK_HZ = 50_000_000

# Tiny Tapeout top-module naming convention. Must start with "tt_um_"
# AND must be unique on the shuttle. We auto-generate a slug per
# submission so two ChipBlocks users don't collide.
TT_TOP_PREFIX = "tt_um_"

# Inner module name (the user's graph as Verilog). Kept distinct from
# the TT wrapper module name so the wrapper can instantiate it cleanly.
INNER_MODULE_NAME = "chipblocks_user"


class TinyTapeoutInner(Elaboratable):
    """Amaranth wrapper that exposes the graph's audio output as a
    top-level 8-bit unsigned port AND gates the entire graph by a
    sample-rate enable signal.

    Why the enable signal:
        The graph's blocks (oscillator, ADSR, gate, etc.) compute
        their phase increments assuming one tick == one audio sample
        at SAMPLE_RATE Hz. On a real TT die the clock runs much
        faster (50 MHz, ~1133× the audio rate), so without gating the
        oscillators would run 1133× too high in pitch and the ADSR
        envelopes would attack/decay 1133× too fast — i.e. inaudible
        clicks instead of musical tones.

        EnableInserter(sample_tick) wraps the GraphTop and gates EVERY
        flip-flop inside it by sample_tick. The wrapper's counter
        pulses sample_tick high for one cycle every (TT_CLOCK_HZ /
        SAMPLE_RATE) cycles, so the inner advances exactly once per
        audio sample even though the surrounding clock is 1133× faster.

    The audio output is sampled combinationally so the wrapper sees
    fresh data every clock cycle, ready to drive uo_out[7:0].
    """

    def __init__(self, graph: dict):
        self._graph_top = GraphTop(graph)
        # The enable signal: when high, the inner GraphTop advances
        # by one tick. Driven by the wrapper's sample-rate counter.
        self.sample_enable = Signal()
        # 8-bit unsigned audio amplitude exposed to the TT wrapper.
        self.audio_out = Signal(8)
        # Hold a reference to the inner GraphTop's audio_in so we can
        # wire it to audio_out combinationally below.
        self._signed_audio = self._graph_top.output_block.audio_in

    def elaborate(self, platform):
        m = Module()
        # Gate the entire graph by sample_enable. EnableInserter
        # rewrites every m.d.sync update inside _graph_top to be
        # conditional on sample_enable being high.
        m.submodules.inner = EnableInserter(self.sample_enable)(self._graph_top)
        # Convert signed audio to unsigned by adding 128 (offset
        # binary). The wrapper routes these 8 bits directly to
        # uo_out[7:0] for an external R-2R DAC.
        m.d.comb += self.audio_out.eq((self._signed_audio + 128).as_unsigned())
        return m


def _emit_inner_verilog(graph: dict, out_path: Path) -> None:
    """Generate the user-graph Verilog file (chipblocks_user.v).

    The emitted module is named INNER_MODULE_NAME and exposes:
        input  clk            (sync-domain clock — TT's chip clock)
        input  rst            (sync-domain reset — TT's ~rst_n)
        input  sample_enable  (sample-rate tick from the wrapper)
        output [7:0] audio_out (unsigned audio amplitude)
    """
    top = TinyTapeoutInner(graph)
    text = verilog.convert(
        top,
        name=INNER_MODULE_NAME,
        ports=[top.sample_enable, top.audio_out],
        emit_src=False,
    )
    out_path.write_text(text)


def _slug(name: str) -> str:
    """Sanitize a project name into a Verilog-identifier-safe slug.

    TT requires `tt_um_<slug>` to be a legal Verilog identifier and
    unique on the shuttle. We lowercase, keep alnum + underscore,
    collapse consecutive underscores, and strip leading digits.
    """
    out = []
    for ch in name.lower():
        if ch.isalnum() or ch == "_":
            out.append(ch)
        else:
            out.append("_")
    slug = "".join(out)
    while "__" in slug:
        slug = slug.replace("__", "_")
    slug = slug.strip("_")
    if not slug or slug[0].isdigit():
        slug = "p_" + slug
    return slug


def _auto_unique_slug(base: str = "chipblocks") -> str:
    """Generate a unique-on-the-shuttle slug.

    TT's submission validator only checks that top_module starts with
    "tt_um_". Uniqueness is the submitter's responsibility — collisions
    are rejected by the shuttle's CI when two designs claim the same
    top_module name. We append an 8-char random suffix derived from
    uuid4 so unrelated ChipBlocks builds don't collide by default.
    """
    suffix = uuid.uuid4().hex[:8]
    return f"{_slug(base)}_{suffix}"


# ---------------------------------------------------------------------------
# Verilog wrapper (src/tt_top.v)
# ---------------------------------------------------------------------------
# Plain Verilog by design — easier for TT reviewers to read than emitting
# this through Amaranth. The wrapper does three things:
#   1. Counts clock ticks and pulses sample_enable once per audio sample.
#   2. Inverts TT's active-low rst_n to feed Amaranth's active-high reset.
#   3. Routes the inner module's 8-bit audio to uo_out[7:0].

WRAPPER_TEMPLATE = """\
/*
 * tt_top.v -- Tiny Tapeout wrapper for a ChipBlocks-generated audio chip.
 *
 * ChipBlocks (https://chipblocks.app) is a free, open-source visual
 * chip-design app. The user drags audio-synth blocks onto a canvas,
 * wires them, and presses "Build for Tiny Tapeout" -- which produces
 * this wrapper plus the user's graph compiled to Verilog.
 *
 * What this wrapper does:
 *   - Generates a sample_enable pulse once every {ticks_per_sample}
 *     clock cycles -- i.e. once per audio sample at {sample_rate} Hz
 *     given the cohort's {clock_mhz} MHz clock. The pulse gates every
 *     flip-flop inside the user's graph, so oscillators, ADSR
 *     envelopes, gate generators, etc. all advance at audio rate even
 *     though the surrounding chip clock is much faster.
 *   - Inverts TT's active-low rst_n to drive Amaranth's active-high
 *     reset port on the inner module.
 *   - Routes the inner module's 8-bit unsigned audio amplitude to
 *     `uo_out[7:0]` for an external parallel R-2R-ladder DAC. 256
 *     amplitude levels gives ~48 dB of dynamic range, dramatically
 *     better than the iCEstick path's 1-bit PWM (which is also a
 *     ChipBlocks output target).
 *   - Ties off the unused TT pins (`ui_in`, `uio_*`) so the lint passes.
 *
 * Audio sample rate inside the chip:
 *   chip clock = {clock_hz} Hz; sample_enable fires every
 *   {ticks_per_sample} cycles, giving an audio rate of about
 *   {effective_sample_rate} Hz (= {clock_hz} / {ticks_per_sample}).
 *   The inner graph was synthesized for a {sample_rate} Hz sample
 *   rate; integer division means the realised rate is slightly
 *   different (off by less than 0.1%), which is inaudible.
 *
 * Copyright (c) 2026 ChipBlocks contributors. SPDX-License-Identifier: MIT
 */

`default_nettype none

module {tt_module} (
    input  wire [7:0] ui_in,    // dedicated inputs (unused -- ChipBlocks
                                //   chips are self-clocking)
    output wire [7:0] uo_out,   // dedicated outputs: 8-bit audio amplitude
                                //   uo_out[0]=LSB ... uo_out[7]=MSB
    input  wire [7:0] uio_in,   // bidirectional pins, input path (unused)
    output wire [7:0] uio_out,  // bidirectional pins, output path
    output wire [7:0] uio_oe,   // bidirectional pins, output enable
    input  wire       ena,      // power-good (always 1 when running)
    input  wire       clk,      // shuttle clock (~{clock_mhz} MHz)
    input  wire       rst_n     // active-low reset
);

  // ------------------------------------------------------------------
  // Sample-rate divider: pulse `sample_enable` once every
  // TICKS_PER_SAMPLE clock cycles so the inner module advances at
  // SAMPLE_RATE Hz instead of CLOCK_HZ.
  // ------------------------------------------------------------------
  localparam integer TICKS_PER_SAMPLE = {ticks_per_sample};
  // Counter width: enough bits to hold TICKS_PER_SAMPLE - 1.
  localparam integer COUNTER_WIDTH = {counter_width};

  reg [COUNTER_WIDTH-1:0] sample_counter;
  reg sample_enable;

  always @(posedge clk) begin
    if (!rst_n) begin
      sample_counter <= {{COUNTER_WIDTH{{1'b0}}}};
      sample_enable  <= 1'b0;
    end else if (sample_counter == TICKS_PER_SAMPLE - 1) begin
      sample_counter <= {{COUNTER_WIDTH{{1'b0}}}};
      sample_enable  <= 1'b1;
    end else begin
      sample_counter <= sample_counter + 1'b1;
      sample_enable  <= 1'b0;
    end
  end

  // ------------------------------------------------------------------
  // Inner module: the user's graph compiled to Verilog by Amaranth.
  // Amaranth's default sync domain is active-HIGH reset, so we invert
  // TT's active-low rst_n on the way in.
  // ------------------------------------------------------------------
  wire [7:0] audio_amplitude;

  {inner_module} u_chipblocks (
      .clk           (clk),
      .rst           (~rst_n),
      .sample_enable (sample_enable),
      .audio_out     (audio_amplitude)
  );

  // ------------------------------------------------------------------
  // Pin assignments.
  // ------------------------------------------------------------------
  // 8-bit parallel audio: wire to an R-2R ladder DAC + amp + speaker.
  assign uo_out  = audio_amplitude;

  // No bidirectional traffic -- tie low and disable the output drivers
  // (uio_oe = 0 means "input mode", which is the safe default).
  assign uio_out = 8'h00;
  assign uio_oe  = 8'h00;

  // Silence "input never used" warnings in the lint step.
  // `ena` is documented as always-1 once the chip is enabled;
  // `ui_in`/`uio_in` aren't used by ChipBlocks audio chips.
  wire _unused = &{{ena, ui_in, uio_in, 1'b0}};

endmodule
"""


def _build_wrapper(tt_module: str) -> str:
    ticks_per_sample = TT_CLOCK_HZ // SAMPLE_RATE
    # Counter width: ceil(log2(ticks_per_sample)). A value of 1133
    # needs an 11-bit counter (max value 1132 < 2048).
    counter_width = max(1, (ticks_per_sample - 1).bit_length())
    effective_sample_rate = TT_CLOCK_HZ // ticks_per_sample
    return WRAPPER_TEMPLATE.format(
        tt_module=tt_module,
        inner_module=INNER_MODULE_NAME,
        clock_hz=TT_CLOCK_HZ,
        clock_mhz=TT_CLOCK_HZ // 1_000_000,
        sample_rate=SAMPLE_RATE,
        ticks_per_sample=ticks_per_sample,
        counter_width=counter_width,
        effective_sample_rate=effective_sample_rate,
    )


# ---------------------------------------------------------------------------
# info.yaml — TT project metadata (yaml_version: 6, current as of TTSKY26a /
# TTGF26a). Schema validated against tt-support-tools/project_info.py:
#   project: title*, author*, description*, language*, clock_hz*,
#            tiles*, top_module*, source_files*, discord (optional)
#   pinout: ui[0..7], uo[0..7], uio[0..7] -- ALL 24 keys required
#   yaml_version: 6
#   ( * = mandatory; empty strings are rejected )
# ---------------------------------------------------------------------------

def _build_info_yaml(project_name: str, tt_module: str, author: str, description: str) -> str:
    """Build info.yaml content. Schema per yaml_version: 6.

    Validation rules enforced by tt-support-tools (live as of May 2026):
      - title, author, description CANNOT be empty strings.
      - top_module must start with `tt_um_`.
      - source_files must list at least one file (bare filenames,
        relative to the src/ directory).
      - tiles must be one of: 1x1, 1x2, 2x2, 3x2, 4x2, 6x2, 8x2.
      - pinout must list all 24 ui/uo/uio entries (use empty strings
        for unused pins, NOT missing keys).
      - clock_hz must be a non-negative integer.
      - yaml_version must equal 6.
    """
    info = {
        "project": {
            "title": f"ChipBlocks audio chip ({project_name})",
            "author": author,
            "discord": "",
            "description": description,
            "language": "Verilog",
            "clock_hz": TT_CLOCK_HZ,
            "tiles": "1x1",
            "top_module": tt_module,
            "source_files": [
                "tt_top.v",
                f"{INNER_MODULE_NAME}.v",
            ],
        },
        "pinout": {
            # Dedicated inputs -- unused; ChipBlocks chips self-clock.
            "ui[0]": "",
            "ui[1]": "",
            "ui[2]": "",
            "ui[3]": "",
            "ui[4]": "",
            "ui[5]": "",
            "ui[6]": "",
            "ui[7]": "",
            # Dedicated outputs -- 8-bit unsigned audio amplitude.
            "uo[0]": "audio amplitude bit 0 (LSB)",
            "uo[1]": "audio amplitude bit 1",
            "uo[2]": "audio amplitude bit 2",
            "uo[3]": "audio amplitude bit 3",
            "uo[4]": "audio amplitude bit 4",
            "uo[5]": "audio amplitude bit 5",
            "uo[6]": "audio amplitude bit 6",
            "uo[7]": "audio amplitude bit 7 (MSB)",
            # Bidirectional pins -- unused.
            "uio[0]": "",
            "uio[1]": "",
            "uio[2]": "",
            "uio[3]": "",
            "uio[4]": "",
            "uio[5]": "",
            "uio[6]": "",
            "uio[7]": "",
        },
        "yaml_version": 6,
    }
    # sort_keys=False preserves the order TT's tooling expects (project
    # block before pinout, yaml_version last). default_flow_style=False
    # keeps the block style throughout for human readability.
    return yaml.safe_dump(info, sort_keys=False, default_flow_style=False)


# ---------------------------------------------------------------------------
# docs/info.md — TT renders this to a per-design datasheet
# ---------------------------------------------------------------------------
# tt-support-tools/project_checks.py REJECTS the submission if it sees the
# placeholder strings "# How it works\n\nExplain how your project works"
# or "# How to test\n\nExplain how to use your project". Make sure neither
# string appears in the body even by accident.

def _build_docs_info_md(project_name: str) -> str:
    ticks_per_sample = TT_CLOCK_HZ // SAMPLE_RATE
    return f"""\
<!---

Datasheet for the ChipBlocks-generated audio chip submitted to Tiny Tapeout.
ChipBlocks: https://chipblocks.app -- visual node-graph chip designer.

-->

## How it works

This chip is an audio synthesizer composed entirely of building blocks
wired together visually in ChipBlocks. The user drags blocks
(oscillators, ADSR envelopes, mixers, low-pass filters, FM operators,
etc.) onto a canvas, connects them with audio cables, and presses
"Build for Tiny Tapeout" -- the app translates the graph into Verilog
and packages it for submission.

The synthesizer is **self-clocking**: it has no per-cycle inputs and no
external triggers. Power it up, supply a clock, release reset, and audio
appears on `uo_out[7:0]` as an 8-bit unsigned amplitude every clock cycle.

Internally, a sample-rate divider (in the wrapper) gates every flip-flop
inside the graph by a one-cycle pulse generated every {ticks_per_sample}
clock ticks. That makes the graph advance once per audio sample, so
oscillators, ADSR envelopes, and gate generators all run at musical
rates even though the chip clock is much faster:

- Chip clock: {TT_CLOCK_HZ // 1_000_000} MHz
- Audio sample rate: {SAMPLE_RATE} Hz (the rate the graph was synthesised for)
- Ticks per audio sample: {ticks_per_sample} ({TT_CLOCK_HZ} / {SAMPLE_RATE})

If the demo board is configured to run the chip at a different clock,
the audio pitch shifts proportionally -- rebuild from the same graph
in ChipBlocks at the new clock to retune.

## How to test

To listen to the chip you need an external 8-bit DAC (the chip's outputs
are digital -- 8 parallel bits of amplitude, not a single analog signal):

1. Wire `uo_out[7:0]` to an **R-2R ladder DAC** (16 resistors total: 8
   of value R, 8 of value 2R) with the output node tied to the input of
   an op-amp buffer or directly to a small headphone amplifier.
2. Connect the buffer/amplifier output to a speaker or a line-in jack.
3. Apply power, supply the {TT_CLOCK_HZ // 1_000_000} MHz clock, and
   release reset (`rst_n` high).
4. Audio plays continuously at {SAMPLE_RATE} Hz sample rate.

For a software-only sanity check before tape-out, the included
testbench (`test/test.py`) clocks the design for several thousand
cycles and verifies it instantiates and produces non-X output. To run:

```
cd test
pip install -r requirements.txt
make
```

## External hardware

- **R-2R ladder DAC** -- 16 resistors total. Cheap (a few cents) and
  works with any digital pins. Resolution: 8 bits = 256 amplitude
  levels = ~48 dB dynamic range.
- **Audio amplifier** -- e.g. a PAM8403 board or a discrete op-amp --
  to drive a speaker from the DAC's high-impedance output.
- **Speaker** -- 8 ohm or headphones (with a series resistor).

The bidirectional `uio[7:0]` pins and the dedicated inputs `ui[7:0]`
are not used by this design and can be left unconnected.

---

Built in ChipBlocks ({project_name} project). Source app: https://chipblocks.app
"""


# ---------------------------------------------------------------------------
# Cocotb testbench (test/Makefile, test/tb.v, test/test.py)
# ---------------------------------------------------------------------------
# Mirrors the TinyTapeout/ttsky-verilog-template test harness. The TT CI
# workflow runs `make` in this directory and fails the submission if the
# resulting results.xml contains a "failure" line. Our test does the
# minimum to satisfy CI: instantiate the design, clock it for a while,
# and verify the output isn't stuck at X.

TEST_MAKEFILE = """\
# Makefile
# See https://docs.cocotb.org/en/stable/quickstart.html for more info

# defaults
SIM ?= icarus
FST ?= -fst # Use more efficient FST format
TOPLEVEL_LANG ?= verilog
SRC_DIR = $(PWD)/../src
PROJECT_SOURCES = tt_top.v chipblocks_user.v

ifneq ($(GATES),yes)

# RTL simulation:
SIM_BUILD				= sim_build/rtl
VERILOG_SOURCES += $(addprefix $(SRC_DIR)/,$(PROJECT_SOURCES))

else

# Gate level simulation:
SIM_BUILD				= sim_build/gl
COMPILE_ARGS    += -DGL_TEST
COMPILE_ARGS    += -DFUNCTIONAL
COMPILE_ARGS    += -DUSE_POWER_PINS
COMPILE_ARGS    += -DSIM
COMPILE_ARGS    += -DUNIT_DELAY=\\#1
VERILOG_SOURCES += $(PDK_ROOT)/sky130A/libs.ref/sky130_fd_sc_hd/verilog/primitives.v
VERILOG_SOURCES += $(PDK_ROOT)/sky130A/libs.ref/sky130_fd_sc_hd/verilog/sky130_fd_sc_hd.v

# this gets copied in by the GDS action workflow
VERILOG_SOURCES += $(PWD)/gate_level_netlist.v

endif

# Allow sharing configuration between design and testbench via `include`:
COMPILE_ARGS 		+= -I$(SRC_DIR)

# Include the testbench sources:
VERILOG_SOURCES += $(PWD)/tb.v
TOPLEVEL = tb

# List test modules to run, separated by commas and without the .py suffix:
COCOTB_TEST_MODULES = test

# include cocotb's make rules to take care of the simulator setup
include $(shell cocotb-config --makefiles)/Makefile.sim
"""


def _build_tb_v(tt_module: str) -> str:
    """Generate test/tb.v -- mirrors the upstream template's tb.v exactly,
    with our top-module name in place of tt_um_example.
    """
    return f"""\
`default_nettype none
`timescale 1ns / 1ps

/* This testbench just instantiates the module and makes some convenient
   wires that can be driven / tested by the cocotb test.py. */
module tb ();

  // Dump the signals to a FST file. View with gtkwave or surfer.
  initial begin
    $dumpfile("tb.fst");
    $dumpvars(0, tb);
    #1;
  end

  // Wire up the inputs and outputs:
  reg clk;
  reg rst_n;
  reg ena;
  reg [7:0] ui_in;
  reg [7:0] uio_in;
  wire [7:0] uo_out;
  wire [7:0] uio_out;
  wire [7:0] uio_oe;
`ifdef GL_TEST
  wire VPWR = 1'b1;
  wire VGND = 1'b0;
`endif

  {tt_module} user_project (
`ifdef GL_TEST
      .VPWR(VPWR),
      .VGND(VGND),
`endif
      .ui_in  (ui_in),
      .uo_out (uo_out),
      .uio_in (uio_in),
      .uio_out(uio_out),
      .uio_oe (uio_oe),
      .ena    (ena),
      .clk    (clk),
      .rst_n  (rst_n)
  );

endmodule
"""


# Cocotb test harness. We run the chip clock for ~3000 cycles (enough
# for at least 2 sample-enable pulses at the 1133-cycle divider) and
# verify uo_out is a defined 8-bit value -- not X -- by the end. That
# proves the design instantiates, the reset releases cleanly, and the
# divider + inner graph produce a settled output.
TEST_PY = """\
# SPDX-FileCopyrightText: (c) 2026 ChipBlocks contributors
# SPDX-License-Identifier: MIT

import cocotb
from cocotb.clock import Clock
from cocotb.triggers import ClockCycles


@cocotb.test()
async def test_chipblocks_runs(dut):
    \"\"\"Smoke test: clock the chip for several thousand cycles and
    confirm uo_out is a defined 8-bit value (not X).

    A real ChipBlocks audio chip drives uo_out continuously once
    rst_n is released. We don't check audio content here -- the
    in-app simulation already verifies that -- only that the design
    instantiates, reset releases cleanly, and the wrapper's sample-
    rate divider produces enable pulses that drive the inner graph
    out of its all-zero startup state.
    \"\"\"
    dut._log.info("Start")

    # 50 MHz clock = 20 ns period. Use cocotb's recommended 'unit' API
    # rather than the deprecated 'units=' kwarg.
    clock = Clock(dut.clk, 20, unit="ns")
    cocotb.start_soon(clock.start())

    # Reset.
    dut.ena.value = 1
    dut.ui_in.value = 0
    dut.uio_in.value = 0
    dut.rst_n.value = 0
    await ClockCycles(dut.clk, 10)
    dut.rst_n.value = 1

    # Run for enough cycles to get past the first sample-enable pulse
    # (at 50 MHz / 44.1 kHz = ~1133 cycles per sample). 3000 cycles is
    # comfortably more than 2 samples.
    await ClockCycles(dut.clk, 3000)

    # uo_out must be a fully-resolved 8-bit value (no X bits). cocotb
    # raises ValueError on .integer access if any bit is X.
    out = dut.uo_out.value
    out_int = int(out)
    assert 0 <= out_int < 256, f\"uo_out out of range: {out_int}\"
    dut._log.info(f\"uo_out settled at {out_int}\")
"""


TEST_REQUIREMENTS_TXT = """\
pytest==8.4.2
cocotb==2.0.1
"""


# Minimal GTKWave save file -- same shape as the upstream template.
TEST_TB_GTKW = """\
[*]
[*] ChipBlocks Tiny Tapeout testbench - GTKWave save file
[*]
[dumpfile] "tb.fst"
[size] 1376 600
[pos] -1 -1
*-24.534533 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1
[treeopen] tb.
[sst_width] 297
[signals_width] 230
[sst_expanded] 1
[sst_vpaned_height] 158
@28
tb.user_project.ena
@29
tb.user_project.clk
@28
tb.user_project.rst_n
@200
-Inputs
@22
tb.user_project.ui_in[7:0]
@200
-Output Pins
@22
tb.user_project.uo_out[7:0]
[pattern_trace] 1
[pattern_trace] 0
"""


# ---------------------------------------------------------------------------
# LibreLane config (src/config.json)
# ---------------------------------------------------------------------------
# Lifted verbatim from TinyTapeout/ttsky-verilog-template/src/config.json
# (commit visited May 2026). LibreLane is the place-and-route engine TT
# runs on submitted designs. The defaults here are tuned for a 1x1 tile
# and a 50 MHz target clock; we don't change anything because that's
# exactly what we want.

CONFIG_JSON = """\
{
  "//": "DO NOT EDIT THIS FILE before reading the comments below:",

  "//": "This is the default configuration for Tiny Tapeout projects. It should fit most designs.",
  "//": "If you change it, please make sure you understand what you are doing. We are not responsible",
  "//": "if your project fails because of a bad configuration.",

  "//": "!!! DO NOT EDIT THIS FILE unless you know what you are doing !!!",

  "//": "If you get stuck with this config, please open an issue or get in touch via the discord.",

  "//": "Here are some of the variables you may want to change:",

  "//": "PL_TARGET_DENSITY_PCT - You can increase this if Global Placement fails with error GPL-0302.",
  "//": "Users have reported that values up to 80 worked well for them.",
  "PL_TARGET_DENSITY_PCT": 60,

  "//": "CLOCK_PERIOD - Increase this in case you are getting setup time violations.",
  "//": "The value is in nanoseconds, so 20ns == 50MHz.",
  "CLOCK_PERIOD": 20,

  "//": "Hold slack margin - Increase them in case you are getting hold violations.",
  "PL_RESIZER_HOLD_SLACK_MARGIN": 0.1,
  "GRT_RESIZER_HOLD_SLACK_MARGIN": 0.05,

  "//": "RUN_LINTER, LINTER_INCLUDE_PDK_MODELS - Disabling the linter is not recommended!",
  "RUN_LINTER": 1,
  "LINTER_INCLUDE_PDK_MODELS": 1,

  "//": "If you need a custom clock configuration, read the following documentation first:",
  "//": "https://tinytapeout.com/faq/#how-can-i-map-an-additional-external-clock-to-one-of-the-gpios",
  "CLOCK_PORT": "clk",

  "//": "Configuration docs: https://librelane.readthedocs.io/en/latest/reference/configuration.html",

  "//": "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!",
  "//": "!!! DO NOT CHANGE ANYTHING BELOW THIS POINT !!!",
  "//": "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!",

  "//": "Save some time",
  "RUN_KLAYOUT_XOR": 0,
  "RUN_KLAYOUT_DRC": 0,

  "//": "Don't put clock buffers on the outputs",
  "DESIGN_REPAIR_BUFFER_OUTPUT_PORTS": 0,

  "//": "Reduce wasted space",
  "TOP_MARGIN_MULT": 1,
  "BOTTOM_MARGIN_MULT": 1,
  "LEFT_MARGIN_MULT": 6,
  "RIGHT_MARGIN_MULT": 6,

  "//": "Absolute die size",
  "FP_SIZING": "absolute",

  "GRT_ALLOW_CONGESTION": 1,

  "FP_IO_HLENGTH": 2,
  "FP_IO_VLENGTH": 2,

  "FP_PDN_VPITCH": 38.87,

  "//": "Clock",
  "RUN_CTS": 1,

  "//": "Don't generate power rings",
  "FP_PDN_MULTILAYER": 0,

  "//": "MAGIC_DEF_LABELS may cause issues with LVS",
  "MAGIC_DEF_LABELS": 0,

  "//": "Only export pin area in LEF (without any connected nets)",
  "MAGIC_WRITE_LEF_PINONLY": 1
}
"""


# ---------------------------------------------------------------------------
# Top-level repo files (README.md, .gitignore, LICENSE)
# ---------------------------------------------------------------------------

def _build_readme(project_name: str, tt_module: str) -> str:
    return f"""\
# ChipBlocks audio chip ({project_name})

Built with [ChipBlocks](https://chipblocks.app), a free open-source visual
chip-design app, and packaged for Tiny Tapeout submission.

This is a digital audio synthesizer composed of standard building blocks
(oscillators, ADSR envelopes, filters, mixers, etc.) wired together in a
visual graph. The chip is self-clocking: power it, clock it, release
reset, and audio appears on `uo_out[7:0]` as an 8-bit unsigned amplitude.

- Top module: `{tt_module}`
- Cohort target: TTSKY26a / TTGF26a (50 MHz, 1x1 tile)
- Audio sample rate: {SAMPLE_RATE} Hz (synthesised at the in-chip clock-
  divider rate, see `src/tt_top.v` for the divider math)
- Output: 8 parallel digital bits per sample on `uo_out[7:0]` -- wire to
  an external R-2R ladder DAC for analog audio. See `docs/info.md` for
  the full hardware notes.

## Repository layout

- `src/tt_top.v` -- TT pinout wrapper (clock, reset, sample-rate divider)
- `src/{INNER_MODULE_NAME}.v` -- the user's graph compiled to Verilog
- `src/config.json` -- LibreLane configuration (50 MHz, 1x1 tile)
- `info.yaml` -- TT project metadata
- `docs/info.md` -- per-design datasheet rendered on tinytapeout.com
- `test/` -- cocotb smoke test (`make` runs it)

## Submitting

See `SUBMIT.md` for end-to-end instructions for uploading this project
to a Tiny Tapeout shuttle.

## License

MIT (see `LICENSE`). Projects on Tiny Tapeout shuttles are also published
under the shuttle's open-source terms.
"""


GITIGNORE = """\
.DS_Store
.idea
*.vcd
*.fst
*.fst.hier
runs
tt_submission
src/user_config.json
src/config_merged.json
test/sim_build
test/__pycache__/
test/results.xml
test/gate_level_netlist.v
"""


LICENSE_TEXT = """\
MIT License

Copyright (c) 2026 ChipBlocks contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
"""


# ---------------------------------------------------------------------------
# SUBMIT.md — handed to the user inside the bundle
# ---------------------------------------------------------------------------

SUBMIT_MD = f"""\
# Submitting your ChipBlocks chip to Tiny Tapeout

This zip contains everything Tiny Tapeout's submission CI requires --
the layout matches the upstream `TinyTapeout/ttsky-verilog-template`
exactly, so submission is a small number of mechanical steps.

## What's in this zip

```
src/
    tt_top.v             -- TT pinout wrapper (with sample-rate divider)
    {INNER_MODULE_NAME}.v    -- your graph compiled to Verilog
    config.json          -- LibreLane place-and-route config
test/
    Makefile             -- cocotb make rules
    tb.v                 -- testbench Verilog skeleton
    test.py              -- cocotb smoke test
    requirements.txt     -- pip pins for the test runner
    tb.gtkw              -- GTKWave save file
docs/
    info.md              -- datasheet TT renders on tinytapeout.com
info.yaml                -- TT project metadata (yaml_version: 6)
README.md                -- project README for the GitHub repo
LICENSE                  -- MIT
.gitignore               -- standard TT project gitignore
SUBMIT.md                -- this file
```

The `info.yaml`, `docs/info.md`, `src/`, and `test/` files are all in
the layout the TinyTapeout CI expects -- you can submit this as-is.

## Active shuttles (verify on tinytapeout.com before submitting)

- **TTSKY26a** -- SkyWater 130 nm. Closing 11 May 2026 (very soon!).
- **TTGF26a** -- GlobalFoundries 180 nm. Closing 22 June 2026.

The wrapper claims `clock_hz: {TT_CLOCK_HZ}` (50 MHz), which matches the
default LibreLane `CLOCK_PERIOD: 20ns` in both shuttles. The TT demo
board's RP2040 clock generator can be configured to run the chip at a
different rate at runtime if you want.

## How to submit

1. **Create a new GitHub repo from the upstream template:**
   - For TTSKY26a: https://github.com/TinyTapeout/ttsky-verilog-template
   - For TTGF26a: https://github.com/TinyTapeout/ttgf-verilog-template

   Click "Use this template" -> "Create a new repository". Name it
   whatever you like; the name doesn't matter to TT.

2. **Replace the template's contents with this zip's contents.** Unzip
   on top of your fresh clone, overwriting:
   - `info.yaml` (replaces the placeholder)
   - `src/tt_top.v` and `src/{INNER_MODULE_NAME}.v` (replace `src/project.v`,
     which you can delete)
   - `src/config.json` (identical to the template's, but included for
     drop-in completeness)
   - `docs/info.md`
   - `test/Makefile`, `test/tb.v`, `test/test.py`, `test/requirements.txt`
   - `README.md`, `.gitignore`, `LICENSE`

3. **Edit `info.yaml` (one optional one-line change):**
   - `discord:` -- if you want TT to ping you on Discord about the
     submission, fill this in. Otherwise leave blank.
   The other fields (title, author, description, top_module) are
   already filled in with sensible values; you can edit them if you
   want a different name or attribution.

4. **Push to GitHub.** The template's GitHub Actions automatically run
   the test, lint, and (after submission) the LibreLane harden pass.
   Wait for the green checkmark on your repo's Actions tab. If
   anything fails, check the logs and fix.

5. **Submit the repository URL** through the TT submission portal:
   https://app.tinytapeout.com/

6. Wait for tape-out. Typical turnaround: ~6 months from submission
   deadline to a physical chip in your mailbox.

## Audio output wiring

ChipBlocks chips expose 8 parallel bits of audio on `uo_out[7:0]`. To
listen to the chip on real hardware:

- Wire each `uo_out[i]` pin to one resistor of an **R-2R ladder DAC**
  (16 resistors total: 8 of value R, 8 of value 2R). The DAC's analog
  output drives an op-amp buffer or a small headphone amplifier.
- Connect the buffer's output to a speaker or line-in jack.

The bidirectional `uio[7:0]` pins and the dedicated inputs `ui[7:0]`
are not used and can be left unconnected.

## Cost & licensing

- Tiny Tapeout charges a per-tile submission fee (around USD 300 for a
  1x1 tile -- check the shuttle page for the exact figure). ChipBlocks
  itself is free and MIT-licensed; you pay TT directly.
- Your design is published open-source under the shuttle's terms (Apache
  2.0 / CERN-OHL). If you want a closed-source design, TT is the wrong
  path.

## Help

- Tiny Tapeout discord: https://tinytapeout.com/discord
- ChipBlocks issue tracker: https://chipblocks.app
- TT submission portal: https://app.tinytapeout.com/
"""


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def build_tinytapeout(
    graph: dict,
    out_dir: Path,
    project_name: str | None = None,
    author: str = "ChipBlocks user",
    description: str = (
        "Audio synthesis chip designed visually in ChipBlocks "
        "(https://chipblocks.app). Eight dedicated output pins carry an "
        "8-bit unsigned audio amplitude every sample for an external "
        "R-2R DAC."
    ),
) -> dict:
    """Generate a Tiny Tapeout submission package.

    `project_name` is used to derive the unique top-module slug
    (`tt_um_<slug>`). When None, an auto-generated slug is used so two
    independent ChipBlocks builds don't collide on the shuttle.

    Returns a dict of paths to the generated files. Raises on errors --
    callers can rely on no partial bundles being left behind, since the
    zip is built last and only after all inputs exist.
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if project_name is None:
        project_name = "chipblocks"
        slug = _auto_unique_slug(project_name)
    else:
        slug = _slug(project_name)
    tt_module = f"{TT_TOP_PREFIX}{slug}"

    # Layout matches TinyTapeout/ttsky-verilog-template exactly so the
    # bundle is drop-in: unzip onto a fresh clone of the template repo
    # and submit. We materialise everything to disk first, then zip it
    # at the end so there are no partial bundles on errors.
    src_dir = out_dir / "src"
    src_dir.mkdir(exist_ok=True)
    test_dir = out_dir / "test"
    test_dir.mkdir(exist_ok=True)
    docs_dir = out_dir / "docs"
    docs_dir.mkdir(exist_ok=True)

    # 1. src/chipblocks_user.v -- the user's graph as Verilog.
    inner_v_path = src_dir / f"{INNER_MODULE_NAME}.v"
    _emit_inner_verilog(graph, inner_v_path)

    # 2. src/tt_top.v -- the TT pinout wrapper.
    wrapper_path = src_dir / "tt_top.v"
    wrapper_path.write_text(_build_wrapper(tt_module))

    # 3. src/config.json -- LibreLane place-and-route configuration.
    config_json_path = src_dir / "config.json"
    config_json_path.write_text(CONFIG_JSON)

    # 4. info.yaml -- TT project metadata.
    info_yaml_path = out_dir / "info.yaml"
    info_yaml_path.write_text(
        _build_info_yaml(project_name, tt_module, author, description)
    )

    # 5. docs/info.md -- per-design datasheet.
    docs_path = docs_dir / "info.md"
    docs_path.write_text(_build_docs_info_md(project_name))

    # 6. test/* -- cocotb testbench so TT's test CI passes.
    makefile_path = test_dir / "Makefile"
    makefile_path.write_text(TEST_MAKEFILE)
    tb_v_path = test_dir / "tb.v"
    tb_v_path.write_text(_build_tb_v(tt_module))
    test_py_path = test_dir / "test.py"
    test_py_path.write_text(TEST_PY)
    requirements_path = test_dir / "requirements.txt"
    requirements_path.write_text(TEST_REQUIREMENTS_TXT)
    tb_gtkw_path = test_dir / "tb.gtkw"
    tb_gtkw_path.write_text(TEST_TB_GTKW)

    # 7. Top-level repo files: README, LICENSE, .gitignore, SUBMIT.md.
    readme_path = out_dir / "README.md"
    readme_path.write_text(_build_readme(project_name, tt_module))
    license_path = out_dir / "LICENSE"
    license_path.write_text(LICENSE_TEXT)
    gitignore_path = out_dir / ".gitignore"
    gitignore_path.write_text(GITIGNORE)
    submit_md_path = out_dir / "SUBMIT.md"
    submit_md_path.write_text(SUBMIT_MD)

    # 8. Bundle into a single zip with the same internal paths.
    bundle_path = out_dir / "chipblocks-tt.zip"
    with zipfile.ZipFile(bundle_path, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(wrapper_path, "src/tt_top.v")
        z.write(inner_v_path, f"src/{INNER_MODULE_NAME}.v")
        z.write(config_json_path, "src/config.json")
        z.write(info_yaml_path, "info.yaml")
        z.write(docs_path, "docs/info.md")
        z.write(makefile_path, "test/Makefile")
        z.write(tb_v_path, "test/tb.v")
        z.write(test_py_path, "test/test.py")
        z.write(requirements_path, "test/requirements.txt")
        z.write(tb_gtkw_path, "test/tb.gtkw")
        z.write(readme_path, "README.md")
        z.write(license_path, "LICENSE")
        z.write(gitignore_path, ".gitignore")
        z.write(submit_md_path, "SUBMIT.md")

    return {
        "tt_module": tt_module,
        "project_name": project_name,
        "verilog_path": inner_v_path,
        "wrapper_path": wrapper_path,
        "config_json_path": config_json_path,
        "info_yaml_path": info_yaml_path,
        "docs_path": docs_path,
        "test_makefile_path": makefile_path,
        "test_tb_v_path": tb_v_path,
        "test_py_path": test_py_path,
        "test_requirements_path": requirements_path,
        "test_tb_gtkw_path": tb_gtkw_path,
        "readme_path": readme_path,
        "license_path": license_path,
        "gitignore_path": gitignore_path,
        "submit_md_path": submit_md_path,
        "bundle_path": bundle_path,
    }

"""
tinytapeout.py — Generate a Tiny Tapeout submission package from a graph.

Tiny Tapeout (https://tinytapeout.com) is a quarterly community shuttle that
fabricates user-submitted designs at SkyWater 130 nm and ships back real
ASIC chips. Unlike the FPGA path, **TT runs the synth + place + route on
their infrastructure** after submission — we just emit the source files in
the shape they require.

What this module produces (all zipped into chipblocks-tt.zip):

    tt_top.v             Thin Verilog wrapper exposing TT's standard pin
                         layout (ui_in, uo_out, uio_*, ena, clk, rst_n).
                         Routes the user's 8-bit signed audio onto the
                         eight dedicated outputs uo_out[7:0] for parallel
                         R-2R-DAC playback.
    chipblocks_user.v    The user's graph as Verilog (output of
                         amaranth.back.verilog.convert on a TT-flavoured
                         GraphTop wrapper that exposes `audio_in_u`).
    info.yaml            TT project metadata (yaml_version 6 schema —
                         current as of TT10 / TTSKY26a as of May 2026).
    docs/info.md         User-facing project description (TT renders this
                         into a per-design datasheet on tinytapeout.com).
    SUBMIT.md            ChipBlocks-side instructions: how to take this
                         zip and turn it into a real submission.

Spec sources (verified May 2026):
    - https://tinytapeout.com/specs/pinouts/   pin layout
    - https://github.com/TinyTapeout/tt10-verilog-template   info.yaml schema
    - https://github.com/TinyTapeout/ttsky-verilog-template  current shuttle
"""

from __future__ import annotations

import json
import sys
import zipfile
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))

from amaranth import Elaboratable, Module, Signal  # noqa: E402
from amaranth.back import verilog  # noqa: E402

from synth import GraphTop, SAMPLE_RATE  # noqa: E402


# Tiny Tapeout cohort defaults. We pick 50 MHz because TT's RP2040-based
# demo board defaults to that for digital designs (see tinytapeout.com/specs/clock).
TT_CLOCK_HZ = 50_000_000

# Tiny Tapeout top-module naming convention. Must start with `tt_um_` and
# be unique on the shuttle. We append a project-name slug to differentiate.
TT_TOP_PREFIX = "tt_um_"

# Inner module name (the user's graph as Verilog). Kept distinct from the
# TT wrapper so the wrapper can `module tt_um_chipblocks(...) ... endmodule`
# and instantiate `chipblocks_user inst (...)` cleanly.
INNER_MODULE_NAME = "chipblocks_user"


class TinyTapeoutInner(Elaboratable):
    """Amaranth wrapper that exposes the graph's audio output as a top-level
    8-bit unsigned port.

    The Tiny Tapeout flow does its own clock/reset wiring at the wrapper
    level, so this inner module is just GraphTop + a sign-shift on the
    audio (signed -128..+127 -> unsigned 0..255), no clock divider, no PWM.
    The 8 bits go directly out a single port that the wrapper routes to
    `uo_out[7:0]`.
    """

    def __init__(self, graph: dict):
        self.inner = GraphTop(graph)
        # 8-bit unsigned audio amplitude exposed to the TT wrapper.
        self.audio_out = Signal(8)

    def elaborate(self, platform):
        m = Module()
        m.submodules.inner = self.inner
        # Convert signed audio to unsigned by adding 128 (offset binary).
        # Same transformation the iCEstick PWM path does, but here we
        # surface all 8 bits instead of squeezing through a 1-bit PWM.
        signed_audio = self.inner.output_block.audio_in
        m.d.comb += self.audio_out.eq((signed_audio + 128).as_unsigned())
        return m


def _emit_inner_verilog(graph: dict, out_path: Path) -> None:
    """Generate the user-graph Verilog file (chipblocks_user.v).

    The emitted module is named INNER_MODULE_NAME and exposes:
        input  clk            (Amaranth's default sync-domain clock)
        input  rst            (Amaranth's default sync-domain reset)
        output [7:0] audio_out (unsigned audio amplitude)
    """
    top = TinyTapeoutInner(graph)
    text = verilog.convert(
        top,
        name=INNER_MODULE_NAME,
        ports=[top.audio_out],
        emit_src=False,
    )
    out_path.write_text(text)


def _slug(name: str) -> str:
    """Sanitize a project name into a Verilog-identifier-safe slug.

    TT requires `tt_um_<slug>` to be a legal Verilog identifier and unique
    on the shuttle. We lowercase, keep alnum + underscore, collapse
    consecutive underscores, and strip leading digits.
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


# ---------------------------------------------------------------------------
# Verilog wrapper template (tt_top.v)
# ---------------------------------------------------------------------------
# Plain Verilog by design — easier for TT reviewers to read than emitting
# this through Amaranth. Pin layout comes from
# https://tinytapeout.com/specs/pinouts/ verified May 2026.

WRAPPER_TEMPLATE = """\
/*
 * tt_top.v -- Tiny Tapeout wrapper for a ChipBlocks-generated audio chip.
 *
 * ChipBlocks (https://chipblocks.app) is a free, open-source visual
 * chip-design app. The user drags audio-synth blocks onto a canvas, wires
 * them, and presses "Build for Tiny Tapeout" -- which produces this
 * wrapper plus the user's graph compiled to Verilog (chipblocks_user.v).
 *
 * What this wrapper does:
 *   - Connects the TT shuttle's clock and active-low reset to the
 *     ChipBlocks-generated module (which uses an active-high reset
 *     internally, so we invert).
 *   - Drives the inner module continuously: ChipBlocks chips are
 *     self-clocking audio generators with no per-cycle inputs to wait on.
 *   - Routes the inner module's 8-bit unsigned audio amplitude to
 *     `uo_out[7:0]` so the user can wire those eight pins to a parallel
 *     R-2R ladder DAC (or a parallel-input audio DAC chip) for analog
 *     playback. This is much higher fidelity than the iCEstick path's
 *     1-bit PWM -- 256 levels straight off the chip vs. 2.
 *   - Ties off the unused TT pins (`ui_in`, `uio_*`) so the lint passes.
 *
 * Audio sample rate inside the chip:
 *   The graph runs at the TT cohort clock speed ({clock_hz} Hz). The
 *   ChipBlocks block library generates samples at {sample_rate} Hz, so
 *   each "audio sample" lasts about {clock_hz}/{sample_rate} = {ticks_per_sample}
 *   clock ticks. We don't need a divider at this layer -- the inner
 *   module's ramp counters (oscillator, ADSR, etc.) advance every cycle,
 *   and the natural timing falls out of the clock frequency. If a future
 *   cohort runs at a different clock, the audio pitch shifts; rebuild
 *   from the same graph at the new frequency to retune.
 *
 * Copyright 2026 ChipBlocks contributors. SPDX-License-Identifier: MIT
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
  // Audio bus from the ChipBlocks-generated graph.
  // ------------------------------------------------------------------
  wire [7:0] audio_amplitude;

  // ChipBlocks-generated module (Amaranth uses active-HIGH reset by
  // default, so invert TT's active-low rst_n on the way in).
  {inner_module} u_chipblocks (
      .clk       (clk),
      .rst       (~rst_n),
      .audio_out (audio_amplitude)
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
    return WRAPPER_TEMPLATE.format(
        tt_module=tt_module,
        inner_module=INNER_MODULE_NAME,
        clock_hz=TT_CLOCK_HZ,
        clock_mhz=TT_CLOCK_HZ // 1_000_000,
        sample_rate=SAMPLE_RATE,
        ticks_per_sample=TT_CLOCK_HZ // SAMPLE_RATE,
    )


# ---------------------------------------------------------------------------
# info.yaml — TT project metadata (yaml_version: 6, current as of TT10/TTSKY26)
# ---------------------------------------------------------------------------

def _build_info_yaml(project_name: str, tt_module: str) -> str:
    """Build info.yaml content. Schema per yaml_version: 6.

    All 24 pinout slots are listed even when unused, because TT's lint pass
    rejects a partial pinout block.
    """
    info = {
        "project": {
            "title": f"ChipBlocks-generated audio chip ({project_name})",
            "author": project_name,
            "discord": "",
            "description": (
                "Audio synthesis chip designed visually in ChipBlocks "
                "(https://chipblocks.app). Drag blocks, wire them, get an "
                "ASIC. The eight dedicated outputs carry an 8-bit unsigned "
                "audio amplitude -- wire them to an R-2R ladder DAC for "
                "analog audio."
            ),
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
            "ui[0]": "unused",
            "ui[1]": "unused",
            "ui[2]": "unused",
            "ui[3]": "unused",
            "ui[4]": "unused",
            "ui[5]": "unused",
            "ui[6]": "unused",
            "ui[7]": "unused",
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
            "uio[0]": "unused",
            "uio[1]": "unused",
            "uio[2]": "unused",
            "uio[3]": "unused",
            "uio[4]": "unused",
            "uio[5]": "unused",
            "uio[6]": "unused",
            "uio[7]": "unused",
        },
        "yaml_version": 6,
    }
    # sort_keys=False preserves the order TT's tooling expects (project block
    # before pinout, yaml_version last). default_flow_style=False keeps the
    # block style throughout for human readability.
    return yaml.safe_dump(info, sort_keys=False, default_flow_style=False)


# ---------------------------------------------------------------------------
# docs/info.md — TT renders this to a per-design datasheet
# ---------------------------------------------------------------------------

def _build_docs_info_md(project_name: str) -> str:
    return f"""\
<!---

Datasheet for the ChipBlocks-generated audio chip submitted to Tiny Tapeout.
ChipBlocks: https://chipblocks.app -- visual node-graph chip designer.

-->

## How it works

This chip is an audio synthesizer composed entirely of building blocks wired
together visually in ChipBlocks. The user drags blocks (oscillators, ADSR
envelopes, mixers, low-pass filters, FM operators, etc.) onto a canvas,
connects them with audio cables, and presses "Build for Tiny Tapeout" --
the app translates the graph into Verilog and packages it for submission.

The synthesizer is **self-clocking**: it has no per-cycle inputs and no
external triggers. Power it up, supply a clock, and audio appears on
`uo_out[7:0]` as an 8-bit unsigned amplitude every cycle. Internal block
behavior (oscillator phase counters, ADSR ramps, gate timers, etc.) is
driven entirely by the shuttle clock.

The chip targets a {TT_CLOCK_HZ // 1_000_000} MHz clock. At that rate, the
graph generates audio samples at {SAMPLE_RATE} Hz internally
(~{TT_CLOCK_HZ // SAMPLE_RATE} clock ticks per audio sample). If the
shuttle runs at a different clock frequency, the audio pitch will shift
proportionally.

## How to test

**To listen to the chip you need an external 8-bit DAC** (the chip's outputs
are digital -- 8 parallel bits of amplitude, not a single analog signal):

1. Wire `uo_out[7:0]` to an **R-2R ladder DAC** (8 resistors of value R, 8
   resistors of value 2R) with the output node tied to the input of an op-amp
   buffer or directly to a small headphone driver.
2. Connect the buffer/driver output to a speaker or line-in.
3. Apply power, supply the {TT_CLOCK_HZ // 1_000_000} MHz clock, and release
   reset (`rst_n` high).
4. Audio plays continuously at {SAMPLE_RATE} Hz sample rate.

For verification before tape-out, a Verilator testbench can sample
`uo_out` at {SAMPLE_RATE} Hz (one read per {TT_CLOCK_HZ // SAMPLE_RATE}
clock ticks) and write a WAV file -- the same audio the ChipBlocks app's
in-browser preview produced.

## External hardware

- **R-2R ladder DAC** -- 16 resistors total. Cheap (a few cents) and works
  with any digital pins. Resolution: 8 bits = 256 amplitude levels = ~48 dB
  dynamic range.
- **Audio amplifier** -- e.g. a PAM8403 board or a discrete op-amp -- to
  drive a speaker from the DAC's high-impedance output.
- **Speaker** -- 8 ohm or headphones (with a series resistor).

The bidirectional `uio[7:0]` pins and dedicated inputs `ui[7:0]` are not
used by this design and can be left unconnected.

---

Built in ChipBlocks ({project_name} project). Source app: https://chipblocks.app
"""


# ---------------------------------------------------------------------------
# SUBMIT.md — handed to the user inside the bundle
# ---------------------------------------------------------------------------

SUBMIT_MD = """\
# Submitting your ChipBlocks chip to Tiny Tapeout

This zip contains everything you need to submit your ChipBlocks-designed
chip to a Tiny Tapeout shuttle. Tiny Tapeout (https://tinytapeout.com) is a
quarterly community fab run that takes user-submitted designs, packs them
onto a single SkyWater 130 nm die, and ships back working ASIC chips a few
months later.

## What's in this zip

| File | Purpose |
|---|---|
| `tt_top.v` | Verilog wrapper exposing TT's standard pin layout. Don't edit. |
| `chipblocks_user.v` | Your graph compiled to Verilog. Don't edit. |
| `info.yaml` | TT project metadata. You'll likely want to edit `title`, `author`, `discord` before submitting. |
| `docs/info.md` | Datasheet TT renders for your project. Edit to taste. |
| `SUBMIT.md` | This file. |

## How to submit

1. Go to https://tinytapeout.com and check the **current open shuttle**
   (e.g. TTSKY26a, TTGF26a). The shuttles open and close on a published
   schedule -- if none are open, check the next-deadline date.

2. **Fork the shuttle's submission template repo** (linked from the
   shuttle page on tinytapeout.com -- typically `TinyTapeout/ttXX-verilog-template`).

3. **Replace the template's contents with this zip's contents:**
   - Copy `tt_top.v` and `chipblocks_user.v` into `src/`.
   - Replace the template's `info.yaml` with this one (edit author + title
     fields first if you want).
   - Replace `docs/info.md` with this one.

4. **Edit `info.yaml`:**
   - Set `title` to a one-line description of your chip.
   - Set `author` to your name (this appears on the chip's datasheet page).
   - Optional: add a `discord` handle so TT can contact you about issues.
   - Make sure `top_module` is unique on the shuttle (the template README
     covers naming collisions -- typically you append your GitHub username).

5. **Push to GitHub** and **submit the repository URL** through the TT
   submission portal on the shuttle's page. TT's continuous integration
   runs the synthesis, place-and-route, and lint checks automatically;
   look for a green check on your pull request before the deadline.

6. Wait for tape-out. Typical turnaround: ~6 months from submission to a
   physical chip in your mailbox.

## Notes

- ChipBlocks chips use only the **8 dedicated outputs** (`uo_out[7:0]`)
  for an 8-bit parallel audio amplitude. To listen to the chip on real
  hardware, wire those eight pins to an **R-2R ladder DAC** and feed the
  result into an audio amplifier + speaker.
- The chip is self-clocking: it generates audio continuously once power +
  clock + `rst_n` high are supplied. There are no per-cycle inputs.
- This is the audio path. ChipBlocks does not currently emit
  designs that use TT's bidirectional pins or analog templates.
- If TT's submission format changes (a new `yaml_version`, a renamed pin,
  etc.), regenerate this bundle from the latest ChipBlocks build.

## Cost & licensing

- Tiny Tapeout charges a per-tile submission fee (currently around $300 for
  a 1x1 tile -- check the shuttle page for the exact figure). ChipBlocks
  itself is free and MIT-licensed; you pay TT directly.
- Your design is published open-source under the shuttle's license terms
  (typically Apache 2.0 / CERN-OHL). If you want a closed-source design,
  TT is the wrong path.

## Help

- Tiny Tapeout discord: https://tinytapeout.com (link from the homepage)
- ChipBlocks issue tracker: https://chipblocks.app
"""


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def build_tinytapeout(
    graph: dict,
    out_dir: Path,
    project_name: str = "chipblocks",
) -> dict:
    """Generate a Tiny Tapeout submission package.

    Returns a dict of paths to the generated files. Raises on errors --
    callers can rely on no partial bundles being left behind, since the
    zip is built last and only after all five inputs exist.
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    slug = _slug(project_name)
    tt_module = f"{TT_TOP_PREFIX}{slug}"

    # 1. Emit the user's graph as Verilog (via Amaranth -> Yosys).
    verilog_path = out_dir / f"{INNER_MODULE_NAME}.v"
    _emit_inner_verilog(graph, verilog_path)

    # 2. Emit the thin Verilog wrapper.
    wrapper_path = out_dir / "tt_top.v"
    wrapper_path.write_text(_build_wrapper(tt_module))

    # 3. info.yaml.
    info_yaml_path = out_dir / "info.yaml"
    info_yaml_path.write_text(_build_info_yaml(project_name, tt_module))

    # 4. docs/info.md.
    docs_dir = out_dir / "docs"
    docs_dir.mkdir(exist_ok=True)
    docs_path = docs_dir / "info.md"
    docs_path.write_text(_build_docs_info_md(project_name))

    # 5. SUBMIT.md.
    submit_md_path = out_dir / "SUBMIT.md"
    submit_md_path.write_text(SUBMIT_MD)

    # 6. Bundle into a single zip.
    bundle_path = out_dir / "chipblocks-tt.zip"
    with zipfile.ZipFile(bundle_path, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(wrapper_path, "tt_top.v")
        z.write(verilog_path, f"{INNER_MODULE_NAME}.v")
        z.write(info_yaml_path, "info.yaml")
        z.write(docs_path, "docs/info.md")
        z.write(submit_md_path, "SUBMIT.md")

    return {
        "verilog_path": verilog_path,
        "wrapper_path": wrapper_path,
        "info_yaml_path": info_yaml_path,
        "docs_path": docs_path,
        "submit_md_path": submit_md_path,
        "bundle_path": bundle_path,
    }

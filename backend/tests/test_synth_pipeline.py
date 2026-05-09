"""
End-to-end pipeline tests.

These verify the synth pipeline against real example JSON saved in the
repo's `examples/` directory, plus a handful of edge cases (invalid
block type, empty graph, etc.).
"""

from __future__ import annotations

import json
import shutil
import zipfile
from pathlib import Path

import pytest


def _load_example(examples_dir, name: str) -> dict:
    with open(examples_dir / name, "r", encoding="utf-8") as f:
        return json.load(f)


def _toolchain_available() -> bool:
    """The FPGA pipeline needs Yosys + nextpnr-ice40 + icepack on PATH.
    On developer boxes the OSS CAD Suite has to be sourced first; CI
    workers usually skip this entirely. Either way we just probe for the
    binaries and skip if any are missing rather than failing the suite."""
    return all(
        shutil.which(tool) is not None
        for tool in ("yosys", "nextpnr-ice40", "icepack")
    )


def test_loads_two_osc_mix_example(run_synth, wav_samples, examples_dir):
    graph = _load_example(examples_dir, "two-osc-mix.json")
    samples = wav_samples(run_synth(graph, duration_s=1))
    assert any(s != 0 for s in samples), (
        "two-osc-mix.json synthesis returned all zeros"
    )


def test_loads_kick_drum_example(run_synth, wav_samples, examples_dir):
    """Kick drum is a sine through an ADSR gated by a 2 Hz Gate. The
    audio is silent during the gate-off phase but loud during gate-on."""
    graph = _load_example(examples_dir, "kick-drum.json")
    # Run for 2 seconds — at rate_hz=2 the gate fires twice per second so
    # we're guaranteed to capture at least one full hit.
    samples = wav_samples(run_synth(graph, duration_s=2))
    # Most samples are silent (gate off), but the peak is well above zero.
    peak = max(abs(s) for s in samples)
    assert peak > 100, (
        f"kick-drum.json: peak amplitude {peak} is suspiciously low; "
        "expected an audible spike during the gate window"
    )


def test_save_format_v1_round_trip(run_synth, examples_dir):
    """Every example's save format must be parseable by synth.synthesize
    without raising — proves the on-disk schema is still v1-compatible."""
    for name in (
        "two-osc-mix.json",
        "kick-drum.json",
        "adsr-pulse.json",
        "arpeggio.json",
        "bass-lead.json",
        "lofi-pad.json",
        "snare-drum.json",
    ):
        graph = _load_example(examples_dir, name)
        # Should not raise. Use 1s of audio to keep the test snappy.
        wav_bytes = run_synth(graph, duration_s=1)
        assert wav_bytes.startswith(b"RIFF"), (
            f"{name}: synth output is not a valid RIFF/WAV stream"
        )


def test_invalid_block_type_raises():
    """Unknown block `type` should raise a clean ValueError, not crash."""
    # Import here to avoid an import-time error if synth fails at load.
    import synth

    graph = {
        "nodes": [
            {"id": "x", "type": "doesnotexist", "data": {}},
            {"id": "out", "type": "output", "data": {}},
        ],
        "edges": [],
    }
    with pytest.raises(ValueError, match="Unknown block type"):
        synth.synthesize(graph, duration_s=1)


def test_icebreaker_board_profile_registered():
    """The iCEBreaker should be wired into the FPGA target table with
    the chip family + package the open iCE40 toolchain expects, and the
    bundle filename pattern the IPC layer keys off."""
    from build import ALL_BOARDS

    assert "icebreaker" in ALL_BOARDS, (
        "iCEBreaker missing from ALL_BOARDS — --target icebreaker won't resolve"
    )
    board = ALL_BOARDS["icebreaker"]
    assert board.id == "icebreaker"
    assert board.chip_family == "up5k"
    assert board.package == "sg48"
    assert board.clock_hz == 12_000_000
    # PCF template must reference both the clock and audio pins by name
    # — otherwise nextpnr would refuse the pin assignment at PnR.
    rendered_pcf = board.pcf_template.format(
        clock_pin=board.clock_pin,
        audio_pin=board.audio_pin,
    )
    assert f"set_io clk {board.clock_pin}" in rendered_pcf
    assert f"set_io audio_pin {board.audio_pin}" in rendered_pcf


def test_visual_graph_without_audio_output_fails_friendly():
    """A graph with VGA Timing + Color Bars + VGA Output but no audio
    Output should fail ▶ Play with the friendly hint pointing the user
    at 🔧 Build → iCEBreaker — not the generic 'Graph has no Output
    block' message.
    """
    import synth

    graph = {
        "nodes": [
            {"id": "vt", "type": "vgatiming", "data": {}},
            {"id": "cb", "type": "colorbars", "data": {}},
            {"id": "vo", "type": "vgaoutput", "data": {}},
        ],
        "edges": [
            {"id": "e1", "source": "vt", "target": "cb",
             "sourceHandle": "x", "targetHandle": "x"},
            {"id": "e2", "source": "vt", "target": "cb",
             "sourceHandle": "visible", "targetHandle": "visible"},
            {"id": "e3", "source": "cb", "target": "vo",
             "sourceHandle": "r", "targetHandle": "r"},
            {"id": "e4", "source": "cb", "target": "vo",
             "sourceHandle": "g", "targetHandle": "g"},
            {"id": "e5", "source": "cb", "target": "vo",
             "sourceHandle": "b", "targetHandle": "b"},
            {"id": "e6", "source": "vt", "target": "vo",
             "sourceHandle": "hsync", "targetHandle": "hsync"},
            {"id": "e7", "source": "vt", "target": "vo",
             "sourceHandle": "vsync", "targetHandle": "vsync"},
        ],
    }

    with pytest.raises(ValueError, match="visual outputs but no audio Output"):
        synth.synthesize(graph, duration_s=1)


def test_mixed_audio_and_visual_graph_rejected_on_build():
    """A graph with both an audio Output and a VGA Output should fail
    BoardTop construction with a friendly message rather than silently
    downgrading the audio path. Tracked in KNOWN-ISSUES — proper fix is
    multi-domain clock plumbing in BoardTop (Phase 3).
    """
    import build

    graph = {
        "nodes": [
            {"id": "osc", "type": "oscillator", "data": {"freq": 440}},
            {"id": "out", "type": "output", "data": {}},
            {"id": "vt", "type": "vgatiming", "data": {}},
            {"id": "cb", "type": "colorbars", "data": {}},
            {"id": "vo", "type": "vgaoutput", "data": {}},
        ],
        "edges": [
            {"id": "e1", "source": "osc", "target": "out",
             "sourceHandle": "audio-out", "targetHandle": "audio-in"},
            {"id": "e2", "source": "vt", "target": "cb",
             "sourceHandle": "x", "targetHandle": "x"},
            {"id": "e3", "source": "vt", "target": "cb",
             "sourceHandle": "visible", "targetHandle": "visible"},
            {"id": "e4", "source": "cb", "target": "vo",
             "sourceHandle": "r", "targetHandle": "r"},
            {"id": "e5", "source": "cb", "target": "vo",
             "sourceHandle": "g", "targetHandle": "g"},
            {"id": "e6", "source": "cb", "target": "vo",
             "sourceHandle": "b", "targetHandle": "b"},
            {"id": "e7", "source": "vt", "target": "vo",
             "sourceHandle": "hsync", "targetHandle": "hsync"},
            {"id": "e8", "source": "vt", "target": "vo",
             "sourceHandle": "vsync", "targetHandle": "vsync"},
        ],
    }

    with pytest.raises(ValueError, match="mix audio Output and VGA Output"):
        build.BoardTop(graph, build.ICEBREAKER)


def test_visual_graph_pcf_contains_vga_pin_assignments(tmp_path: Path, examples_dir: Path):
    """The .pcf for an iCEBreaker build of a visual graph must contain
    each of the 5 VGA pin assignments (R, G, B, HSYNC, VSYNC) on the
    canonical PMOD1B pin numbers from amaranth_boards/icebreaker.py.

    No external toolchain needed — we only run emit_verilog + the .pcf
    string-formatting paths, which are pure Python.
    """
    from build import ALL_BOARDS, _graph_has_vga_output, ICEBREAKER, emit_verilog

    graph = _load_example(examples_dir, "color-bars.json")
    assert _graph_has_vga_output(graph), "color-bars example missing vgaoutput"

    # emit_verilog must succeed and the .pcf assembly must reference
    # all 5 VGA pin-name lines.
    emit_verilog(graph, tmp_path, ICEBREAKER)
    pcf_text = ICEBREAKER.pcf_template.format(
        clock_pin=ICEBREAKER.clock_pin, audio_pin=ICEBREAKER.audio_pin
    )
    pcf_text += "\n" + ICEBREAKER.vga_pcf_template.format(**ICEBREAKER.vga_pins)

    for line in (
        "set_io vga_r 43",
        "set_io vga_g 38",
        "set_io vga_b 34",
        "set_io vga_hsync 31",
        "set_io vga_vsync 42",
    ):
        assert line in pcf_text, f"iCEBreaker VGA .pcf missing line: {line!r}"


@pytest.mark.skipif(
    not _toolchain_available(),
    reason="Yosys / nextpnr-ice40 / icepack not on PATH (OSS CAD Suite not sourced)",
)
def test_visual_graph_builds_to_icebreaker_bitstream(tmp_path: Path, examples_dir: Path):
    """Run the full graph -> Verilog -> Yosys -> nextpnr-ice40 ->
    icepack chain for the color-bars example and verify the bitstream
    is non-empty and the .pcf contains the VGA assignments.

    Skipped when the toolchain isn't installed.
    """
    from build import ALL_BOARDS, build_fpga, make_bundle

    graph = _load_example(examples_dir, "color-bars.json")
    board = ALL_BOARDS["icebreaker"]
    result = build_fpga(graph, tmp_path, board)
    bundle_path = make_bundle(tmp_path, graph, result)

    bin_path = Path(result["bin"])
    assert bin_path.exists() and bin_path.stat().st_size > 0, (
        "color-bars iCEBreaker .bin is missing or empty"
    )

    pcf_text = Path(result["pcf"]).read_text()
    for line in (
        "set_io vga_r 43",
        "set_io vga_g 38",
        "set_io vga_b 34",
        "set_io vga_hsync 31",
        "set_io vga_vsync 42",
    ):
        assert line in pcf_text, (
            f"color-bars iCEBreaker .pcf missing line: {line!r}"
        )

    # Bundle still has the canonical filename pattern.
    assert bundle_path.name == "chipblocks-fpga-icebreaker.zip"


@pytest.mark.skipif(
    not _toolchain_available(),
    reason="Yosys / nextpnr-ice40 / icepack not on PATH (OSS CAD Suite not sourced)",
)
def test_icebreaker_full_pipeline_against_example(tmp_path: Path, examples_dir: Path):
    """Run the actual graph -> Verilog -> Yosys -> nextpnr-ice40 ->
    icepack chain for the iCEBreaker against a real example graph and
    verify the bundle is well-formed (non-zero .bin, expected files).
    Skipped when the toolchain isn't installed."""
    from build import ALL_BOARDS, build_fpga, make_bundle

    graph = _load_example(examples_dir, "two-osc-mix.json")
    board = ALL_BOARDS["icebreaker"]

    result = build_fpga(graph, tmp_path, board)
    bundle_path = make_bundle(tmp_path, graph, result)

    # Bitstream must exist and be non-empty (an empty .bin would mean
    # icepack swallowed an error).
    bin_path = Path(result["bin"])
    assert bin_path.exists()
    assert bin_path.stat().st_size > 0, "icebreaker .bin is zero bytes"

    # Bundle filename must match the pattern the renderer's IPC layer
    # parses out of the [bundle] marker.
    assert bundle_path.name == "chipblocks-fpga-icebreaker.zip"

    with zipfile.ZipFile(bundle_path) as z:
        names = set(z.namelist())
    expected = {
        "chipblocks.bin",
        "chipblocks.v",
        "chipblocks.pcf",
        "BUILD.md",
        "FLASH.md",
    }
    missing = expected - names
    assert not missing, f"iCEBreaker bundle missing files: {missing}"

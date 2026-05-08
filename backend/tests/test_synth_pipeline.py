"""
End-to-end pipeline tests.

These verify the synth pipeline against real example JSON saved in the
repo's `examples/` directory, plus a handful of edge cases (invalid
block type, empty graph, etc.).
"""

from __future__ import annotations

import json

import pytest


def _load_example(examples_dir, name: str) -> dict:
    with open(examples_dir / name, "r", encoding="utf-8") as f:
        return json.load(f)


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

"""
test_synth.py — smoke test for the graph -> Amaranth -> WAV pipeline.

Builds a few representative graphs, runs synthesize() on each, and
checks that the resulting samples are sensible (not all zero, expected
transition counts, etc.).

Run from WSL2:
    cd /mnt/c/Users/micha/Desktop/chipzzzd/backend
    python3 sim/test_synth.py
"""

import sys
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from synth import synthesize, GraphTop  # noqa: E402

# Mute Amaranth's "<obj> created but never used" warnings — the
# invalid-graph tests intentionally construct GraphTop and Elaboratables
# without running them through the simulator.
warnings.filterwarnings("ignore", message=".*never used.*")


def make_graph_simple() -> dict:
    """Oscillator -> Mixer.in-1 -> Output (Sprint 2 default graph).

    Mixer's in-2 is unwired (defaults to 0), so mix-out = osc XOR 0 = osc.
    Output should hear a 440 Hz square wave.
    """
    return {
        "nodes": [
            {"id": "osc", "type": "oscillator", "data": {"freq": 440}},
            {"id": "mix", "type": "mixer", "data": {}},
            {"id": "out", "type": "output", "data": {}},
        ],
        "edges": [
            {"id": "e1", "source": "osc", "target": "mix",
             "sourceHandle": "audio-out", "targetHandle": "in-1"},
            {"id": "e2", "source": "mix", "target": "out",
             "sourceHandle": "mix-out", "targetHandle": "audio-in"},
        ],
    }


def make_graph_direct() -> dict:
    """Oscillator -> Output (no Mixer). Should produce same audio as
    the simple graph since Mixer with in-2=0 is identity."""
    return {
        "nodes": [
            {"id": "osc", "type": "oscillator", "data": {"freq": 220}},
            {"id": "out", "type": "output", "data": {}},
        ],
        "edges": [
            {"id": "e1", "source": "osc", "target": "out",
             "sourceHandle": "audio-out", "targetHandle": "audio-in"},
        ],
    }


def make_graph_two_oscs() -> dict:
    """Two Oscillators at different frequencies into a Mixer -> Output.
    Tests both Mixer inputs being driven; output is XOR of two
    different square waves (sounds like ring modulation)."""
    return {
        "nodes": [
            {"id": "osc1", "type": "oscillator", "data": {"freq": 440}},
            {"id": "osc2", "type": "oscillator", "data": {"freq": 660}},
            {"id": "mix", "type": "mixer", "data": {}},
            {"id": "out", "type": "output", "data": {}},
        ],
        "edges": [
            {"id": "e1", "source": "osc1", "target": "mix",
             "sourceHandle": "audio-out", "targetHandle": "in-1"},
            {"id": "e2", "source": "osc2", "target": "mix",
             "sourceHandle": "audio-out", "targetHandle": "in-2"},
            {"id": "e3", "source": "mix", "target": "out",
             "sourceHandle": "mix-out", "targetHandle": "audio-in"},
        ],
    }


def transitions(samples: list[int]) -> int:
    return sum(1 for i in range(1, len(samples)) if samples[i] != samples[i - 1])


def test_graph(name: str, graph: dict, expect_min_transitions: int = 100) -> bool:
    print(f"--- {name} ---")
    samples = synthesize(graph, duration_s=1)  # 1 second is enough for smoke test
    n = len(samples)
    t = transitions(samples)
    # 8-bit signed samples can be balanced around 0, so sum() is misleading.
    # A real signal has variance: at least some samples should differ from 0.
    has_signal = any(s != 0 for s in samples)
    sample_min = min(samples)
    sample_max = max(samples)
    print(f"  Samples: {n}, transitions: {t}, range: [{sample_min}, {sample_max}]")
    if n != 44100:
        print(f"  FAIL: expected 44100 samples, got {n}")
        return False
    if t < expect_min_transitions:
        print(f"  FAIL: expected >= {expect_min_transitions} transitions, got {t}")
        return False
    if not has_signal:
        print(f"  FAIL: all-zero output (no signal reaching Output block)")
        return False
    print(f"  PASS")
    return True


def test_invalid_graph_no_output() -> bool:
    print("--- invalid: no Output block ---")
    graph = {
        "nodes": [{"id": "osc", "type": "oscillator", "data": {"freq": 440}}],
        "edges": [],
    }
    try:
        GraphTop(graph)
    except ValueError as e:
        if "no Output block" in str(e).lower() or "output" in str(e).lower():
            print(f"  PASS (raised: {e})")
            return True
    print("  FAIL: should have raised ValueError")
    return False


def test_invalid_graph_unknown_type() -> bool:
    print("--- invalid: unknown block type ---")
    graph = {
        "nodes": [
            {"id": "x", "type": "wat-is-this", "data": {}},
            {"id": "out", "type": "output", "data": {}},
        ],
        "edges": [],
    }
    try:
        GraphTop(graph)
    except ValueError as e:
        if "unknown" in str(e).lower():
            print(f"  PASS (raised: {e})")
            return True
    print("  FAIL: should have raised ValueError")
    return False


if __name__ == "__main__":
    results = {
        "simple (osc -> mix.in-1 -> out)": test_graph(
            "simple", make_graph_simple(), expect_min_transitions=400),
        "direct (osc -> out)": test_graph(
            "direct", make_graph_direct(), expect_min_transitions=200),
        "two-osc XOR mix": test_graph(
            "two-osc", make_graph_two_oscs(), expect_min_transitions=400),
        "invalid: no Output": test_invalid_graph_no_output(),
        "invalid: unknown type": test_invalid_graph_unknown_type(),
    }
    print()
    print("=== Summary ===")
    for name, ok in results.items():
        print(f"  {name}: {'PASS' if ok else 'FAIL'}")
    sys.exit(0 if all(results.values()) else 1)

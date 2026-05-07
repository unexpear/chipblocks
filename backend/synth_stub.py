"""
synth_stub.py — Sprint 2 Item 1 stub.

Reads a graph JSON from --in, writes a WAV to --out. For Sprint 2 v1
this ignores the graph contents and produces a fixed 440 Hz square
wave — just enough to prove the Electron <-> WSL <-> Python bridge
works end-to-end. Sprint 2 Item 3 (the real graph -> Migen translator)
will replace this stub.

Usage:
    python3 synth_stub.py --in graph.json --out out.wav

Errors are emitted as a JSON blob on stderr so the Electron side can
parse them into a friendly message:
    {"error": "...", "type": "ExceptionClassName"}
"""

import argparse
import json
import struct
import sys
import wave

from migen import *


# Square-wave oscillator. Same shape as backend/sim/pwm_to_wav.py
# from Sprint 1 — kept here as a self-contained copy so the stub
# has no internal imports to worry about during development.
class _SquareOsc(Module):
    def __init__(self, pwm):
        self.enable = Signal()
        self.width = Signal(32)
        self.period = Signal(32)
        count = Signal(32)
        self.sync += [
            If(self.enable,
                If(count < self.width, pwm.eq(1)).Else(pwm.eq(0)),
                If(count == self.period - 1,
                    count.eq(0)
                ).Else(
                    count.eq(count + 1)
                )
            ).Else(
                count.eq(0),
                pwm.eq(0)
            )
        ]


SAMPLE_RATE = 44100
DURATION_S = 2
NOTE_HZ = 440


def synthesize(_graph: dict) -> list[int]:
    """Generate audio samples. Sprint 2 v1: ignores the graph."""
    period = SAMPLE_RATE // NOTE_HZ
    width = period // 2
    total_ticks = SAMPLE_RATE * DURATION_S

    pwm = Signal()
    dut = _SquareOsc(pwm)
    samples: list[int] = []

    def tb(d):
        yield d.enable.eq(1)
        yield d.width.eq(width)
        yield d.period.eq(period)
        yield
        for _ in range(total_ticks):
            samples.append((yield pwm))
            yield

    run_simulation(dut, tb(dut))
    return samples


def write_wav(samples: list[int], out_path: str) -> None:
    AMPLITUDE = 8000  # ~25% of int16 max — keep volume reasonable
    pcm = [AMPLITUDE if s else -AMPLITUDE for s in samples]
    with wave.open(out_path, "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SAMPLE_RATE)
        f.writeframes(b"".join(struct.pack("<h", v) for v in pcm))


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--in", dest="input_path", required=True, help="Path to graph JSON")
    p.add_argument("--out", dest="output_path", required=True, help="Path to write WAV")
    args = p.parse_args()

    with open(args.input_path, "r", encoding="utf-8") as f:
        graph = json.load(f)

    n_nodes = len(graph.get("nodes", []))
    n_edges = len(graph.get("edges", []))
    print(f"[synth_stub] Received graph: {n_nodes} nodes, {n_edges} edges", flush=True)

    samples = synthesize(graph)
    write_wav(samples, args.output_path)
    print(f"[synth_stub] Wrote {args.output_path}: {len(samples)} samples ({DURATION_S}s @ {SAMPLE_RATE}Hz)", flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        # Emit JSON on stderr so the Electron side can parse it as a friendly error.
        sys.stderr.write(json.dumps({"error": str(e), "type": type(e).__name__}) + "\n")
        sys.exit(1)

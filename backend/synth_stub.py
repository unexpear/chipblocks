"""
synth_stub.py — Sprint 2 Item 1 stub.

Reads a graph JSON from --in, writes a WAV to --out. For Sprint 2 v1
this ignores the graph contents and drives the Oscillator block from
the ChipForge block library at 440 Hz for 2 seconds. Item 3 (the real
graph -> Amaranth translator) will replace this stub.

Stack note: switched from Migen to Amaranth in Sprint 2 Item 2.
Amaranth is the modern successor to Migen by the same maintainers
(M-Labs); both are BSD-2-Clause so the licensing stance is unchanged.

Usage:
    python3 synth_stub.py --in graph.json --out out.wav

Errors are emitted as JSON on stderr so the Electron side can parse
them into a friendly message:
    {"error": "...", "type": "ExceptionClassName"}
"""

import argparse
import json
import struct
import sys
import wave
from pathlib import Path

# Make `from blocks import ...` work whether the script is invoked from
# backend/ or via an absolute path from elsewhere.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from amaranth.sim import Simulator  # noqa: E402
from blocks import Oscillator  # noqa: E402


SAMPLE_RATE = 44100
DURATION_S = 2
NOTE_HZ = 440


def synthesize(_graph: dict) -> list[int]:
    """Generate audio samples. Sprint 2 v1 stub: ignores the graph and
    drives the Oscillator block at NOTE_HZ for DURATION_S seconds."""
    osc = Oscillator(freq_hz=NOTE_HZ, sample_rate=SAMPLE_RATE)
    sim = Simulator(osc)
    sim.add_clock(1e-6)  # arbitrary clock period — we count ticks as samples

    samples: list[int] = []
    total_ticks = SAMPLE_RATE * DURATION_S

    async def process(ctx):
        for _ in range(total_ticks):
            samples.append(ctx.get(osc.audio_out))
            await ctx.tick()

    sim.add_testbench(process)
    sim.run()
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
    print(
        f"[synth_stub] Wrote {args.output_path}: {len(samples)} samples "
        f"({DURATION_S}s @ {SAMPLE_RATE}Hz, Amaranth Oscillator @ {NOTE_HZ}Hz)",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        sys.stderr.write(json.dumps({"error": str(e), "type": type(e).__name__}) + "\n")
        sys.exit(1)

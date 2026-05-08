"""
synth.py — Graph -> Amaranth -> WAV pipeline.

Reads a graph JSON from --in (the React Flow {nodes, edges} format),
instantiates blocks from the ChipBlocks block library according to each
node's `type`, wires edges between block ports, runs the resulting
Amaranth design in simulation, samples the Output block's `audio_in`
per cycle, and writes a 16-bit mono WAV to --out.

Sprint 2 Item 3 — replaces the earlier synth_stub.py.

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

from amaranth import Elaboratable, Module  # noqa: E402
from amaranth.sim import Simulator  # noqa: E402
from blocks import BLOCK_REGISTRY, Output  # noqa: E402


SAMPLE_RATE = 44100
DURATION_S = 2


# ---------------------------------------------------------------------------
# Parameter mapping: React Flow `node.data` fields -> block constructor kwargs.
# Each block type has its own translation; this is the only block-type-aware
# part of the translator. Keep additions narrow.
# ---------------------------------------------------------------------------
def _build_params(node_type: str, data: dict) -> dict:
    params: dict = {}
    if node_type == "oscillator":
        if "freq" in data:
            params["freq_hz"] = int(data["freq"])
        params["sample_rate"] = SAMPLE_RATE
    # Mixer and Output have no parameters yet.
    return params


# ---------------------------------------------------------------------------
# Top-level module: composes block instances from the graph and wires edges.
# ---------------------------------------------------------------------------
class GraphTop(Elaboratable):
    def __init__(self, graph: dict):
        self.graph = graph
        self.blocks: dict[str, Elaboratable] = {}
        self.output_block: Output | None = None

        nodes = graph.get("nodes", [])
        if not nodes:
            raise ValueError("Graph has no nodes.")

        for node in nodes:
            node_id = node.get("id")
            node_type = node.get("type")
            if node_id is None or node_type is None:
                raise ValueError(f"Node missing id or type: {node!r}")
            if node_type not in BLOCK_REGISTRY:
                raise ValueError(
                    f"Unknown block type: {node_type!r}. "
                    f"Known types: {sorted(BLOCK_REGISTRY.keys())}"
                )

            block_cls = BLOCK_REGISTRY[node_type]
            data = node.get("data") or {}
            params = _build_params(node_type, data)
            block = block_cls(**params)
            self.blocks[node_id] = block

            # Track the (first) Output block as our audio sink.
            if isinstance(block, Output) and self.output_block is None:
                self.output_block = block

        if self.output_block is None:
            raise ValueError("Graph has no Output block — nothing to sample.")

    def elaborate(self, platform):
        m = Module()

        # Add all blocks as submodules. Submodule names must be valid
        # Python identifiers, so sanitize the React Flow node ids.
        for node_id, block in self.blocks.items():
            safe = "block_" + "".join(c if c.isalnum() else "_" for c in node_id)
            setattr(m.submodules, safe, block)

        # Wire edges using combinational connections.
        for edge in self.graph.get("edges", []):
            src_id = edge.get("source")
            tgt_id = edge.get("target")
            src_handle = edge.get("sourceHandle")
            tgt_handle = edge.get("targetHandle")

            src_block = self.blocks.get(src_id)
            tgt_block = self.blocks.get(tgt_id)
            if src_block is None or tgt_block is None:
                # Edge references a missing node — skip.
                continue

            if src_handle not in src_block.output_ports:
                raise ValueError(
                    f"Edge {edge.get('id', '<no id>')}: "
                    f"source block {src_id} ({type(src_block).__name__}) "
                    f"has no output port {src_handle!r}. "
                    f"Available: {sorted(src_block.output_ports.keys())}"
                )
            if tgt_handle not in tgt_block.input_ports:
                raise ValueError(
                    f"Edge {edge.get('id', '<no id>')}: "
                    f"target block {tgt_id} ({type(tgt_block).__name__}) "
                    f"has no input port {tgt_handle!r}. "
                    f"Available: {sorted(tgt_block.input_ports.keys())}"
                )

            src_signal = src_block.output_ports[src_handle]
            tgt_signal = tgt_block.input_ports[tgt_handle]
            m.d.comb += tgt_signal.eq(src_signal)

        return m


# ---------------------------------------------------------------------------
# Simulation harness: run the design, sample the Output block's input.
# ---------------------------------------------------------------------------
def synthesize(graph: dict, duration_s: int = DURATION_S) -> list[int]:
    top = GraphTop(graph)
    sim = Simulator(top)
    sim.add_clock(1e-6)  # arbitrary; one tick == one audio sample

    samples: list[int] = []
    total_ticks = SAMPLE_RATE * duration_s
    # The Output block's audio_in is what we listen to.
    audio_in = top.output_block.audio_in  # type: ignore[union-attr]

    async def process(ctx):
        for _ in range(total_ticks):
            samples.append(ctx.get(audio_in))
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
    print(f"[synth] Graph: {n_nodes} nodes, {n_edges} edges", flush=True)

    samples = synthesize(graph)
    write_wav(samples, args.output_path)
    print(
        f"[synth] Wrote {args.output_path}: {len(samples)} samples "
        f"({DURATION_S}s @ {SAMPLE_RATE}Hz)",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        sys.stderr.write(json.dumps({"error": str(e), "type": type(e).__name__}) + "\n")
        sys.exit(1)

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


# Block types that emit visuals (drive a VGA monitor) rather than audio.
# Used to give a friendly hint when ▶ Play is invoked on a visual-only
# graph — Play renders the audio path; the visual signals only become
# observable on a real monitor after 🔧 Build → iCEBreaker.
_VISUAL_OUTPUT_TYPES = {"vgaoutput"}


SAMPLE_RATE = 44100
DURATION_S = 2


# ---------------------------------------------------------------------------
# Parameter mapping: React Flow `node.data` fields -> block constructor kwargs.
# Each block type has its own translation; this is the only block-type-aware
# part of the translator. Keep additions narrow.
# ---------------------------------------------------------------------------
def _build_params(node_type: str, data: dict) -> dict:
    params: dict = {}
    if node_type in ("oscillator", "triangle", "sawtooth", "sine"):
        if "freq" in data:
            params["freq_hz"] = int(data["freq"])
        params["sample_rate"] = SAMPLE_RATE
    elif node_type == "adsr":
        if "attack_ms" in data:
            params["attack_ms"] = int(data["attack_ms"])
        if "decay_ms" in data:
            params["decay_ms"] = int(data["decay_ms"])
        if "sustain_level" in data:
            params["sustain_level"] = int(data["sustain_level"])
        if "release_ms" in data:
            params["release_ms"] = int(data["release_ms"])
        params["sample_rate"] = SAMPLE_RATE
    elif node_type == "gate":
        if "rate_hz" in data:
            params["rate_hz"] = int(data["rate_hz"])
        if "duty_pct" in data:
            params["duty_pct"] = int(data["duty_pct"])
        params["sample_rate"] = SAMPLE_RATE
    elif node_type == "lowpass":
        if "cutoff_hz" in data:
            params["cutoff_hz"] = int(data["cutoff_hz"])
        params["sample_rate"] = SAMPLE_RATE
    elif node_type == "highpass":
        if "cutoff_hz" in data:
            params["cutoff_hz"] = int(data["cutoff_hz"])
        params["sample_rate"] = SAMPLE_RATE
    elif node_type == "bandpass":
        if "center_hz" in data:
            params["center_hz"] = int(data["center_hz"])
        params["sample_rate"] = SAMPLE_RATE
    elif node_type == "constant":
        if "value" in data:
            params["value"] = int(data["value"])
    elif node_type == "byteconstant":
        if "value" in data:
            params["value"] = int(data["value"])
    elif node_type == "fm":
        if "carrier_freq" in data:
            params["carrier_freq"] = int(data["carrier_freq"])
        if "modulator_freq" in data:
            params["modulator_freq"] = int(data["modulator_freq"])
        if "mod_depth" in data:
            params["mod_depth"] = int(data["mod_depth"])
        params["sample_rate"] = SAMPLE_RATE
    elif node_type == "wavetable":
        if "freq" in data:
            params["freq_hz"] = int(data["freq"])
        if "shape" in data:
            params["shape"] = str(data["shape"])
        params["sample_rate"] = SAMPLE_RATE
    elif node_type == "bitcrusher":
        if "bits" in data:
            params["bits"] = int(data["bits"])
    elif node_type == "delay":
        if "delay_samples" in data:
            params["delay_samples"] = int(data["delay_samples"])
    elif node_type == "counter":
        if "max_value" in data:
            params["max_value"] = int(data["max_value"])
    elif node_type == "distortion":
        if "threshold" in data:
            params["threshold"] = int(data["threshold"])
    elif node_type == "pixelrange":
        if "start" in data:
            params["start"] = int(data["start"])
        if "end" in data:
            params["end"] = int(data["end"])
    elif node_type == "solidcolor":
        if "color" in data:
            params["color"] = str(data["color"])
    elif node_type == "rom":
        # First block where the parameter is a list. Renderer hands us
        # a JSON array of integers; ROM's __init__ clamps each to 0..255
        # and pads/truncates to 16 entries, so the only job here is to
        # coerce array-shaped data through to the constructor.
        contents = data.get("contents", [])
        if isinstance(contents, list):
            params["contents"] = [int(v) for v in contents[:16]]
        else:
            params["contents"] = []
    # Mixer, Output, SampleAndHold, Noise, Multiply, BusSplit, BusJoin,
    # Adder, Register, RAM, the boolean gates (and / or / xor / not), and
    # the Sprint 18 bridge / branching blocks (Reinterpret, Subtractor,
    # Comparator, Mux) all have no parameters.
    return params


# ---------------------------------------------------------------------------
# Top-level module: composes block instances from the graph and wires edges.
# ---------------------------------------------------------------------------
def validate_has_audio_output(graph: dict) -> None:
    """Raise a friendly ValueError if the graph has no audio Output block.

    Called from synth.py's ``synthesize()`` (the ▶ Play path) before
    ``GraphTop`` construction so the user gets a tailored message rather
    than the generic "no Output block" error. The FPGA build path
    (build.py) does NOT call this — visual-only graphs are flashable
    even without an audio Output.

    The two failure modes are reported differently:
      * Visual sink present but no audio sink → tell the user to
        click 🔧 Build instead of ▶ Play.
      * No sink of any kind → say "no Output block."
    """
    nodes = graph.get("nodes", [])
    node_types = {n.get("type") for n in nodes}
    has_audio_output = "output" in node_types
    has_visual_output = bool(_VISUAL_OUTPUT_TYPES & node_types)

    if has_audio_output:
        return  # nothing to validate

    if has_visual_output:
        raise ValueError(
            "This graph has visual outputs but no audio Output. "
            "▶ Play renders audio only — click \U0001f527 "
            "Build → iCEBreaker to flash this design to FPGA "
            "and see it on a VGA monitor."
        )

    raise ValueError("Graph has no Output block — nothing to sample.")


class GraphTop(Elaboratable):
    def __init__(self, graph: dict):
        """Elaborate the graph as an Amaranth Module.

        Does NOT validate that an audio Output block exists — that's
        the caller's responsibility (use ``validate_has_audio_output``
        for the ▶ Play path; visual-only FPGA builds are fine without
        one).
        """
        self.graph = graph
        self.blocks: dict[str, Elaboratable] = {}
        self.output_block: Output | None = None
        # Tracked separately so the FPGA wrapper can route a VGA Output
        # block's signals to physical pins. None for graphs without one.
        self.vga_output_block = None

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
            # Same for the (first) VGA Output block — exposed by name
            # rather than isinstance to avoid a circular import.
            if node_type == "vgaoutput" and self.vga_output_block is None:
                self.vga_output_block = block

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
    validate_has_audio_output(graph)
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
    # Block outputs are 8-bit signed (-128 to +127). Scale by 64 to put the
    # peak at roughly ±8128 in 16-bit PCM — about 25% of int16 max — which
    # matches the loudness of the earlier 1-bit-era output.
    SCALE = 64
    INT16_MIN, INT16_MAX = -32768, 32767
    pcm = [max(INT16_MIN, min(INT16_MAX, s * SCALE)) for s in samples]
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

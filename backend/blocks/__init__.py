"""
ChipBlocks block library — Amaranth Elaboratables matching the
front-end React Flow node types.

Each block exposes:
- `input_ports`:  dict[str, Signal] — keys match the React Flow handle ids
- `output_ports`: dict[str, Signal] — keys match the React Flow handle ids

The translator (Sprint 2 Item 3) reads a graph JSON, instantiates blocks
from BLOCK_REGISTRY by `node.type`, and connects edges by looking up
src.output_ports[edge.sourceHandle] -> tgt.input_ports[edge.targetHandle].
"""

from .oscillator import Oscillator
from .mixer import Mixer
from .output import Output

# Registry mapping graph node `type` (from React Flow JSON) to block class.
# Add new block types here as the library grows.
BLOCK_REGISTRY = {
    "oscillator": Oscillator,
    "mixer": Mixer,
    "output": Output,
}

__all__ = ["Oscillator", "Mixer", "Output", "BLOCK_REGISTRY"]

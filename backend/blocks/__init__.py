"""
ChipBlocks block library — Amaranth Elaboratables matching the
front-end React Flow node types.

Each block exposes:
- `input_ports`:  dict[str, Signal] — keys match the React Flow handle ids
- `output_ports`: dict[str, Signal] — keys match the React Flow handle ids

All audio signals are `Signal(signed(8))` (-128 to +127), giving smooth
waveforms (triangle, saw, mixed audio) that 1-bit could not represent.

The translator (synth.py) reads a graph JSON, instantiates blocks from
BLOCK_REGISTRY by `node.type`, and connects edges by looking up
src.output_ports[edge.sourceHandle] -> tgt.input_ports[edge.targetHandle].
"""

from .oscillator import Oscillator
from .triangle import Triangle
from .sawtooth import Sawtooth
from .mixer import Mixer
from .output import Output

# Registry mapping graph node `type` (from React Flow JSON) to block class.
# Add new block types here as the library grows.
BLOCK_REGISTRY = {
    "oscillator": Oscillator,
    "triangle": Triangle,
    "sawtooth": Sawtooth,
    "mixer": Mixer,
    "output": Output,
}

__all__ = [
    "Oscillator",
    "Triangle",
    "Sawtooth",
    "Mixer",
    "Output",
    "BLOCK_REGISTRY",
]

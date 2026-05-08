"""
ChipBlocks block library — Amaranth Elaboratables matching the
front-end React Flow node types.

Each block exposes:
- `input_ports`:  dict[str, Signal] — keys match the React Flow handle ids
- `output_ports`: dict[str, Signal] — keys match the React Flow handle ids

Audio signals are `Signal(signed(8))` (-128 to +127). Gate / clock
signals are 1-bit `Signal()`. The translator (synth.py) reads a graph
JSON, instantiates blocks from BLOCK_REGISTRY by `node.type`, and wires
edges via `m.d.comb += tgt.input_ports[handle].eq(src.output_ports[handle])`.
"""

from .oscillator import Oscillator
from .triangle import Triangle
from .sawtooth import Sawtooth
from .sine import Sine
from .mixer import Mixer
from .output import Output
from .adsr import ADSR
from .gate import Gate
from .lowpass import LowPassFilter
from .sample_and_hold import SampleAndHold
from .noise import Noise
from .constant import Constant
from .fm import Fm
from .multiply import Multiply

# Registry mapping graph node `type` (from React Flow JSON) to block class.
BLOCK_REGISTRY = {
    "oscillator": Oscillator,
    "triangle": Triangle,
    "sawtooth": Sawtooth,
    "sine": Sine,
    "mixer": Mixer,
    "output": Output,
    "adsr": ADSR,
    "gate": Gate,
    "lowpass": LowPassFilter,
    "samplehold": SampleAndHold,
    "noise": Noise,
    "constant": Constant,
    "fm": Fm,
    "multiply": Multiply,
}

__all__ = [
    "Oscillator",
    "Triangle",
    "Sawtooth",
    "Sine",
    "Mixer",
    "Output",
    "ADSR",
    "Gate",
    "LowPassFilter",
    "SampleAndHold",
    "Noise",
    "Constant",
    "Fm",
    "Multiply",
    "BLOCK_REGISTRY",
]

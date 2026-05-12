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

# @begin codegen block-imports
from .oscillator import Oscillator
from .triangle import Triangle
from .sawtooth import Sawtooth
from .sine import Sine
from .wavetable import Wavetable
from .noise import Noise
from .constant import Constant
from .mixer import Mixer
from .adsr import ADSR
from .gate import Gate
from .lowpass import LowPassFilter
from .highpass import HighPassFilter
from .bandpass import BandPassFilter
from .sample_and_hold import SampleAndHold
from .fm import Fm
from .multiply import Multiply
from .bitcrusher import Bitcrusher
from .delay import Delay
from .distortion import Distortion
from .and_gate import AndGate
from .or_gate import OrGate
from .xor_gate import XorGate
from .not_gate import NotGate
from .counter import Counter
from .vga_timing import VgaTiming
from .color_bars import ColorBars
from .pixel_range import PixelRange
from .solid_color import SolidColor
from .vga_output import VgaOutput
from .bus_split import BusSplit
from .bus_join import BusJoin
from .adder import Adder
from .subtractor import Subtractor
from .comparator import Comparator
from .mux import Mux
from .register import Register
from .ram import RAM
from .register_file import RegisterFile
from .rom import ROM
from .reinterpret import Reinterpret
from .byte_constant import ByteConstant
from .output import Output
# @end codegen block-imports

# @begin codegen block-registry
# Registry mapping graph node `type` (from React Flow JSON) to block class.
BLOCK_REGISTRY = {
    "oscillator": Oscillator,
    "triangle": Triangle,
    "sawtooth": Sawtooth,
    "sine": Sine,
    "wavetable": Wavetable,
    "noise": Noise,
    "constant": Constant,
    "mixer": Mixer,
    "adsr": ADSR,
    "gate": Gate,
    "lowpass": LowPassFilter,
    "highpass": HighPassFilter,
    "bandpass": BandPassFilter,
    "samplehold": SampleAndHold,
    "fm": Fm,
    "multiply": Multiply,
    "bitcrusher": Bitcrusher,
    "delay": Delay,
    "distortion": Distortion,
    "and": AndGate,
    "or": OrGate,
    "xor": XorGate,
    "not": NotGate,
    "counter": Counter,
    "vgatiming": VgaTiming,
    "colorbars": ColorBars,
    "pixelrange": PixelRange,
    "solidcolor": SolidColor,
    "vgaoutput": VgaOutput,
    "bussplit": BusSplit,
    "busjoin": BusJoin,
    "adder": Adder,
    "subtractor": Subtractor,
    "comparator": Comparator,
    "mux": Mux,
    "register": Register,
    "ram": RAM,
    "registerfile": RegisterFile,
    "rom": ROM,
    "reinterpret": Reinterpret,
    "byteconstant": ByteConstant,
    "output": Output,
}
# @end codegen block-registry

# @begin codegen block-all
__all__ = [
    "Oscillator",
    "Triangle",
    "Sawtooth",
    "Sine",
    "Wavetable",
    "Noise",
    "Constant",
    "Mixer",
    "ADSR",
    "Gate",
    "LowPassFilter",
    "HighPassFilter",
    "BandPassFilter",
    "SampleAndHold",
    "Fm",
    "Multiply",
    "Bitcrusher",
    "Delay",
    "Distortion",
    "AndGate",
    "OrGate",
    "XorGate",
    "NotGate",
    "Counter",
    "VgaTiming",
    "ColorBars",
    "PixelRange",
    "SolidColor",
    "VgaOutput",
    "BusSplit",
    "BusJoin",
    "Adder",
    "Subtractor",
    "Comparator",
    "Mux",
    "Register",
    "RAM",
    "RegisterFile",
    "ROM",
    "Reinterpret",
    "ByteConstant",
    "Output",
    "BLOCK_REGISTRY",
]
# @end codegen block-all

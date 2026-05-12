// @begin codegen blocks-imports
import { OscillatorNode,     type OscillatorBlock }     from './OscillatorNode'
import { TriangleNode,       type TriangleBlock }       from './TriangleNode'
import { SawtoothNode,       type SawtoothBlock }       from './SawtoothNode'
import { SineNode,           type SineBlock }           from './SineNode'
import { VcoNode,            type VcoBlock }            from './VcoNode'
import { LfoNode,            type LfoBlock }            from './LfoNode'
import { WavetableNode,      type WavetableBlock }      from './WavetableNode'
import { NoiseNode,          type NoiseBlock }          from './NoiseNode'
import { ConstantNode,       type ConstantBlock }       from './ConstantNode'
import { MixerNode,          type MixerBlock }          from './MixerNode'
import { AudioSumNode,       type AudioSumBlock }       from './AudioSumNode'
import { ADSRNode,           type ADSRBlock }           from './ADSRNode'
import { GateNode,           type GateBlock }           from './GateNode'
import { LowPassFilterNode,  type LowPassFilterBlock }  from './LowPassFilterNode'
import { HighPassFilterNode, type HighPassFilterBlock } from './HighPassFilterNode'
import { BandPassFilterNode, type BandPassFilterBlock } from './BandPassFilterNode'
import { SampleAndHoldNode,  type SampleAndHoldBlock }  from './SampleAndHoldNode'
import { FmNode,             type FmBlock }             from './FmNode'
import { MultiplyNode,       type MultiplyBlock }       from './MultiplyNode'
import { BitcrusherNode,     type BitcrusherBlock }     from './BitcrusherNode'
import { DelayNode,          type DelayBlock }          from './DelayNode'
import { DistortionNode,     type DistortionBlock }     from './DistortionNode'
import { AndGateNode,        type AndGateBlock }        from './AndGateNode'
import { OrGateNode,         type OrGateBlock }         from './OrGateNode'
import { XorGateNode,        type XorGateBlock }        from './XorGateNode'
import { NotGateNode,        type NotGateBlock }        from './NotGateNode'
import { CounterNode,        type CounterBlock }        from './CounterNode'
import { VgaTimingNode,      type VgaTimingBlock }      from './VgaTimingNode'
import { ColorBarsNode,      type ColorBarsBlock }      from './ColorBarsNode'
import { PixelRangeNode,     type PixelRangeBlock }     from './PixelRangeNode'
import { SolidColorNode,     type SolidColorBlock }     from './SolidColorNode'
import { VgaOutputNode,      type VgaOutputBlock }      from './VgaOutputNode'
import { BusSplitNode,       type BusSplitBlock }       from './BusSplitNode'
import { BusJoinNode,        type BusJoinBlock }        from './BusJoinNode'
import { AdderNode,          type AdderBlock }          from './AdderNode'
import { SubtractorNode,     type SubtractorBlock }     from './SubtractorNode'
import { ShifterNode,        type ShifterBlock }        from './ShifterNode'
import { ComparatorNode,     type ComparatorBlock }     from './ComparatorNode'
import { MuxNode,            type MuxBlock }            from './MuxNode'
import { RegisterNode,       type RegisterBlock }       from './RegisterNode'
import { RAMNode,            type RAMBlock }            from './RAMNode'
import { RegisterFileNode,   type RegisterFileBlock }   from './RegisterFileNode'
import { ROMNode,            type ROMBlock }            from './ROMNode'
import { ReinterpretNode,    type ReinterpretBlock }    from './ReinterpretNode'
import { ByteConstantNode,   type ByteConstantBlock }   from './ByteConstantNode'
import { OutputNode,         type OutputBlock }         from './OutputNode'
// @end codegen blocks-imports

// Hoisted to module scope to avoid React Flow's
// "It looks like you've created a new nodeTypes object" warning.
// @begin codegen node-types
export const nodeTypes = {
  oscillator:OscillatorNode,
  triangle:  TriangleNode,
  sawtooth:  SawtoothNode,
  sine:      SineNode,
  vco:       VcoNode,
  lfo:       LfoNode,
  wavetable: WavetableNode,
  noise:     NoiseNode,
  constant:  ConstantNode,
  mixer:     MixerNode,
  audiosum:  AudioSumNode,
  adsr:      ADSRNode,
  gate:      GateNode,
  lowpass:   LowPassFilterNode,
  highpass:  HighPassFilterNode,
  bandpass:  BandPassFilterNode,
  samplehold:SampleAndHoldNode,
  fm:        FmNode,
  multiply:  MultiplyNode,
  bitcrusher:BitcrusherNode,
  delay:     DelayNode,
  distortion:DistortionNode,
  and:       AndGateNode,
  or:        OrGateNode,
  xor:       XorGateNode,
  not:       NotGateNode,
  counter:   CounterNode,
  vgatiming: VgaTimingNode,
  colorbars: ColorBarsNode,
  pixelrange:PixelRangeNode,
  solidcolor:SolidColorNode,
  vgaoutput: VgaOutputNode,
  bussplit:  BusSplitNode,
  busjoin:   BusJoinNode,
  adder:     AdderNode,
  subtractor:SubtractorNode,
  shifter:   ShifterNode,
  comparator:ComparatorNode,
  mux:       MuxNode,
  register:  RegisterNode,
  ram:       RAMNode,
  registerfile:RegisterFileNode,
  rom:       ROMNode,
  reinterpret:ReinterpretNode,
  byteconstant:ByteConstantNode,
  output:    OutputNode,
}
// @end codegen node-types

// @begin codegen app-node-union
export type AppNode =
  | OscillatorBlock
  | TriangleBlock
  | SawtoothBlock
  | SineBlock
  | VcoBlock
  | LfoBlock
  | WavetableBlock
  | NoiseBlock
  | ConstantBlock
  | MixerBlock
  | AudioSumBlock
  | ADSRBlock
  | GateBlock
  | LowPassFilterBlock
  | HighPassFilterBlock
  | BandPassFilterBlock
  | SampleAndHoldBlock
  | FmBlock
  | MultiplyBlock
  | BitcrusherBlock
  | DelayBlock
  | DistortionBlock
  | AndGateBlock
  | OrGateBlock
  | XorGateBlock
  | NotGateBlock
  | CounterBlock
  | VgaTimingBlock
  | ColorBarsBlock
  | PixelRangeBlock
  | SolidColorBlock
  | VgaOutputBlock
  | BusSplitBlock
  | BusJoinBlock
  | AdderBlock
  | SubtractorBlock
  | ShifterBlock
  | ComparatorBlock
  | MuxBlock
  | RegisterBlock
  | RAMBlock
  | RegisterFileBlock
  | ROMBlock
  | ReinterpretBlock
  | ByteConstantBlock
  | OutputBlock
// @end codegen app-node-union

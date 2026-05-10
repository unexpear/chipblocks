import { OscillatorNode,     type OscillatorBlock }     from './OscillatorNode'
import { TriangleNode,       type TriangleBlock }       from './TriangleNode'
import { SawtoothNode,       type SawtoothBlock }       from './SawtoothNode'
import { SineNode,           type SineBlock }           from './SineNode'
import { MixerNode,          type MixerBlock }          from './MixerNode'
import { OutputNode,         type OutputBlock }         from './OutputNode'
import { ADSRNode,           type ADSRBlock }           from './ADSRNode'
import { GateNode,           type GateBlock }           from './GateNode'
import { LowPassFilterNode,  type LowPassFilterBlock }  from './LowPassFilterNode'
import { HighPassFilterNode, type HighPassFilterBlock } from './HighPassFilterNode'
import { BandPassFilterNode, type BandPassFilterBlock } from './BandPassFilterNode'
import { SampleAndHoldNode,  type SampleAndHoldBlock }  from './SampleAndHoldNode'
import { NoiseNode,          type NoiseBlock }          from './NoiseNode'
import { ConstantNode,       type ConstantBlock }       from './ConstantNode'
import { FmNode,             type FmBlock }             from './FmNode'
import { MultiplyNode,       type MultiplyBlock }       from './MultiplyNode'
import { WavetableNode,      type WavetableBlock }      from './WavetableNode'
import { BitcrusherNode,     type BitcrusherBlock }     from './BitcrusherNode'
import { DelayNode,          type DelayBlock }          from './DelayNode'
import { AndGateNode,        type AndGateBlock }        from './AndGateNode'
import { OrGateNode,         type OrGateBlock }         from './OrGateNode'
import { XorGateNode,        type XorGateBlock }        from './XorGateNode'
import { NotGateNode,        type NotGateBlock }        from './NotGateNode'
import { CounterNode,        type CounterBlock }        from './CounterNode'
import { VgaTimingNode,      type VgaTimingBlock }      from './VgaTimingNode'
import { ColorBarsNode,      type ColorBarsBlock }      from './ColorBarsNode'
import { VgaOutputNode,      type VgaOutputBlock }      from './VgaOutputNode'
import { DistortionNode,     type DistortionBlock }     from './DistortionNode'
import { PixelRangeNode,     type PixelRangeBlock }     from './PixelRangeNode'
import { SolidColorNode,     type SolidColorBlock }     from './SolidColorNode'
import { BusSplitNode,       type BusSplitBlock }       from './BusSplitNode'
import { BusJoinNode,        type BusJoinBlock }        from './BusJoinNode'

// Hoisted to module scope to avoid React Flow's
// "It looks like you've created a new nodeTypes object" warning.
export const nodeTypes = {
  oscillator: OscillatorNode,
  triangle:   TriangleNode,
  sawtooth:   SawtoothNode,
  sine:       SineNode,
  mixer:      MixerNode,
  output:     OutputNode,
  adsr:       ADSRNode,
  gate:       GateNode,
  lowpass:    LowPassFilterNode,
  highpass:   HighPassFilterNode,
  bandpass:   BandPassFilterNode,
  samplehold: SampleAndHoldNode,
  noise:      NoiseNode,
  constant:   ConstantNode,
  fm:         FmNode,
  multiply:   MultiplyNode,
  wavetable:  WavetableNode,
  bitcrusher: BitcrusherNode,
  delay:      DelayNode,
  and:        AndGateNode,
  or:         OrGateNode,
  xor:        XorGateNode,
  not:        NotGateNode,
  counter:    CounterNode,
  vgatiming:  VgaTimingNode,
  colorbars:  ColorBarsNode,
  vgaoutput:  VgaOutputNode,
  distortion: DistortionNode,
  pixelrange: PixelRangeNode,
  solidcolor: SolidColorNode,
  bussplit:   BusSplitNode,
  busjoin:    BusJoinNode,
}

export type AppNode =
  | OscillatorBlock
  | TriangleBlock
  | SawtoothBlock
  | SineBlock
  | MixerBlock
  | OutputBlock
  | ADSRBlock
  | GateBlock
  | LowPassFilterBlock
  | HighPassFilterBlock
  | BandPassFilterBlock
  | SampleAndHoldBlock
  | NoiseBlock
  | ConstantBlock
  | FmBlock
  | MultiplyBlock
  | WavetableBlock
  | BitcrusherBlock
  | DelayBlock
  | AndGateBlock
  | OrGateBlock
  | XorGateBlock
  | NotGateBlock
  | CounterBlock
  | VgaTimingBlock
  | ColorBarsBlock
  | VgaOutputBlock
  | DistortionBlock
  | PixelRangeBlock
  | SolidColorBlock
  | BusSplitBlock
  | BusJoinBlock

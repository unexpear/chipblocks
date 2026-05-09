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

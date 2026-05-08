import { OscillatorNode,     type OscillatorBlock }     from './OscillatorNode'
import { TriangleNode,       type TriangleBlock }       from './TriangleNode'
import { SawtoothNode,       type SawtoothBlock }       from './SawtoothNode'
import { SineNode,           type SineBlock }           from './SineNode'
import { MixerNode,          type MixerBlock }          from './MixerNode'
import { OutputNode,         type OutputBlock }         from './OutputNode'
import { ADSRNode,           type ADSRBlock }           from './ADSRNode'
import { GateNode,           type GateBlock }           from './GateNode'
import { LowPassFilterNode,  type LowPassFilterBlock }  from './LowPassFilterNode'
import { SampleAndHoldNode,  type SampleAndHoldBlock }  from './SampleAndHoldNode'
import { NoiseNode,          type NoiseBlock }          from './NoiseNode'
import { ConstantNode,       type ConstantBlock }       from './ConstantNode'

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
  samplehold: SampleAndHoldNode,
  noise:      NoiseNode,
  constant:   ConstantNode,
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
  | SampleAndHoldBlock
  | NoiseBlock
  | ConstantBlock

import { OscillatorNode, type OscillatorBlock } from './OscillatorNode'
import { TriangleNode,   type TriangleBlock }   from './TriangleNode'
import { SawtoothNode,   type SawtoothBlock }   from './SawtoothNode'
import { MixerNode,      type MixerBlock }      from './MixerNode'
import { OutputNode,     type OutputBlock }     from './OutputNode'
import { ADSRNode,       type ADSRBlock }       from './ADSRNode'
import { GateNode,       type GateBlock }       from './GateNode'

// Hoisted to module scope to avoid React Flow's
// "It looks like you've created a new nodeTypes object" warning.
export const nodeTypes = {
  oscillator: OscillatorNode,
  triangle:   TriangleNode,
  sawtooth:   SawtoothNode,
  mixer:      MixerNode,
  output:     OutputNode,
  adsr:       ADSRNode,
  gate:       GateNode,
}

export type AppNode =
  | OscillatorBlock
  | TriangleBlock
  | SawtoothBlock
  | MixerBlock
  | OutputBlock
  | ADSRBlock
  | GateBlock

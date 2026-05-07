import { OscillatorNode, type OscillatorBlock } from './OscillatorNode'
import { MixerNode, type MixerBlock } from './MixerNode'
import { OutputNode, type OutputBlock } from './OutputNode'

// Hoisted to module scope to avoid React Flow's
// "It looks like you've created a new nodeTypes object" warning.
export const nodeTypes = {
  oscillator: OscillatorNode,
  mixer: MixerNode,
  output: OutputNode,
}

export type AppNode = OscillatorBlock | MixerBlock | OutputBlock

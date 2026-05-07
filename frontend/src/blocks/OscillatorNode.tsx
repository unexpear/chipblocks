import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

export type OscillatorBlock = Node<{ freq: number }, 'oscillator'>

export function OscillatorNode({ data }: NodeProps<OscillatorBlock>) {
  return (
    <div className="block block-oscillator">
      <div className="block-title">Oscillator</div>
      <div className="block-body">{data.freq} Hz</div>
      <Handle type="source" position={Position.Right} id="audio-out" />
    </div>
  )
}

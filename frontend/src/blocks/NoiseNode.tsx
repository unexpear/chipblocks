import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

export type NoiseBlock = Node<Record<string, never>, 'noise'>

export function NoiseNode({}: NodeProps<NoiseBlock>) {
  return (
    <div className="block block-noise">
      <div className="block-title">Noise</div>
      <div className="block-body">pseudo-random</div>
      <Handle type="source" position={Position.Right} id="audio-out" />
    </div>
  )
}

import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

export type MixerBlock = Node<Record<string, never>, 'mixer'>

export function MixerNode({}: NodeProps<MixerBlock>) {
  return (
    <div className="block block-mixer">
      <Handle type="target" position={Position.Left} id="in-1" style={{ top: 24 }} />
      <Handle type="target" position={Position.Left} id="in-2" style={{ top: 56 }} />
      <div className="block-title">Mixer</div>
      <div className="block-body">2 → 1</div>
      <Handle type="source" position={Position.Right} id="mix-out" />
    </div>
  )
}

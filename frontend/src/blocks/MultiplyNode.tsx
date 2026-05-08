import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

export type MultiplyBlock = Node<Record<string, never>, 'multiply'>

export function MultiplyNode({}: NodeProps<MultiplyBlock>) {
  return (
    <div className="block block-multiply">
      <Handle type="target" position={Position.Left} id="in-1" style={{ top: 24 }} />
      <Handle type="target" position={Position.Left} id="in-2" style={{ top: 56 }} />
      <div className="block-title">Multiply</div>
      <div className="block-body">a × b</div>
      <Handle type="source" position={Position.Right} id="audio-out" />
    </div>
  )
}

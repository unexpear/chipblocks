import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

export type AndGateBlock = Node<Record<string, never>, 'and'>

export function AndGateNode({ id }: NodeProps<AndGateBlock>) {
  const titleId = `block-${id}-title`
  return (
    <div className="block block-and" role="group" aria-labelledby={titleId}>
      <Handle type="target" position={Position.Left} id="in-1" style={{ top: 24 }} />
      <Handle type="target" position={Position.Left} id="in-2" style={{ top: 56 }} />
      <h3 id={titleId} className="block-title">AND</h3>
      <div className="block-body">a &amp; b</div>
      <Handle type="source" position={Position.Right} id="gate-out" />
    </div>
  )
}

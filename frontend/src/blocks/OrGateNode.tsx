import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

export type OrGateBlock = Node<Record<string, never>, 'or'>

export function OrGateNode({ id }: NodeProps<OrGateBlock>) {
  const titleId = `block-${id}-title`
  return (
    <div className="block block-or" role="group" aria-labelledby={titleId}>
      <Handle type="target" position={Position.Left} id="in-1" style={{ top: 24 }} />
      <Handle type="target" position={Position.Left} id="in-2" style={{ top: 56 }} />
      <h3 id={titleId} className="block-title">OR</h3>
      <div className="block-body">a | b</div>
      <Handle type="source" position={Position.Right} id="gate-out" />
    </div>
  )
}

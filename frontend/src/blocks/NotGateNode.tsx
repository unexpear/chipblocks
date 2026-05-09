import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

export type NotGateBlock = Node<Record<string, never>, 'not'>

export function NotGateNode({ id }: NodeProps<NotGateBlock>) {
  const titleId = `block-${id}-title`
  return (
    <div className="block block-not" role="group" aria-labelledby={titleId}>
      <Handle type="target" position={Position.Left} id="gate-in" />
      <h3 id={titleId} className="block-title">NOT</h3>
      <div className="block-body">~a</div>
      <Handle type="source" position={Position.Right} id="gate-out" />
    </div>
  )
}

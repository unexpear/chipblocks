import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

export type MultiplyBlock = Node<Record<string, never>, 'multiply'>

export function MultiplyNode({ id }: NodeProps<MultiplyBlock>) {
  const titleId = `block-${id}-title`
  return (
    <div className="block block-multiply" role="group" aria-labelledby={titleId}>
      <Handle type="target" position={Position.Left} id="in-1" style={{ top: 24 }} />
      <Handle type="target" position={Position.Left} id="in-2" style={{ top: 56 }} />
      <h3 id={titleId} className="block-title">Multiply</h3>
      <div className="block-body">a × b</div>
      <Handle type="source" position={Position.Right} id="audio-out" />
    </div>
  )
}

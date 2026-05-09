import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

export type OutputBlock = Node<Record<string, never>, 'output'>

export function OutputNode({ id }: NodeProps<OutputBlock>) {
  const titleId = `block-${id}-title`
  return (
    <div className="block block-output" role="group" aria-labelledby={titleId}>
      <Handle type="target" position={Position.Left} id="audio-in" />
      <h3 id={titleId} className="block-title">Output</h3>
      <div className="block-body">→ speaker</div>
    </div>
  )
}

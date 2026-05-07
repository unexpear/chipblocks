import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

export type OutputBlock = Node<Record<string, never>, 'output'>

export function OutputNode({}: NodeProps<OutputBlock>) {
  return (
    <div className="block block-output">
      <Handle type="target" position={Position.Left} id="audio-in" />
      <div className="block-title">Output</div>
      <div className="block-body">→ speaker</div>
    </div>
  )
}

import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { handleTop } from './handleSpacing'

export type XorGateBlock = Node<Record<string, never>, 'xor'>

export function XorGateNode({ id }: NodeProps<XorGateBlock>) {
  const titleId = `block-${id}-title`
  return (
    <div className="block block-xor" role="group" aria-labelledby={titleId}>
      <Handle type="target" position={Position.Left} id="in-1" aria-label="First input" style={{ top: handleTop(0) }} />
      <Handle type="target" position={Position.Left} id="in-2" aria-label="Second input" style={{ top: handleTop(1) }} />
      <h3 id={titleId} className="block-title">XOR</h3>
      <div className="block-body">a ^ b</div>
      <Handle type="source" position={Position.Right} id="gate-out" aria-label="Gate output" />
    </div>
  )
}

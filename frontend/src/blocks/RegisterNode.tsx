import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { handleTop } from './handleSpacing'

export type RegisterBlock = Node<Record<string, never>, 'register'>

// 8-bit data in + 1-bit write-enable on the left; 8-bit data out on the
// right. Stores the value on the clock edge whenever write-enable is high.
export function RegisterNode({ id }: NodeProps<RegisterBlock>) {
  const titleId = `block-${id}-title`
  return (
    <div className="block block-register" role="group" aria-labelledby={titleId}>
      <Handle
        type="target"
        position={Position.Left}
        id="data-in"
        aria-label="Data input"
        style={{ top: handleTop(0) }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="write-enable"
        aria-label="Write-enable input"
        style={{ top: handleTop(1) }}
      />
      <h3 id={titleId} className="block-title">Register</h3>
      <div className="block-body">8-bit latch</div>
      <Handle
        type="source"
        position={Position.Right}
        id="data-out"
        aria-label="Data output"
      />
    </div>
  )
}

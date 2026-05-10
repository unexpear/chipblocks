import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { handleTop } from './handleSpacing'

export type RAMBlock = Node<Record<string, never>, 'ram'>

// 4-bit address + 8-bit data in + 1-bit write-enable on the left; 8-bit
// data out on the right. 16 cells, synchronous write, combinational read.
export function RAMNode({ id }: NodeProps<RAMBlock>) {
  const titleId = `block-${id}-title`
  return (
    <div className="block block-ram" role="group" aria-labelledby={titleId}>
      <Handle
        type="target"
        position={Position.Left}
        id="addr"
        aria-label="Address input"
        style={{ top: handleTop(0) }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="data-in"
        aria-label="Data input"
        style={{ top: handleTop(1) }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="write-enable"
        aria-label="Write-enable input"
        style={{ top: handleTop(2) }}
      />
      <h3 id={titleId} className="block-title">RAM</h3>
      <div className="block-body">16 × 8-bit</div>
      <Handle
        type="source"
        position={Position.Right}
        id="data-out"
        aria-label="Data output"
      />
    </div>
  )
}

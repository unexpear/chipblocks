import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { handleTop } from './handleSpacing'

export type RegisterFileBlock = Node<Record<string, never>, 'registerfile'>

// 4-bit read-addr + 4-bit write-addr + 8-bit data-in + 1-bit write-enable
// on the left; 8-bit data-out on the right. 16 cells, synchronous write,
// combinational read at read-addr. Unlike RAM, read and write addresses
// are independent — read register N while writing register M in the same
// cycle (matches how real CPU instruction sets address src and dst
// registers separately).
export function RegisterFileNode({ id }: NodeProps<RegisterFileBlock>) {
  const titleId = `block-${id}-title`
  return (
    <div className="block block-registerfile" role="group" aria-labelledby={titleId}>
      <Handle
        type="target"
        position={Position.Left}
        id="read-addr"
        aria-label="Read address input"
        style={{ top: handleTop(0) }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="write-addr"
        aria-label="Write address input"
        style={{ top: handleTop(1) }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="data-in"
        aria-label="Data input"
        style={{ top: handleTop(2) }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="write-enable"
        aria-label="Write-enable input"
        style={{ top: handleTop(3) }}
      />
      <h3 id={titleId} className="block-title">Reg File</h3>
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

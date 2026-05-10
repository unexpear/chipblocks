import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { handleTop } from './handleSpacing'

export type AdderBlock = Node<Record<string, never>, 'adder'>

// Two 8-bit inputs on the left, one 8-bit sum + one 1-bit carry on the
// right. The split-output shape lets the sum flow into another 8-bit
// block (Register, another Adder) without truncation while the carry
// stays available on its own 1-bit line.
export function AdderNode({ id }: NodeProps<AdderBlock>) {
  const titleId = `block-${id}-title`
  return (
    <div className="block block-adder" role="group" aria-labelledby={titleId}>
      <Handle
        type="target"
        position={Position.Left}
        id="in-a"
        aria-label="First operand input"
        style={{ top: handleTop(0) }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="in-b"
        aria-label="Second operand input"
        style={{ top: handleTop(1) }}
      />
      <h3 id={titleId} className="block-title">Adder</h3>
      <div className="block-body">a + b (8-bit)</div>
      <Handle
        type="source"
        position={Position.Right}
        id="sum-out"
        aria-label="Sum output"
        style={{ top: handleTop(0) }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="carry-out"
        aria-label="Carry-out output"
        style={{ top: handleTop(1) }}
      />
    </div>
  )
}

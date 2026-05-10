import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { handleTop } from './handleSpacing'

export type SubtractorBlock = Node<Record<string, never>, 'subtractor'>

// Two 8-bit inputs on the left, one 8-bit difference + one 1-bit borrow
// on the right. Mirrors Adder's split-output shape so the difference
// flows into another 8-bit-input block (Register, RAM, another
// Adder/Subtractor) without truncation.
export function SubtractorNode({ id }: NodeProps<SubtractorBlock>) {
  const titleId = `block-${id}-title`
  return (
    <div className="block block-subtractor" role="group" aria-labelledby={titleId}>
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
      <h3 id={titleId} className="block-title">Subtractor</h3>
      <div className="block-body">a − b (8-bit)</div>
      <Handle
        type="source"
        position={Position.Right}
        id="diff-out"
        aria-label="Difference output"
        style={{ top: handleTop(0) }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="borrow-out"
        aria-label="Borrow-out output"
        style={{ top: handleTop(1) }}
      />
    </div>
  )
}

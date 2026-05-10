import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { handleTop } from './handleSpacing'

export type ComparatorBlock = Node<Record<string, never>, 'comparator'>

// Two 8-bit inputs on the left, three 1-bit flag outputs on the right
// (eq / lt / gt). One block, three projections of the same compare —
// splitting them into three blocks would clutter the canvas without
// adding expressive power, and all three are zero-cost outputs of the
// same internal compare.
export function ComparatorNode({ id }: NodeProps<ComparatorBlock>) {
  const titleId = `block-${id}-title`
  return (
    <div className="block block-comparator" role="group" aria-labelledby={titleId}>
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
      <h3 id={titleId} className="block-title">Comparator</h3>
      <div className="block-body">a == &lt; &gt; b</div>
      <Handle
        type="source"
        position={Position.Right}
        id="eq-out"
        aria-label="Equal flag output"
        style={{ top: handleTop(0) }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="lt-out"
        aria-label="Less-than flag output"
        style={{ top: handleTop(1) }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="gt-out"
        aria-label="Greater-than flag output"
        style={{ top: handleTop(2) }}
      />
    </div>
  )
}

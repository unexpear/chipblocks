import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { handleTop } from './handleSpacing'

export type MuxBlock = Node<Record<string, never>, 'mux'>

// 2-to-1 multiplexer: pick `in-a` when select is 0, `in-b` when select
// is 1. Pairs with Comparator for "if equal, take this value, otherwise
// take that value" — branching without a state machine.
export function MuxNode({ id }: NodeProps<MuxBlock>) {
  const titleId = `block-${id}-title`
  return (
    <div className="block block-mux" role="group" aria-labelledby={titleId}>
      <Handle
        type="target"
        position={Position.Left}
        id="in-a"
        aria-label="Input A (selected when select is 0)"
        style={{ top: handleTop(0) }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="in-b"
        aria-label="Input B (selected when select is 1)"
        style={{ top: handleTop(1) }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="select"
        aria-label="Select input (1-bit)"
        style={{ top: handleTop(2) }}
      />
      <h3 id={titleId} className="block-title">Mux</h3>
      <div className="block-body">2-to-1 select</div>
      <Handle
        type="source"
        position={Position.Right}
        id="data-out"
        aria-label="Data output"
      />
    </div>
  )
}

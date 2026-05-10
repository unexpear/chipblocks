import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { handleTop } from './handleSpacing'

export type BusSplitBlock = Node<Record<string, never>, 'bussplit'>

// One 8-bit input on the left, eight 1-bit outputs stacked down the
// right edge. v0.1 fixes the width at 8 bits; configurable widths are
// roadmap (per ADR-001 §"Future work").
export function BusSplitNode({ id }: NodeProps<BusSplitBlock>) {
  const titleId = `block-${id}-title`
  return (
    <div className="block block-bussplit" role="group" aria-labelledby={titleId}>
      <Handle
        type="target"
        position={Position.Left}
        id="bus-in"
        aria-label="Wide bus input"
        style={{ top: handleTop(0) }}
      />
      <h3 id={titleId} className="block-title">Bus Split</h3>
      <div className="block-body">8-bit → 8 × 1-bit</div>
      <Handle
        type="source"
        position={Position.Right}
        id="bit-0"
        aria-label="Bit 0 output (LSB)"
        style={{ top: handleTop(0) }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="bit-1"
        aria-label="Bit 1 output"
        style={{ top: handleTop(1) }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="bit-2"
        aria-label="Bit 2 output"
        style={{ top: handleTop(2) }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="bit-3"
        aria-label="Bit 3 output"
        style={{ top: handleTop(3) }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="bit-4"
        aria-label="Bit 4 output"
        style={{ top: handleTop(4) }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="bit-5"
        aria-label="Bit 5 output"
        style={{ top: handleTop(5) }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="bit-6"
        aria-label="Bit 6 output"
        style={{ top: handleTop(6) }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="bit-7"
        aria-label="Bit 7 output (MSB)"
        style={{ top: handleTop(7) }}
      />
    </div>
  )
}

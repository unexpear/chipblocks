import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { handleTop } from './handleSpacing'

export type BusJoinBlock = Node<Record<string, never>, 'busjoin'>

// Eight 1-bit inputs stacked down the left edge, one 8-bit output on
// the right. Mirror of BusSplit — wiring BusSplit.bit-N → BusJoin.bit-N
// in order is identity.
export function BusJoinNode({ id }: NodeProps<BusJoinBlock>) {
  const titleId = `block-${id}-title`
  return (
    <div className="block block-busjoin" role="group" aria-labelledby={titleId}>
      <Handle
        type="target"
        position={Position.Left}
        id="bit-0"
        aria-label="Bit 0 input (LSB)"
        style={{ top: handleTop(0) }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="bit-1"
        aria-label="Bit 1 input"
        style={{ top: handleTop(1) }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="bit-2"
        aria-label="Bit 2 input"
        style={{ top: handleTop(2) }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="bit-3"
        aria-label="Bit 3 input"
        style={{ top: handleTop(3) }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="bit-4"
        aria-label="Bit 4 input"
        style={{ top: handleTop(4) }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="bit-5"
        aria-label="Bit 5 input"
        style={{ top: handleTop(5) }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="bit-6"
        aria-label="Bit 6 input"
        style={{ top: handleTop(6) }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="bit-7"
        aria-label="Bit 7 input (MSB)"
        style={{ top: handleTop(7) }}
      />
      <h3 id={titleId} className="block-title">Bus Join</h3>
      <div className="block-body">8 × 1-bit → 8-bit</div>
      <Handle
        type="source"
        position={Position.Right}
        id="bus-out"
        aria-label="Wide bus output"
        style={{ top: handleTop(0) }}
      />
    </div>
  )
}

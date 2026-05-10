import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

export type ReinterpretBlock = Node<Record<string, never>, 'reinterpret'>

// data-u8 in, audio-s8 out — same 8 bits, different sign interpretation.
// The explicit bridge between the CPU domain (unsigned data) and the
// audio domain (signed samples), counterpart to BusSplit/BusJoin for
// cross-width composition.
export function ReinterpretNode({ id }: NodeProps<ReinterpretBlock>) {
  const titleId = `block-${id}-title`
  return (
    <div className="block block-reinterpret" role="group" aria-labelledby={titleId}>
      <Handle
        type="target"
        position={Position.Left}
        id="data-in"
        aria-label="Data input (8-bit unsigned)"
      />
      <h3 id={titleId} className="block-title">Reinterpret</h3>
      <div className="block-body">u8 → s8</div>
      <Handle
        type="source"
        position={Position.Right}
        id="audio-out"
        aria-label="Audio output (8-bit signed)"
      />
    </div>
  )
}

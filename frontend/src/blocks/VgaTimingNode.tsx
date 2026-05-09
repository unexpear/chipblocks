import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

export type VgaTimingBlock = Node<Record<string, never>, 'vgatiming'>

// 5 output handles (hsync, vsync, visible, x, y) — more outputs than
// any other block. We stack them down the right edge at the same 32 px
// vertical spacing the multi-input blocks (ADSR, Mixer, S&H) use on the
// left edge so the visual rhythm matches.
export function VgaTimingNode({ id }: NodeProps<VgaTimingBlock>) {
  const titleId = `block-${id}-title`
  return (
    <div className="block block-vgatiming" role="group" aria-labelledby={titleId}>
      <h3 id={titleId} className="block-title">VGA Timing</h3>
      <div className="block-body">640×480 / 60 Hz</div>
      <Handle
        type="source"
        position={Position.Right}
        id="hsync"
        aria-label="Horizontal sync output"
        style={{ top: 24 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="vsync"
        aria-label="Vertical sync output"
        style={{ top: 56 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="visible"
        aria-label="Active-area enable output"
        style={{ top: 88 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="x"
        aria-label="Pixel column output"
        style={{ top: 120 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="y"
        aria-label="Pixel row output"
        style={{ top: 152 }}
      />
    </div>
  )
}

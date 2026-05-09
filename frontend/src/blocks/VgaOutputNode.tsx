import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { handleTop } from './handleSpacing'

export type VgaOutputBlock = Node<Record<string, never>, 'vgaoutput'>

// Visual sink — 5 input handles (r, g, b, hsync, vsync), no outputs.
// Mirrors OutputNode's shape but with 5 ports stacked down the left.
export function VgaOutputNode({ id }: NodeProps<VgaOutputBlock>) {
  const titleId = `block-${id}-title`
  return (
    <div className="block block-vgaoutput" role="group" aria-labelledby={titleId}>
      <Handle
        type="target"
        position={Position.Left}
        id="r"
        aria-label="Red channel input"
        style={{ top: handleTop(0) }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="g"
        aria-label="Green channel input"
        style={{ top: handleTop(1) }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="b"
        aria-label="Blue channel input"
        style={{ top: handleTop(2) }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="hsync"
        aria-label="Horizontal sync input"
        style={{ top: handleTop(3) }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="vsync"
        aria-label="Vertical sync input"
        style={{ top: handleTop(4) }}
      />
      <h3 id={titleId} className="block-title">VGA Output</h3>
      <div className="block-body">→ monitor</div>
    </div>
  )
}

import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

export type ColorBarsBlock = Node<Record<string, never>, 'colorbars'>

// 2 inputs (x, visible) on the left, 3 outputs (r, g, b) on the right.
export function ColorBarsNode({ id }: NodeProps<ColorBarsBlock>) {
  const titleId = `block-${id}-title`
  return (
    <div className="block block-colorbars" role="group" aria-labelledby={titleId}>
      <Handle
        type="target"
        position={Position.Left}
        id="x"
        aria-label="Pixel column input"
        style={{ top: 24 }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="visible"
        aria-label="Active-area enable input"
        style={{ top: 56 }}
      />
      <h3 id={titleId} className="block-title">Color Bars</h3>
      <div className="block-body">8 SMPTE bars</div>
      <Handle
        type="source"
        position={Position.Right}
        id="r"
        aria-label="Red channel output"
        style={{ top: 24 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="g"
        aria-label="Green channel output"
        style={{ top: 56 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="b"
        aria-label="Blue channel output"
        style={{ top: 88 }}
      />
    </div>
  )
}

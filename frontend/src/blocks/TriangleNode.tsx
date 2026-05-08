import {
  Handle,
  Position,
  useReactFlow,
  type NodeProps,
  type Node,
} from '@xyflow/react'
import { type ChangeEvent } from 'react'

export type TriangleBlock = Node<{ freq: number }, 'triangle'>

export function TriangleNode({ id, data }: NodeProps<TriangleBlock>) {
  const { updateNodeData } = useReactFlow()

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const v = parseInt(e.target.value, 10)
    if (Number.isFinite(v) && v >= 20 && v <= 20000) {
      updateNodeData(id, { freq: v })
    }
  }

  return (
    <div className="block block-triangle">
      <div className="block-title">Triangle</div>
      <div className="block-body">
        <input
          type="number"
          className="block-input"
          value={data.freq}
          min={20}
          max={20000}
          step={1}
          aria-label="Frequency in hertz"
          onChange={handleChange}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
        <span className="block-input-suffix">Hz</span>
      </div>
      <Handle type="source" position={Position.Right} id="audio-out" />
    </div>
  )
}

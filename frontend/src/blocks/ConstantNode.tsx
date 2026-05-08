import {
  Handle,
  Position,
  useReactFlow,
  type NodeProps,
  type Node,
} from '@xyflow/react'
import { type ChangeEvent } from 'react'

export type ConstantBlock = Node<{ value: number }, 'constant'>

export function ConstantNode({ id, data }: NodeProps<ConstantBlock>) {
  const { updateNodeData } = useReactFlow()

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const v = parseInt(e.target.value, 10)
    if (Number.isFinite(v) && v >= -128 && v <= 127) {
      updateNodeData(id, { value: v })
    }
  }

  return (
    <div className="block block-constant">
      <div className="block-title">Constant</div>
      <div className="block-body">
        <input
          type="number"
          className="block-input"
          value={data.value}
          min={-128}
          max={127}
          step={1}
          aria-label="Constant value (-128 to 127)"
          onChange={handleChange}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
      </div>
      <Handle type="source" position={Position.Right} id="audio-out" />
    </div>
  )
}

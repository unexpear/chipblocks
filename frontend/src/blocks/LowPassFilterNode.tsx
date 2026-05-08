import {
  Handle,
  Position,
  useReactFlow,
  type NodeProps,
  type Node,
} from '@xyflow/react'
import { type ChangeEvent } from 'react'

export type LowPassFilterBlock = Node<{ cutoff_hz: number }, 'lowpass'>

export function LowPassFilterNode({ id, data }: NodeProps<LowPassFilterBlock>) {
  const { updateNodeData } = useReactFlow()

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const v = parseInt(e.target.value, 10)
    if (Number.isFinite(v) && v >= 1 && v <= 22050) {
      updateNodeData(id, { cutoff_hz: v })
    }
  }

  return (
    <div className="block block-lowpass">
      <Handle type="target" position={Position.Left} id="audio-in" />
      <div className="block-title">Low-pass</div>
      <div className="block-body">
        <input
          type="number"
          className="block-input"
          value={data.cutoff_hz}
          min={1}
          max={22050}
          step={1}
          aria-label="Cutoff frequency in hertz"
          onChange={handleChange}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
        <span className="block-input-suffix">Hz cutoff</span>
      </div>
      <Handle type="source" position={Position.Right} id="audio-out" />
    </div>
  )
}

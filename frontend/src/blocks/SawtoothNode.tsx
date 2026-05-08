import {
  Handle,
  Position,
  useReactFlow,
  type NodeProps,
  type Node,
} from '@xyflow/react'
import { type ChangeEvent } from 'react'

export type SawtoothBlock = Node<{ freq: number }, 'sawtooth'>

export function SawtoothNode({ id, data }: NodeProps<SawtoothBlock>) {
  const { updateNodeData } = useReactFlow()

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const v = parseInt(e.target.value, 10)
    if (Number.isFinite(v) && v >= 20 && v <= 20000) {
      updateNodeData(id, { freq: v })
    }
  }

  return (
    <div className="block block-sawtooth">
      <div className="block-title">Sawtooth</div>
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

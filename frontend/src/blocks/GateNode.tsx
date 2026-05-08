import {
  Handle,
  Position,
  useReactFlow,
  type NodeProps,
  type Node,
} from '@xyflow/react'
import { type ChangeEvent } from 'react'

export type GateBlockData = {
  rate_hz: number
  duty_pct: number
}

export type GateBlock = Node<GateBlockData, 'gate'>

export function GateNode({ id, data }: NodeProps<GateBlock>) {
  const { updateNodeData } = useReactFlow()

  const update = (key: keyof GateBlockData, min: number, max: number) =>
    (e: ChangeEvent<HTMLInputElement>) => {
      const v = parseInt(e.target.value, 10)
      if (Number.isFinite(v) && v >= min && v <= max) {
        updateNodeData(id, { [key]: v })
      }
    }

  return (
    <div className="block block-gate">
      <div className="block-title">Gate</div>
      <div className="block-body">
        <div className="block-row">
          <input
            type="number"
            className="block-input block-input-narrow"
            value={data.rate_hz}
            min={1}
            max={1000}
            step={1}
            onChange={update('rate_hz', 1, 1000)}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
          <span className="block-input-suffix">Hz</span>
        </div>
        <div className="block-row">
          <input
            type="number"
            className="block-input block-input-narrow"
            value={data.duty_pct}
            min={1}
            max={99}
            step={1}
            onChange={update('duty_pct', 1, 99)}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
          <span className="block-input-suffix">% duty</span>
        </div>
      </div>
      <Handle type="source" position={Position.Right} id="gate-out" />
    </div>
  )
}

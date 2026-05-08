import {
  Handle,
  Position,
  useReactFlow,
  type NodeProps,
  type Node,
} from '@xyflow/react'
import { type ChangeEvent } from 'react'

export type ADSRBlockData = {
  attack_ms: number
  decay_ms: number
  sustain_level: number
  release_ms: number
}

export type ADSRBlock = Node<ADSRBlockData, 'adsr'>

type FieldKey = keyof ADSRBlockData

interface FieldSpec {
  key: FieldKey
  label: string
  suffix: string
  min: number
  max: number
}

const FIELDS: FieldSpec[] = [
  { key: 'attack_ms',     label: 'A', suffix: 'ms', min: 1, max: 5000 },
  { key: 'decay_ms',      label: 'D', suffix: 'ms', min: 1, max: 5000 },
  { key: 'sustain_level', label: 'S', suffix: '',   min: 0, max: 127 },
  { key: 'release_ms',    label: 'R', suffix: 'ms', min: 1, max: 5000 },
]

export function ADSRNode({ id, data }: NodeProps<ADSRBlock>) {
  const { updateNodeData } = useReactFlow()

  const update = (key: FieldKey, min: number, max: number) =>
    (e: ChangeEvent<HTMLInputElement>) => {
      const v = parseInt(e.target.value, 10)
      if (Number.isFinite(v) && v >= min && v <= max) {
        updateNodeData(id, { [key]: v })
      }
    }

  return (
    <div className="block block-adsr">
      <Handle type="target" position={Position.Left} id="gate"     style={{ top: 24 }} />
      <Handle type="target" position={Position.Left} id="audio-in" style={{ top: 56 }} />
      <div className="block-title">ADSR</div>
      <div className="block-body">
        {FIELDS.map((f) => (
          <div className="block-row" key={f.key}>
            <span className="block-label">{f.label}</span>
            <input
              type="number"
              className="block-input block-input-narrow"
              value={data[f.key]}
              min={f.min}
              max={f.max}
              step={1}
              onChange={update(f.key, f.min, f.max)}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            />
            {f.suffix && <span className="block-input-suffix">{f.suffix}</span>}
          </div>
        ))}
      </div>
      <Handle type="source" position={Position.Right} id="audio-out" />
    </div>
  )
}

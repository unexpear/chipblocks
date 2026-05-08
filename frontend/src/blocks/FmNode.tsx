import {
  Handle,
  Position,
  useReactFlow,
  type NodeProps,
  type Node,
} from '@xyflow/react'
import { type ChangeEvent } from 'react'

export type FmBlockData = {
  carrier_freq: number
  modulator_freq: number
  mod_depth: number
}

export type FmBlock = Node<FmBlockData, 'fm'>

type FieldKey = keyof FmBlockData

interface FieldSpec {
  key: FieldKey
  label: string
  ariaLabel: string
  suffix: string
  min: number
  max: number
}

const FIELDS: FieldSpec[] = [
  { key: 'carrier_freq',   label: 'C',  ariaLabel: 'Carrier frequency in hertz',     suffix: 'Hz', min: 20, max: 20000 },
  { key: 'modulator_freq', label: 'M',  ariaLabel: 'Modulator frequency in hertz',   suffix: 'Hz', min: 20, max: 20000 },
  { key: 'mod_depth',      label: 'D',  ariaLabel: 'Modulation depth (0 to 127)',    suffix: '',   min: 0,  max: 127   },
]

export function FmNode({ id, data }: NodeProps<FmBlock>) {
  const { updateNodeData } = useReactFlow()

  const update = (key: FieldKey, min: number, max: number) =>
    (e: ChangeEvent<HTMLInputElement>) => {
      const v = parseInt(e.target.value, 10)
      if (Number.isFinite(v) && v >= min && v <= max) {
        updateNodeData(id, { [key]: v })
      }
    }

  return (
    <div className="block block-fm">
      <div className="block-title">FM</div>
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
              aria-label={f.ariaLabel}
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

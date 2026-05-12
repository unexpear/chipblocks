import {
  Handle,
  Position,
  useReactFlow,
  type NodeProps,
  type Node,
} from '@xyflow/react'
import { useCallback, type ChangeEvent } from 'react'
import { useValidatedNumber } from './useValidatedNumber'

export type LfoShape = 'sine' | 'triangle' | 'square' | 'sawtooth'

export type LfoBlockData = {
  rate: number
  rate_millihz: number
  shape: LfoShape
}

export type LfoBlock = Node<LfoBlockData, 'lfo'>

const SHAPE_OPTIONS: { value: LfoShape; label: string }[] = [
  { value: 'sine',     label: 'sine' },
  { value: 'triangle', label: 'triangle' },
  { value: 'square',   label: 'square' },
  { value: 'sawtooth', label: 'sawtooth' },
]

function isLfoShape(v: string): v is LfoShape {
  return v === 'sine' || v === 'triangle' || v === 'square' || v === 'sawtooth'
}

export function LfoNode({ id, data }: NodeProps<LfoBlock>) {
  const { updateNodeData } = useReactFlow()

  const commitRate = useCallback(
    (v: number) => updateNodeData(id, { rate: v }),
    [id, updateNodeData],
  )
  const rate = useValidatedNumber({
    value: data.rate,
    min: 0,
    max: 30,
    commit: commitRate,
  })

  const commitMillihz = useCallback(
    (v: number) => updateNodeData(id, { rate_millihz: v }),
    [id, updateNodeData],
  )
  const millihz = useValidatedNumber({
    value: data.rate_millihz ?? 0,
    min: 0,
    max: 999,
    commit: commitMillihz,
  })

  const handleShapeChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value
    if (isLfoShape(v)) {
      updateNodeData(id, { shape: v })
    }
  }

  const titleId = `block-${id}-title`
  return (
    <div className="block block-lfo" role="group" aria-labelledby={titleId}>
      <h3 id={titleId} className="block-title">LFO</h3>
      <div className="block-body">
        <div className="block-field-row">
          <span className="block-label">Hz</span>
          <input
            type="number"
            className={`block-input block-input-narrow${rate.isInvalid ? ' block-input-invalid' : ''}`}
            value={rate.displayValue}
            min={0}
            max={30}
            step={1}
            aria-label="Rate in hertz (0 to 30)"
            aria-invalid={rate.isInvalid || undefined}
            onChange={rate.onChange}
            onBlur={rate.onBlur}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
          <span className="block-input-suffix">Hz</span>
        </div>
        <div className="block-field-row">
          <span className="block-label">mHz</span>
          <input
            type="number"
            className={`block-input block-input-narrow${millihz.isInvalid ? ' block-input-invalid' : ''}`}
            value={millihz.displayValue}
            min={0}
            max={999}
            step={1}
            aria-label="Rate fractional part in millihertz (0 to 999)"
            aria-invalid={millihz.isInvalid || undefined}
            onChange={millihz.onChange}
            onBlur={millihz.onBlur}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
          <span className="block-input-suffix">mHz</span>
        </div>
        {(rate.isInvalid || millihz.isInvalid) && (
          <div className="block-input-error" role="alert" aria-live="polite">
            {rate.errorMessage || millihz.errorMessage}
          </div>
        )}
        <div className="block-row">
          <select
            className="block-input"
            value={data.shape}
            aria-label="LFO waveform shape"
            onChange={handleShapeChange}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {SHAPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>
      <Handle type="source" position={Position.Right} id="audio-out" aria-label="Audio output" />
    </div>
  )
}

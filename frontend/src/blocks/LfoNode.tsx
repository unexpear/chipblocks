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
  const { displayValue, isInvalid, errorMessage, onChange, onBlur } = useValidatedNumber({
    value: data.rate,
    min: 1,
    max: 30,
    commit: commitRate,
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
        <div className="block-row-group">
          <div className="block-row">
            <input
              type="number"
              className={`block-input block-input-narrow${isInvalid ? ' block-input-invalid' : ''}`}
              value={displayValue}
              min={1}
              max={30}
              step={1}
              aria-label="Rate in hertz (1 to 30)"
              aria-invalid={isInvalid || undefined}
              onChange={onChange}
              onBlur={onBlur}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            />
            <span className="block-input-suffix">Hz</span>
          </div>
          {isInvalid && (
            <div className="block-input-error" role="alert" aria-live="polite">{errorMessage}</div>
          )}
        </div>
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

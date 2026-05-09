import {
  Handle,
  Position,
  useReactFlow,
  type NodeProps,
  type Node,
} from '@xyflow/react'
import { useCallback, type ChangeEvent } from 'react'
import { useValidatedNumber } from './useValidatedNumber'

export type WavetableShape = 'sine' | 'pulse_25' | 'ramp_up' | 'formant'

export type WavetableBlockData = {
  freq: number
  shape: WavetableShape
}

export type WavetableBlock = Node<WavetableBlockData, 'wavetable'>

const SHAPE_OPTIONS: { value: WavetableShape; label: string }[] = [
  { value: 'sine',     label: 'sine' },
  { value: 'pulse_25', label: 'pulse 25%' },
  { value: 'ramp_up',  label: 'ramp up' },
  { value: 'formant',  label: 'formant' },
]

function isWavetableShape(v: string): v is WavetableShape {
  return v === 'sine' || v === 'pulse_25' || v === 'ramp_up' || v === 'formant'
}

export function WavetableNode({ id, data }: NodeProps<WavetableBlock>) {
  const { updateNodeData } = useReactFlow()

  const commitFreq = useCallback(
    (v: number) => updateNodeData(id, { freq: v }),
    [id, updateNodeData],
  )
  const { displayValue, isInvalid, errorMessage, onChange, onBlur } = useValidatedNumber({
    value: data.freq,
    min: 20,
    max: 20000,
    commit: commitFreq,
  })

  const handleShapeChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value
    if (isWavetableShape(v)) {
      updateNodeData(id, { shape: v })
    }
  }

  return (
    <div className="block block-wavetable">
      <div className="block-title">Wavetable</div>
      <div className="block-body">
        <div className="block-row-group">
          <div className="block-row">
            <input
              type="number"
              className={`block-input block-input-narrow${isInvalid ? ' block-input-invalid' : ''}`}
              value={displayValue}
              min={20}
              max={20000}
              step={1}
              aria-label="Frequency in hertz"
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
            aria-label="Wavetable shape"
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
      <Handle type="source" position={Position.Right} id="audio-out" />
    </div>
  )
}

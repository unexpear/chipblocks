import {
  Handle,
  Position,
  useReactFlow,
  type NodeProps,
  type Node,
} from '@xyflow/react'
import { useCallback } from 'react'
import { useValidatedNumber } from './useValidatedNumber'

export type LowPassFilterBlock = Node<{ cutoff_hz: number }, 'lowpass'>

export function LowPassFilterNode({ id, data }: NodeProps<LowPassFilterBlock>) {
  const { updateNodeData } = useReactFlow()

  const commit = useCallback(
    (v: number) => updateNodeData(id, { cutoff_hz: v }),
    [id, updateNodeData],
  )
  const { displayValue, isInvalid, errorMessage, onChange, onBlur } = useValidatedNumber({
    value: data.cutoff_hz,
    min: 1,
    max: 22050,
    commit,
  })

  const titleId = `block-${id}-title`
  return (
    <div className="block block-lowpass" role="group" aria-labelledby={titleId}>
      <Handle type="target" position={Position.Left} id="audio-in" aria-label="Audio input" />
      <h3 id={titleId} className="block-title">Low-pass</h3>
      <div className="block-body">
        <input
          type="number"
          className={`block-input${isInvalid ? ' block-input-invalid' : ''}`}
          value={displayValue}
          min={1}
          max={22050}
          step={1}
          aria-label="Cutoff frequency in hertz"
          aria-invalid={isInvalid || undefined}
          onChange={onChange}
          onBlur={onBlur}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
        <span className="block-input-suffix">Hz cutoff</span>
        {isInvalid && (
          <div className="block-input-error" role="alert" aria-live="polite">{errorMessage}</div>
        )}
      </div>
      <Handle type="source" position={Position.Right} id="audio-out" aria-label="Audio output" />
    </div>
  )
}

import {
  Handle,
  Position,
  useReactFlow,
  type NodeProps,
  type Node,
} from '@xyflow/react'
import { useCallback } from 'react'
import { useValidatedNumber } from './useValidatedNumber'

export type BandPassFilterBlock = Node<{ center_hz: number }, 'bandpass'>

export function BandPassFilterNode({ id, data }: NodeProps<BandPassFilterBlock>) {
  const { updateNodeData } = useReactFlow()

  const commit = useCallback(
    (v: number) => updateNodeData(id, { center_hz: v }),
    [id, updateNodeData],
  )
  const { displayValue, isInvalid, errorMessage, onChange, onBlur } = useValidatedNumber({
    value: data.center_hz,
    min: 10,
    max: 22050,
    commit,
  })

  const titleId = `block-${id}-title`
  return (
    <div className="block block-bandpass" role="group" aria-labelledby={titleId}>
      <Handle type="target" position={Position.Left} id="audio-in" aria-label="Audio input" />
      <h3 id={titleId} className="block-title">Band-pass</h3>
      <div className="block-body">
        <input
          type="number"
          className={`block-input${isInvalid ? ' block-input-invalid' : ''}`}
          value={displayValue}
          min={10}
          max={22050}
          step={1}
          aria-label="Center frequency in hertz"
          aria-invalid={isInvalid || undefined}
          onChange={onChange}
          onBlur={onBlur}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
        <span className="block-input-suffix">Hz center</span>
        {isInvalid && (
          <div className="block-input-error" role="alert" aria-live="polite">{errorMessage}</div>
        )}
      </div>
      <Handle type="source" position={Position.Right} id="audio-out" aria-label="Audio output" />
    </div>
  )
}

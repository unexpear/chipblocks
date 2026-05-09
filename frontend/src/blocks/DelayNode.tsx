import {
  Handle,
  Position,
  useReactFlow,
  type NodeProps,
  type Node,
} from '@xyflow/react'
import { useCallback } from 'react'
import { useValidatedNumber } from './useValidatedNumber'

export type DelayBlock = Node<{ delay_samples: number }, 'delay'>

export function DelayNode({ id, data }: NodeProps<DelayBlock>) {
  const { updateNodeData } = useReactFlow()

  const commit = useCallback(
    (v: number) => updateNodeData(id, { delay_samples: v }),
    [id, updateNodeData],
  )
  const { displayValue, isInvalid, errorMessage, onChange, onBlur } = useValidatedNumber({
    value: data.delay_samples,
    min: 1,
    max: 1024,
    commit,
  })

  const titleId = `block-${id}-title`
  return (
    <div className="block block-delay" role="group" aria-labelledby={titleId}>
      <Handle type="target" position={Position.Left} id="audio-in" aria-label="Audio input" />
      <h3 id={titleId} className="block-title">Delay</h3>
      <div className="block-body">
        <input
          type="number"
          className={`block-input${isInvalid ? ' block-input-invalid' : ''}`}
          value={displayValue}
          min={1}
          max={1024}
          step={1}
          aria-label="Delay length in samples (1 to 1024)"
          aria-invalid={isInvalid || undefined}
          onChange={onChange}
          onBlur={onBlur}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
        <span className="block-input-suffix">samples</span>
        {isInvalid && (
          <div className="block-input-error" role="alert" aria-live="polite">{errorMessage}</div>
        )}
      </div>
      <Handle type="source" position={Position.Right} id="audio-out" aria-label="Audio output" />
    </div>
  )
}

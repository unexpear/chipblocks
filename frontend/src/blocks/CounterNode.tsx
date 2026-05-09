import {
  Handle,
  Position,
  useReactFlow,
  type NodeProps,
  type Node,
} from '@xyflow/react'
import { useCallback } from 'react'
import { useValidatedNumber } from './useValidatedNumber'

export type CounterBlock = Node<{ max_value: number }, 'counter'>

export function CounterNode({ id, data }: NodeProps<CounterBlock>) {
  const { updateNodeData } = useReactFlow()

  const commit = useCallback(
    (v: number) => updateNodeData(id, { max_value: v }),
    [id, updateNodeData],
  )
  const { displayValue, isInvalid, errorMessage, onChange, onBlur } = useValidatedNumber({
    value: data.max_value,
    min: 1,
    max: 127,
    commit,
  })

  const titleId = `block-${id}-title`
  return (
    <div className="block block-counter" role="group" aria-labelledby={titleId}>
      <Handle type="target" position={Position.Left} id="clock" aria-label="Clock input" />
      <h3 id={titleId} className="block-title">Counter</h3>
      <div className="block-body">
        <input
          type="number"
          className={`block-input${isInvalid ? ' block-input-invalid' : ''}`}
          value={displayValue}
          min={1}
          max={127}
          step={1}
          aria-label="Wrap value (1 to 127)"
          aria-invalid={isInvalid || undefined}
          onChange={onChange}
          onBlur={onBlur}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
        <span className="block-input-suffix">max</span>
        {isInvalid && (
          <div className="block-input-error" role="alert" aria-live="polite">{errorMessage}</div>
        )}
      </div>
      <Handle type="source" position={Position.Right} id="audio-out" aria-label="Audio output" />
    </div>
  )
}

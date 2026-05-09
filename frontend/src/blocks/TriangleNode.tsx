import {
  Handle,
  Position,
  useReactFlow,
  type NodeProps,
  type Node,
} from '@xyflow/react'
import { useCallback } from 'react'
import { useValidatedNumber } from './useValidatedNumber'

export type TriangleBlock = Node<{ freq: number }, 'triangle'>

export function TriangleNode({ id, data }: NodeProps<TriangleBlock>) {
  const { updateNodeData } = useReactFlow()

  const commit = useCallback(
    (v: number) => updateNodeData(id, { freq: v }),
    [id, updateNodeData],
  )
  const { displayValue, isInvalid, errorMessage, onChange, onBlur } = useValidatedNumber({
    value: data.freq,
    min: 20,
    max: 20000,
    commit,
  })

  const titleId = `block-${id}-title`
  return (
    <div className="block block-triangle" role="group" aria-labelledby={titleId}>
      <h3 id={titleId} className="block-title">Triangle</h3>
      <div className="block-body">
        <input
          type="number"
          className={`block-input${isInvalid ? ' block-input-invalid' : ''}`}
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
        {isInvalid && (
          <div className="block-input-error" role="alert" aria-live="polite">{errorMessage}</div>
        )}
      </div>
      <Handle type="source" position={Position.Right} id="audio-out" aria-label="Audio output" />
    </div>
  )
}

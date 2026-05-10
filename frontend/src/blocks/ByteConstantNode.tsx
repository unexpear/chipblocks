import {
  Handle,
  Position,
  useReactFlow,
  type NodeProps,
  type Node,
} from '@xyflow/react'
import { useCallback } from 'react'
import { useValidatedNumber } from './useValidatedNumber'

export type ByteConstantBlock = Node<{ value: number }, 'byteconstant'>

export function ByteConstantNode({ id, data }: NodeProps<ByteConstantBlock>) {
  const { updateNodeData } = useReactFlow()

  const commit = useCallback(
    (v: number) => updateNodeData(id, { value: v }),
    [id, updateNodeData],
  )
  const { displayValue, isInvalid, errorMessage, onChange, onBlur } = useValidatedNumber({
    value: data.value,
    min: 0,
    max: 255,
    commit,
  })

  const titleId = `block-${id}-title`
  return (
    <div className="block block-byteconstant" role="group" aria-labelledby={titleId}>
      <h3 id={titleId} className="block-title">Byte Constant</h3>
      <div className="block-body">
        <input
          type="number"
          className={`block-input${isInvalid ? ' block-input-invalid' : ''}`}
          value={displayValue}
          min={0}
          max={255}
          step={1}
          aria-label="Byte constant value (0 to 255)"
          aria-invalid={isInvalid || undefined}
          onChange={onChange}
          onBlur={onBlur}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
        {isInvalid && (
          <div className="block-input-error" role="alert" aria-live="polite">{errorMessage}</div>
        )}
      </div>
      <Handle type="source" position={Position.Right} id="data-out" aria-label="Data output" />
    </div>
  )
}

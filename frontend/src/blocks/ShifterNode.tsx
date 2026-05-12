import {
  Handle,
  Position,
  useReactFlow,
  type NodeProps,
  type Node,
} from '@xyflow/react'
import { type ChangeEvent, useCallback } from 'react'
import { useValidatedNumber } from './useValidatedNumber'

export type ShifterDirection = 'left' | 'right'

export type ShifterBlock = Node<
  { direction: ShifterDirection; amount: number },
  'shifter'
>

const DIRECTION_OPTIONS: { value: ShifterDirection; label: string }[] = [
  { value: 'left',  label: 'left  (<<)' },
  { value: 'right', label: 'right (>>)' },
]

function isShifterDirection(v: string): v is ShifterDirection {
  return v === 'left' || v === 'right'
}

export function ShifterNode({ id, data }: NodeProps<ShifterBlock>) {
  const { updateNodeData } = useReactFlow()

  const handleDirectionChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value
    if (isShifterDirection(v)) {
      updateNodeData(id, { direction: v })
    }
  }

  const commitAmount = useCallback(
    (v: number) => updateNodeData(id, { amount: v }),
    [id, updateNodeData],
  )
  const {
    displayValue,
    isInvalid,
    errorMessage,
    onChange,
    onBlur,
  } = useValidatedNumber({
    value: data.amount,
    min: 1,
    max: 7,
    commit: commitAmount,
  })

  const titleId = `block-${id}-title`
  return (
    <div className="block block-shifter" role="group" aria-labelledby={titleId}>
      <Handle type="target" position={Position.Left} id="data-in" aria-label="Data input" />
      <h3 id={titleId} className="block-title">Shifter</h3>
      <div className="block-body">
        <select
          className="block-input"
          value={data.direction}
          aria-label="Shift direction"
          onChange={handleDirectionChange}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {DIRECTION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <input
          type="number"
          className={`block-input${isInvalid ? ' block-input-invalid' : ''}`}
          value={displayValue}
          min={1}
          max={7}
          step={1}
          aria-label="Shift amount in bits (1 to 7)"
          aria-invalid={isInvalid || undefined}
          onChange={onChange}
          onBlur={onBlur}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
        <span className="block-input-suffix">bits</span>
        {isInvalid && (
          <div className="block-input-error" role="alert" aria-live="polite">{errorMessage}</div>
        )}
      </div>
      <Handle type="source" position={Position.Right} id="data-out" aria-label="Data output" />
    </div>
  )
}

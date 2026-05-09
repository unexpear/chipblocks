import {
  Handle,
  Position,
  useReactFlow,
  type NodeProps,
  type Node,
} from '@xyflow/react'
import { useCallback } from 'react'
import { useValidatedNumber } from './useValidatedNumber'

export type GateBlockData = {
  rate_hz: number
  duty_pct: number
}

export type GateBlock = Node<GateBlockData, 'gate'>

interface FieldRowProps {
  ariaLabel: string
  suffix: string
  min: number
  max: number
  value: number
  commit: (v: number) => void
}

function FieldRow({ ariaLabel, suffix, min, max, value, commit }: FieldRowProps) {
  const { displayValue, isInvalid, errorMessage, onChange, onBlur } = useValidatedNumber({
    value,
    min,
    max,
    commit,
  })
  return (
    <div className="block-row-group">
      <div className="block-row">
        <input
          type="number"
          className={`block-input block-input-narrow${isInvalid ? ' block-input-invalid' : ''}`}
          value={displayValue}
          min={min}
          max={max}
          step={1}
          aria-label={ariaLabel}
          aria-invalid={isInvalid || undefined}
          onChange={onChange}
          onBlur={onBlur}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
        <span className="block-input-suffix">{suffix}</span>
      </div>
      {isInvalid && (
        <div className="block-input-error" role="alert" aria-live="polite">{errorMessage}</div>
      )}
    </div>
  )
}

export function GateNode({ id, data }: NodeProps<GateBlock>) {
  const { updateNodeData } = useReactFlow()

  const commitRate = useCallback((v: number) => updateNodeData(id, { rate_hz: v }), [id, updateNodeData])
  const commitDuty = useCallback((v: number) => updateNodeData(id, { duty_pct: v }), [id, updateNodeData])

  return (
    <div className="block block-gate">
      <div className="block-title">Gate</div>
      <div className="block-body">
        <FieldRow
          ariaLabel="Rate in hertz"
          suffix="Hz"
          min={1}
          max={1000}
          value={data.rate_hz}
          commit={commitRate}
        />
        <FieldRow
          ariaLabel="Duty cycle percent"
          suffix="% duty"
          min={1}
          max={99}
          value={data.duty_pct}
          commit={commitDuty}
        />
      </div>
      <Handle type="source" position={Position.Right} id="gate-out" />
    </div>
  )
}

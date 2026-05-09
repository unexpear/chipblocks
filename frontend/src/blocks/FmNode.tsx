import {
  Handle,
  Position,
  useReactFlow,
  type NodeProps,
  type Node,
} from '@xyflow/react'
import { useCallback } from 'react'
import { useValidatedNumber } from './useValidatedNumber'

export type FmBlockData = {
  carrier_freq: number
  modulator_freq: number
  mod_depth: number
}

export type FmBlock = Node<FmBlockData, 'fm'>

interface FieldRowProps {
  label: string
  ariaLabel: string
  suffix: string
  min: number
  max: number
  value: number
  commit: (v: number) => void
}

function FieldRow({ label, ariaLabel, suffix, min, max, value, commit }: FieldRowProps) {
  const { displayValue, isInvalid, errorMessage, onChange, onBlur } = useValidatedNumber({
    value,
    min,
    max,
    commit,
  })
  return (
    <div className="block-row-group">
      <div className="block-row">
        <span className="block-label">{label}</span>
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
        {suffix && <span className="block-input-suffix">{suffix}</span>}
      </div>
      {isInvalid && (
        <div className="block-input-error" role="alert" aria-live="polite">{errorMessage}</div>
      )}
    </div>
  )
}

export function FmNode({ id, data }: NodeProps<FmBlock>) {
  const { updateNodeData } = useReactFlow()

  const commitCarrier = useCallback((v: number) => updateNodeData(id, { carrier_freq: v }), [id, updateNodeData])
  const commitModulator = useCallback((v: number) => updateNodeData(id, { modulator_freq: v }), [id, updateNodeData])
  const commitDepth = useCallback((v: number) => updateNodeData(id, { mod_depth: v }), [id, updateNodeData])

  const titleId = `block-${id}-title`
  return (
    <div className="block block-fm" role="group" aria-labelledby={titleId}>
      <h3 id={titleId} className="block-title">FM</h3>
      <div className="block-body">
        <FieldRow
          label="C"
          ariaLabel="Carrier frequency in hertz"
          suffix="Hz"
          min={20}
          max={20000}
          value={data.carrier_freq}
          commit={commitCarrier}
        />
        <FieldRow
          label="M"
          ariaLabel="Modulator frequency in hertz"
          suffix="Hz"
          min={20}
          max={20000}
          value={data.modulator_freq}
          commit={commitModulator}
        />
        <FieldRow
          label="D"
          ariaLabel="Modulation depth (0 to 127)"
          suffix=""
          min={0}
          max={127}
          value={data.mod_depth}
          commit={commitDepth}
        />
      </div>
      <Handle type="source" position={Position.Right} id="audio-out" />
    </div>
  )
}

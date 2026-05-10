import {
  Handle,
  Position,
  useReactFlow,
  type NodeProps,
  type Node,
} from '@xyflow/react'
import { useCallback } from 'react'
import { useValidatedNumber } from './useValidatedNumber'
import { handleTop } from './handleSpacing'

export type ADSRBlockData = {
  attack_ms: number
  decay_ms: number
  sustain_level: number
  release_ms: number
}

export type ADSRBlock = Node<ADSRBlockData, 'adsr'>

interface FieldRowProps {
  label: string
  ariaLabel: string
  suffix: string
  min: number
  max: number
  value: number
  commit: (v: number) => void
}

// Small inline component so each field can hold its own hook state
// (text vs. committed value, in-range vs. invalid). Keeps the parent
// component free of per-field state plumbing.
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

export function ADSRNode({ id, data }: NodeProps<ADSRBlock>) {
  const { updateNodeData } = useReactFlow()

  const commitAttack = useCallback((v: number) => updateNodeData(id, { attack_ms: v }), [id, updateNodeData])
  const commitDecay = useCallback((v: number) => updateNodeData(id, { decay_ms: v }), [id, updateNodeData])
  const commitSustain = useCallback((v: number) => updateNodeData(id, { sustain_level: v }), [id, updateNodeData])
  const commitRelease = useCallback((v: number) => updateNodeData(id, { release_ms: v }), [id, updateNodeData])

  const titleId = `block-${id}-title`
  return (
    <div className="block block-adsr" role="group" aria-labelledby={titleId}>
      <Handle type="target" position={Position.Left} id="gate"     aria-label="Gate input"  style={{ top: handleTop(0) }} />
      <Handle type="target" position={Position.Left} id="audio-in" aria-label="Audio input" style={{ top: handleTop(1) }} />
      <h3 id={titleId} className="block-title">ADSR</h3>
      <div className="block-body">
        <FieldRow
          label="Atk"
          ariaLabel="Attack milliseconds"
          suffix="ms"
          min={1}
          max={5000}
          value={data.attack_ms}
          commit={commitAttack}
        />
        <FieldRow
          label="Dec"
          ariaLabel="Decay milliseconds"
          suffix="ms"
          min={1}
          max={5000}
          value={data.decay_ms}
          commit={commitDecay}
        />
        <FieldRow
          label="Sus"
          ariaLabel="Sustain level (0 to 127)"
          suffix=""
          min={0}
          max={127}
          value={data.sustain_level}
          commit={commitSustain}
        />
        <FieldRow
          label="Rel"
          ariaLabel="Release milliseconds"
          suffix="ms"
          min={1}
          max={5000}
          value={data.release_ms}
          commit={commitRelease}
        />
      </div>
      <Handle type="source" position={Position.Right} id="audio-out" aria-label="Audio output" />
    </div>
  )
}

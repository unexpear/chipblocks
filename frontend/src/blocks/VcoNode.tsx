import {
  Handle,
  Position,
  useReactFlow,
  type NodeProps,
  type Node,
} from '@xyflow/react'
import { useCallback } from 'react'
import { useValidatedNumber } from './useValidatedNumber'

export type VcoBlock = Node<{ base_freq: number; range: number }, 'vco'>

export function VcoNode({ id, data }: NodeProps<VcoBlock>) {
  const { updateNodeData } = useReactFlow()

  const commitBaseFreq = useCallback(
    (v: number) => updateNodeData(id, { base_freq: v }),
    [id, updateNodeData],
  )
  const baseFreq = useValidatedNumber({
    value: data.base_freq,
    min: 20,
    max: 20000,
    commit: commitBaseFreq,
  })

  const commitRange = useCallback(
    (v: number) => updateNodeData(id, { range: v }),
    [id, updateNodeData],
  )
  const range = useValidatedNumber({
    value: data.range,
    min: 1,
    max: 1000,
    commit: commitRange,
  })

  const titleId = `block-${id}-title`
  return (
    <div className="block block-vco" role="group" aria-labelledby={titleId}>
      <Handle type="target" position={Position.Left} id="freq-in" aria-label="Frequency control input" />
      <h3 id={titleId} className="block-title">VCO</h3>
      <div className="block-body">
        <div className="block-field-row">
          <span className="block-label">Ctr</span>
          <input
            type="number"
            className={`block-input${baseFreq.isInvalid ? ' block-input-invalid' : ''}`}
            value={baseFreq.displayValue}
            min={20}
            max={20000}
            step={1}
            aria-label="Center frequency in hertz"
            aria-invalid={baseFreq.isInvalid || undefined}
            onChange={baseFreq.onChange}
            onBlur={baseFreq.onBlur}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
          <span className="block-input-suffix">Hz</span>
        </div>
        <div className="block-field-row">
          <span className="block-label">Rng</span>
          <input
            type="number"
            className={`block-input${range.isInvalid ? ' block-input-invalid' : ''}`}
            value={range.displayValue}
            min={1}
            max={1000}
            step={1}
            aria-label="Frequency modulation range in hertz per full-scale input"
            aria-invalid={range.isInvalid || undefined}
            onChange={range.onChange}
            onBlur={range.onBlur}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
          <span className="block-input-suffix">Hz</span>
        </div>
        {(baseFreq.isInvalid || range.isInvalid) && (
          <div className="block-input-error" role="alert" aria-live="polite">
            {baseFreq.errorMessage || range.errorMessage}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} id="audio-out" aria-label="Audio output" />
    </div>
  )
}

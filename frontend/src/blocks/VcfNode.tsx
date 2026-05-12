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

export type VcfBlock = Node<
  { base_cutoff: number; range: number },
  'vcf'
>

export function VcfNode({ id, data }: NodeProps<VcfBlock>) {
  const { updateNodeData } = useReactFlow()

  const commitBase = useCallback(
    (v: number) => updateNodeData(id, { base_cutoff: v }),
    [id, updateNodeData],
  )
  const baseCutoff = useValidatedNumber({
    value: data.base_cutoff,
    min: 1,
    max: 22050,
    commit: commitBase,
  })

  const commitRange = useCallback(
    (v: number) => updateNodeData(id, { range: v }),
    [id, updateNodeData],
  )
  const range = useValidatedNumber({
    value: data.range,
    min: 1,
    max: 10000,
    commit: commitRange,
  })

  const titleId = `block-${id}-title`
  return (
    <div className="block block-vcf" role="group" aria-labelledby={titleId}>
      <Handle
        type="target"
        position={Position.Left}
        id="audio-in"
        aria-label="Audio input"
        style={{ top: handleTop(0) }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="cutoff-in"
        aria-label="Cutoff modulation input"
        style={{ top: handleTop(1) }}
      />
      <h3 id={titleId} className="block-title">VCF</h3>
      <div className="block-body">
        <div className="block-field-row">
          <span className="block-label">Ctr</span>
          <input
            type="number"
            className={`block-input${baseCutoff.isInvalid ? ' block-input-invalid' : ''}`}
            value={baseCutoff.displayValue}
            min={1}
            max={22050}
            step={1}
            aria-label="Base cutoff frequency in hertz"
            aria-invalid={baseCutoff.isInvalid || undefined}
            onChange={baseCutoff.onChange}
            onBlur={baseCutoff.onBlur}
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
            max={10000}
            step={1}
            aria-label="Cutoff modulation range in hertz per full-scale input"
            aria-invalid={range.isInvalid || undefined}
            onChange={range.onChange}
            onBlur={range.onBlur}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
          <span className="block-input-suffix">Hz</span>
        </div>
        {(baseCutoff.isInvalid || range.isInvalid) && (
          <div className="block-input-error" role="alert" aria-live="polite">
            {baseCutoff.errorMessage || range.errorMessage}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} id="audio-out" aria-label="Audio output" />
    </div>
  )
}

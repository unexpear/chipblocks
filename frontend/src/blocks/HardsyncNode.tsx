import {
  Handle,
  Position,
  useReactFlow,
  type NodeProps,
  type Node,
} from '@xyflow/react'
import { useCallback } from 'react'
import { useValidatedNumber } from './useValidatedNumber'

export type HardsyncBlock = Node<{ freq: number }, 'hardsync'>

export function HardsyncNode({ id, data }: NodeProps<HardsyncBlock>) {
  const { updateNodeData } = useReactFlow()

  const commitFreq = useCallback(
    (v: number) => updateNodeData(id, { freq: v }),
    [id, updateNodeData],
  )
  const freq = useValidatedNumber({
    value: data.freq,
    min: 20,
    max: 20000,
    commit: commitFreq,
  })

  const titleId = `block-${id}-title`
  return (
    <div className="block block-hardsync" role="group" aria-labelledby={titleId}>
      <Handle type="target" position={Position.Left} id="sync-in" aria-label="Sync trigger input" />
      <h3 id={titleId} className="block-title">Hard Sync</h3>
      <div className="block-body">
        <div className="block-field-row">
          <span className="block-label">Hz</span>
          <input
            type="number"
            className={`block-input${freq.isInvalid ? ' block-input-invalid' : ''}`}
            value={freq.displayValue}
            min={20}
            max={20000}
            step={1}
            aria-label="Slave sawtooth frequency in hertz"
            aria-invalid={freq.isInvalid || undefined}
            onChange={freq.onChange}
            onBlur={freq.onBlur}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
          <span className="block-input-suffix">Hz</span>
        </div>
        {freq.isInvalid && (
          <div className="block-input-error" role="alert" aria-live="polite">
            {freq.errorMessage}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} id="audio-out" aria-label="Audio output" />
    </div>
  )
}

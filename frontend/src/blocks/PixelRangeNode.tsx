import {
  Handle,
  Position,
  useReactFlow,
  type NodeProps,
  type Node,
} from '@xyflow/react'
import { useCallback } from 'react'
import { useValidatedNumber } from './useValidatedNumber'

export type PixelRangeBlock = Node<{ start: number; end: number }, 'pixelrange'>

export function PixelRangeNode({ id, data }: NodeProps<PixelRangeBlock>) {
  const { updateNodeData } = useReactFlow()

  const commitStart = useCallback(
    (v: number) => updateNodeData(id, { start: v }),
    [id, updateNodeData],
  )
  const commitEnd = useCallback(
    (v: number) => updateNodeData(id, { end: v }),
    [id, updateNodeData],
  )
  const startField = useValidatedNumber({
    value: data.start,
    min: 0,
    max: 639,
    commit: commitStart,
  })
  const endField = useValidatedNumber({
    value: data.end,
    min: 0,
    max: 639,
    commit: commitEnd,
  })

  const titleId = `block-${id}-title`
  return (
    <div className="block block-pixelrange" role="group" aria-labelledby={titleId}>
      <Handle type="target" position={Position.Left} id="pixel" aria-label="Pixel coordinate input" />
      <h3 id={titleId} className="block-title">Pixel Range</h3>
      <div className="block-body">
        <div className="block-row">
          <span className="block-label">start</span>
          <input
            type="number"
            className={`block-input block-input-narrow${startField.isInvalid ? ' block-input-invalid' : ''}`}
            value={startField.displayValue}
            min={0}
            max={639}
            step={1}
            aria-label="Range start (0 to 639)"
            aria-invalid={startField.isInvalid || undefined}
            onChange={startField.onChange}
            onBlur={startField.onBlur}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
        </div>
        <div className="block-row">
          <span className="block-label">end</span>
          <input
            type="number"
            className={`block-input block-input-narrow${endField.isInvalid ? ' block-input-invalid' : ''}`}
            value={endField.displayValue}
            min={0}
            max={639}
            step={1}
            aria-label="Range end (0 to 639)"
            aria-invalid={endField.isInvalid || undefined}
            onChange={endField.onChange}
            onBlur={endField.onBlur}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
        </div>
        {(startField.isInvalid || endField.isInvalid) && (
          <div className="block-input-error" role="alert" aria-live="polite">
            {startField.isInvalid ? startField.errorMessage : endField.errorMessage}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} id="inside" aria-label="Inside-range output" />
    </div>
  )
}

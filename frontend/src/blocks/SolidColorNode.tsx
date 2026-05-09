import {
  Handle,
  Position,
  useReactFlow,
  type NodeProps,
  type Node,
} from '@xyflow/react'
import { type ChangeEvent } from 'react'
import { handleTop } from './handleSpacing'

export type SolidColorName =
  | 'black'
  | 'red'
  | 'green'
  | 'blue'
  | 'yellow'
  | 'cyan'
  | 'magenta'
  | 'white'

export type SolidColorBlock = Node<{ color: SolidColorName }, 'solidcolor'>

const COLOR_OPTIONS: { value: SolidColorName; label: string }[] = [
  { value: 'black',   label: 'black' },
  { value: 'red',     label: 'red' },
  { value: 'green',   label: 'green' },
  { value: 'blue',    label: 'blue' },
  { value: 'yellow',  label: 'yellow' },
  { value: 'cyan',    label: 'cyan' },
  { value: 'magenta', label: 'magenta' },
  { value: 'white',   label: 'white' },
]

function isSolidColorName(v: string): v is SolidColorName {
  return COLOR_OPTIONS.some((o) => o.value === v)
}

export function SolidColorNode({ id, data }: NodeProps<SolidColorBlock>) {
  const { updateNodeData } = useReactFlow()

  const handleColorChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value
    if (isSolidColorName(v)) {
      updateNodeData(id, { color: v })
    }
  }

  const titleId = `block-${id}-title`
  return (
    <div className="block block-solidcolor" role="group" aria-labelledby={titleId}>
      <h3 id={titleId} className="block-title">Solid Color</h3>
      <div className="block-body">
        <select
          className="block-input"
          value={data.color}
          aria-label="Color"
          onChange={handleColorChange}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {COLOR_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="r"
        aria-label="Red channel output"
        style={{ top: handleTop(0) }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="g"
        aria-label="Green channel output"
        style={{ top: handleTop(1) }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="b"
        aria-label="Blue channel output"
        style={{ top: handleTop(2) }}
      />
    </div>
  )
}

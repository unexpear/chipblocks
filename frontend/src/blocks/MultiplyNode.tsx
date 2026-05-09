import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { handleTop } from './handleSpacing'

export type MultiplyBlock = Node<Record<string, never>, 'multiply'>

export function MultiplyNode({ id }: NodeProps<MultiplyBlock>) {
  const titleId = `block-${id}-title`
  return (
    <div className="block block-multiply" role="group" aria-labelledby={titleId}>
      <Handle type="target" position={Position.Left} id="in-1" aria-label="First input" style={{ top: handleTop(0) }} />
      <Handle type="target" position={Position.Left} id="in-2" aria-label="Second input" style={{ top: handleTop(1) }} />
      <h3 id={titleId} className="block-title">Multiply</h3>
      <div className="block-body">a × b</div>
      <Handle type="source" position={Position.Right} id="audio-out" aria-label="Audio output" />
    </div>
  )
}

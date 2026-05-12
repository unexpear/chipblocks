import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { handleTop } from './handleSpacing'

export type AudioSumBlock = Node<Record<string, never>, 'audiosum'>

export function AudioSumNode({ id }: NodeProps<AudioSumBlock>) {
  const titleId = `block-${id}-title`
  return (
    <div className="block block-audiosum" role="group" aria-labelledby={titleId}>
      <Handle type="target" position={Position.Left} id="in-1" aria-label="First input" style={{ top: handleTop(0) }} />
      <Handle type="target" position={Position.Left} id="in-2" aria-label="Second input" style={{ top: handleTop(1) }} />
      <h3 id={titleId} className="block-title">Audio Sum</h3>
      <div className="block-body">a + b (clamped)</div>
      <Handle type="source" position={Position.Right} id="audio-out" aria-label="Summed output" />
    </div>
  )
}

import {
  Handle,
  Position,
  type NodeProps,
  type Node,
} from '@xyflow/react'

export type SampleAndHoldBlock = Node<Record<string, never>, 'samplehold'>

export function SampleAndHoldNode({ id }: NodeProps<SampleAndHoldBlock>) {
  const titleId = `block-${id}-title`
  return (
    <div className="block block-samplehold" role="group" aria-labelledby={titleId}>
      <Handle type="target" position={Position.Left} id="audio-in" style={{ top: 24 }} />
      <Handle type="target" position={Position.Left} id="clock"    style={{ top: 56 }} />
      <h3 id={titleId} className="block-title">S &amp; H</h3>
      <div className="block-body">sample on clock</div>
      <Handle type="source" position={Position.Right} id="audio-out" />
    </div>
  )
}

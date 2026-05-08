import {
  Handle,
  Position,
  type NodeProps,
  type Node,
} from '@xyflow/react'

export type SampleAndHoldBlock = Node<Record<string, never>, 'samplehold'>

export function SampleAndHoldNode({}: NodeProps<SampleAndHoldBlock>) {
  return (
    <div className="block block-samplehold">
      <Handle type="target" position={Position.Left} id="audio-in" style={{ top: 24 }} />
      <Handle type="target" position={Position.Left} id="clock"    style={{ top: 56 }} />
      <div className="block-title">S &amp; H</div>
      <div className="block-body">sample on clock</div>
      <Handle type="source" position={Position.Right} id="audio-out" />
    </div>
  )
}

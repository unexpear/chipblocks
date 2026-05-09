import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { handleTop } from './handleSpacing'

export type MixerBlock = Node<Record<string, never>, 'mixer'>

export function MixerNode({ id }: NodeProps<MixerBlock>) {
  const titleId = `block-${id}-title`
  return (
    <div className="block block-mixer" role="group" aria-labelledby={titleId}>
      <Handle type="target" position={Position.Left} id="in-1" style={{ top: handleTop(0) }} />
      <Handle type="target" position={Position.Left} id="in-2" style={{ top: handleTop(1) }} />
      <h3 id={titleId} className="block-title">Mixer</h3>
      <div className="block-body">2 → 1</div>
      <Handle type="source" position={Position.Right} id="mix-out" />
    </div>
  )
}

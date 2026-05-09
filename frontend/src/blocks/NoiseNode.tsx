import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

export type NoiseBlock = Node<Record<string, never>, 'noise'>

export function NoiseNode({ id }: NodeProps<NoiseBlock>) {
  const titleId = `block-${id}-title`
  return (
    <div className="block block-noise" role="group" aria-labelledby={titleId}>
      <h3 id={titleId} className="block-title">Noise</h3>
      <div className="block-body">pseudo-random</div>
      <Handle type="source" position={Position.Right} id="audio-out" />
    </div>
  )
}

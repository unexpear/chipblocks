import { Handle, type NodeProps, Position } from '@xyflow/react'
import { useContext } from 'react'
import { BLOCK_WIDTH, type BlockData, blockHeight } from './blocks.ts'
import { HealthContext } from './health.ts'

/**
 * A circuit block on the canvas (S19-v3-67) — ONE node showing only its name
 * and port terminals, exactly as the object model prescribes for a Layer-5
 * composition. The real parts live inside (double-click to descend); the
 * solver always works on those real parts, never on the box.
 */

export function BlockNode({ id, data }: NodeProps) {
  const block = (data as { block?: BlockData }).block
  const health = useContext(HealthContext).get(id)
  if (!block) return null
  const height = blockHeight(block.ports)
  return (
    <div
      className={health?.failed ? 'cb-shake' : undefined}
      title={`${block.name} — a circuit block (${block.nodes.length} parts inside). Double-click to see the real circuit it is made of.`}
      style={{
        position: 'relative',
        width: BLOCK_WIDTH,
        height,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {health?.failed ? <div className="cb-danger" /> : null}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          border: health?.failed ? '1.5px solid #e0594f' : '1.5px solid #8a93a0',
          borderRadius: 6,
          background: '#17171b',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ color: '#dde4ec', fontSize: 11, fontWeight: 700 }}>{block.name}</span>
      </div>
      {block.ports.map((port) => (
        <Handle
          key={port.id}
          id={port.id}
          type="source"
          position={port.side === 'left' ? Position.Left : Position.Right}
          title={`${port.label} — this port IS that internal terminal`}
          style={{ top: port.offset, background: '#7ab8ff', width: 8, height: 8 }}
        />
      ))}
      <div
        style={{
          position: 'absolute',
          top: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          color: '#999',
          fontSize: 9,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}
      >
        {String((data as { label?: string }).label ?? id)}
        {health?.failed ? (
          <span title={health.note} style={{ marginLeft: 5 }}>
            💥
          </span>
        ) : null}
      </div>
    </div>
  )
}

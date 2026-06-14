import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
} from '@xyflow/react'
import { useEffect } from 'react'
import type { BlockData } from './blocks.ts'
import { edgeTypes } from './net-edge.tsx'
import { nodeTypes } from './symbols.tsx'

/**
 * The descend view (S19-v3-67): double-click a block and see the REAL circuit
 * inside — the same symbols, the same parts, rendered read-only in their
 * grouped layout. Editing goes through Ungroup (explode, edit, regroup);
 * descend-and-edit-in-place is the documented next rung.
 */

/**
 * Re-fit the view once the nodes have measured. The modal's flex canvas starts at
 * zero size on mount, so React Flow's initial fitView lands on a wrong zoom (it would
 * fill the frame with a single part); this re-fits the moment the nodes report
 * initialized, so any block layout — narrow or wide — shows in full.
 */
function FitWhenReady() {
  const initialized = useNodesInitialized()
  const { fitView } = useReactFlow()
  useEffect(() => {
    if (initialized) fitView({ padding: 0.2 })
  }, [initialized, fitView])
  return null
}

export function BlockViewer({
  block,
  onUngroup,
  onClose,
  light,
}: {
  block: BlockData
  onUngroup: () => void
  onClose: () => void
  light: boolean
}) {
  const border = light ? '1px solid #c4c8ce' : '1px solid #2a2a2f'
  const nodes = block.nodes.map((n) => ({
    id: n.id,
    type: n.block ? 'block' : n.definition === 'junction' ? 'junction' : 'device',
    position: { x: n.x, y: n.y },
    draggable: false,
    selectable: false,
    data: {
      definition: n.definition,
      label: n.block ? n.block.name : n.id,
      ...(n.rotation ? { rotation: n.rotation } : {}),
      ...(n.parameters ? { parameters: n.parameters } : {}),
      ...(n.block ? { block: n.block } : {}),
    },
  }))
  const edges = block.edges.map((e) => ({
    id: e.id,
    source: e.source,
    sourceHandle: e.sourceHandle,
    target: e.target,
    targetHandle: e.targetHandle,
    type: 'net',
    ...(e.waypoints || e.curved
      ? {
          data: {
            ...(e.waypoints ? { waypoints: e.waypoints } : {}),
            ...(e.curved ? { curved: true } : {}),
            ...(typeof e.curveRadius === 'number' ? { curveRadius: e.curveRadius } : {}),
          },
        }
      : {}),
  }))

  return (
    <div
      className="nodrag nopan"
      style={{
        position: 'absolute',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 58,
        width: 640,
        height: 440,
        display: 'flex',
        flexDirection: 'column',
        background: light ? '#f2f3f5' : '#141417',
        border,
        borderRadius: 8,
        boxShadow: '0 10px 32px rgba(0,0,0,0.5)',
        padding: 12,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        color: light ? '#333' : '#cdd6e0',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{block.name} — inside the block</div>
        <span style={{ color: light ? '#667' : '#8a93a0', fontSize: 11 }}>
          the real parts; the solver computes THESE every time
        </span>
        <button
          type="button"
          onClick={onUngroup}
          title="Explode the block back into its parts on the canvas (edit, then group again)"
          style={viewerButton(light)}
        >
          ⧉ Ungroup
        </button>
        <button type="button" onClick={onClose} style={{ ...viewerButton(light), marginLeft: 4 }}>
          ✕ Close
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, border, borderRadius: 6, overflow: 'hidden' }}>
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            colorMode={light ? 'light' : 'dark'}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.001}
            maxZoom={1000}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            zoomOnDoubleClick={false}
            proOptions={{ hideAttribution: true }}
          >
            <FitWhenReady />
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
      <div style={{ color: light ? '#667' : '#8a93a0', fontSize: 10, marginTop: 6 }}>
        Ports:{' '}
        {block.ports.map((p) => p.label).join(' · ') || 'none — nothing wired across the boundary'}
      </div>
    </div>
  )
}

function viewerButton(light: boolean): React.CSSProperties {
  return {
    marginLeft: 'auto',
    padding: '3px 10px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 11,
    background: light ? '#fff' : '#1b1b1f',
    border: light ? '1px solid #c4c8ce' : '1px solid #2a2a2f',
    color: light ? '#444' : '#aab3bd',
  }
}

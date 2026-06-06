import {
  Background,
  Controls,
  type Edge,
  type Node,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useMemo } from 'react'
import { loadCatalogWorld } from './catalog-loader.ts'
import { edgeTypes } from './net-edge.tsx'
import { nodeTypes } from './symbols.tsx'
import { worldToFlow } from './world-to-flow.ts'

/**
 * The canvas page. Sprint 18:
 *  - S18-v3-2: empty React Flow canvas (shell smoke).
 *  - S18-v3-4 (here): load the catalog + render the educational anchor circuit
 *    as labeled nodes + net edges. Labeled boxes are an honest scaffold —
 *    standard schematic symbols replace them in S18-v3-5.
 */
export function App() {
  const initial = useMemo(() => {
    const flow = worldToFlow(loadCatalogWorld())
    const nodes: Node[] = flow.nodes.map((n) => ({
      id: n.id,
      type: 'device',
      position: n.position,
      data: { definition: n.data.definition, label: n.id },
    }))
    const edges: Edge[] = flow.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'net',
      label: e.showLabel ? e.label : undefined,
      style: { stroke: '#888' },
    }))
    return { nodes, edges }
  }, [])

  // Live React Flow state — makes the nodes draggable (S19-v3-3): onNodesChange
  // applies drag moves so a part stays where the user drops it (in-session;
  // persisting positions to canvas/layout.yaml is a later sprint).
  const [nodes, , onNodesChange] = useNodesState(initial.nodes)
  const [edges, , onEdgesChange] = useEdgesState(initial.edges)

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          zIndex: 10,
          color: '#ccc',
          fontSize: 13,
          fontFamily: 'system-ui, sans-serif',
          pointerEvents: 'none',
        }}
      >
        ChipBlocks — educational anchor circuit ({nodes.length} components, {edges.length} net
        connections) · drag to rearrange
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#333" gap={16} />
        <Controls />
      </ReactFlow>
    </div>
  )
}

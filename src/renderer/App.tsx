import { Background, Controls, type Edge, type Node, ReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useMemo } from 'react'
import { loadCatalogWorld } from './catalog-loader.ts'
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
  const { nodes, edges } = useMemo(() => {
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
      label: e.label,
      style: { stroke: '#888' },
      labelStyle: { fill: '#aaa', fontSize: 9 },
    }))
    return { nodes, edges }
  }, [])

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
        connections)
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#333" gap={16} />
        <Controls />
      </ReactFlow>
    </div>
  )
}

import { Background, Controls, ReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

/**
 * The canvas page. Sprint 18 S18-v3-2: an empty React Flow canvas with a
 * background grid + controls — the "hello canvas" smoke that proves React 19
 * + React Flow 12 + Electron 42 mount together. The anchor-circuit render
 * lands in S18-v3-4.
 */
export function App() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <ReactFlow nodes={[]} edges={[]} fitView proOptions={{ hideAttribution: true }}>
        <Background color="#333" gap={16} />
        <Controls />
      </ReactFlow>
    </div>
  )
}

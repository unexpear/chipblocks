import { useCallback, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Edge,
} from '@xyflow/react'
import { nodeTypes, type AppNode } from './blocks'
import './App.css'

declare global {
  interface Window {
    chipforge: {
      synth: (graph: unknown) => Promise<{
        ok: boolean
        wavData?: ArrayBuffer
        error?: string
      }>
    }
  }
}

const initialNodes: AppNode[] = [
  { id: '1', type: 'oscillator', position: { x: 50, y: 100 }, data: { freq: 440 } },
  { id: '2', type: 'mixer', position: { x: 350, y: 100 }, data: {} },
  { id: '3', type: 'output', position: { x: 650, y: 100 }, data: {} },
]

const initialEdges: Edge[] = [
  { id: 'e1-2', source: '1', target: '2', sourceHandle: 'audio-out', targetHandle: 'in-1' },
  { id: 'e2-3', source: '2', target: '3', sourceHandle: 'mix-out', targetHandle: 'audio-in' },
]

function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges)
  const [isPlaying, setIsPlaying] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges],
  )

  const handleSave = () => {
    const data = JSON.stringify({ nodes, edges }, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'chipforge-graph.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleLoad = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const text = await file.text()
      try {
        const parsed = JSON.parse(text)
        if (parsed.nodes) setNodes(parsed.nodes)
        if (parsed.edges) setEdges(parsed.edges)
      } catch {
        alert('Invalid graph file')
      }
    }
    input.click()
  }

  const handlePlay = async () => {
    setIsPlaying(true)
    setStatusMessage('Synthesizing…')
    try {
      const result = await window.chipforge.synth({ nodes, edges })
      if (!result.ok) {
        setStatusMessage(`Error: ${result.error ?? 'Unknown error'}`)
        return
      }
      if (!result.wavData) {
        setStatusMessage('Error: no WAV data returned')
        return
      }
      const blob = new Blob([result.wavData], { type: 'audio/wav' })
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.addEventListener('ended', () => URL.revokeObjectURL(url))
      audio.addEventListener('error', () => {
        setStatusMessage('Audio playback error')
        URL.revokeObjectURL(url)
      })
      const sizeKb = (result.wavData.byteLength / 1024).toFixed(0)
      setStatusMessage(`Playing (${sizeKb} KB)`)
      await audio.play()
    } catch (err) {
      setStatusMessage(`Failed: ${(err as Error).message}`)
    } finally {
      setIsPlaying(false)
    }
  }

  return (
    <div className="app-root">
      <div className="toolbar">
        <span className="app-title">ChipForge</span>
        <span className="toolbar-spacer" />
        {statusMessage && <span className="toolbar-status">{statusMessage}</span>}
        <button onClick={handlePlay} disabled={isPlaying}>
          {isPlaying ? 'Synthesizing…' : '▶ Play'}
        </button>
        <button onClick={handleSave}>Save graph</button>
        <button onClick={handleLoad}>Load graph</button>
      </div>
      <div className="canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          colorMode="dark"
          fitView
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
    </div>
  )
}

export default App

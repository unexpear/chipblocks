import { useCallback, useEffect, useState } from 'react'
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
    chipblocks: {
      synth: (graph: unknown) => Promise<{
        ok: boolean
        wavData?: ArrayBuffer
        error?: string
      }>
      cancel: () => Promise<boolean>
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
  const [errorToast, setErrorToast] = useState<string | null>(null)

  // Auto-dismiss error toast after 6 seconds.
  useEffect(() => {
    if (!errorToast) return
    const t = setTimeout(() => setErrorToast(null), 6000)
    return () => clearTimeout(t)
  }, [errorToast])

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
    a.download = 'chipblocks-graph.json'
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
        setErrorToast('Invalid graph file — could not parse JSON.')
      }
    }
    input.click()
  }

  const handlePlay = async () => {
    setIsPlaying(true)
    setStatusMessage('Synthesizing…')
    setErrorToast(null)
    try {
      const result = await window.chipblocks.synth({ nodes, edges })
      if (!result.ok) {
        setStatusMessage(null)
        // Don't toast a user-initiated cancel — it's not an error.
        if (result.error && result.error !== 'Cancelled by user') {
          setErrorToast(result.error)
        }
        return
      }
      if (!result.wavData) {
        setStatusMessage(null)
        setErrorToast('Synth returned no WAV data.')
        return
      }
      const blob = new Blob([result.wavData], { type: 'audio/wav' })
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.addEventListener('ended', () => {
        URL.revokeObjectURL(url)
        setStatusMessage(null)
      })
      audio.addEventListener('error', () => {
        URL.revokeObjectURL(url)
        setStatusMessage(null)
        setErrorToast('Audio playback error')
      })
      const sizeKb = (result.wavData.byteLength / 1024).toFixed(0)
      setStatusMessage(`Playing (${sizeKb} KB)`)
      await audio.play()
    } catch (err) {
      setStatusMessage(null)
      setErrorToast(`Failed: ${(err as Error).message}`)
    } finally {
      setIsPlaying(false)
    }
  }

  const handleCancel = async () => {
    // The in-flight handlePlay() promise will resolve with
    // "Cancelled by user" once the spawned process is killed.
    await window.chipblocks.cancel()
  }

  return (
    <div className="app-root">
      <div className="toolbar">
        <span className="app-title">ChipBlocks</span>
        <span className="toolbar-spacer" />
        {isPlaying && (
          <>
            <span className="spinner" aria-label="Synthesizing" />
            <span className="toolbar-status">{statusMessage}</span>
            <button onClick={handleCancel} className="toolbar-cancel">Cancel</button>
          </>
        )}
        {!isPlaying && statusMessage && (
          <span className="toolbar-status">{statusMessage}</span>
        )}
        <button onClick={handlePlay} disabled={isPlaying}>
          ▶ Play
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
      {errorToast && (
        <div
          className="error-toast"
          role="alert"
          onClick={() => setErrorToast(null)}
          title="Click to dismiss"
        >
          <strong>Error:</strong>
          <span className="toast-message">{errorToast}</span>
          <span className="toast-close">×</span>
        </div>
      )}
    </div>
  )
}

export default App

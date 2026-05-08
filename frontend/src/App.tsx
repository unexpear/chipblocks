import { useCallback, useEffect, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  addEdge,
  type Connection,
  type Edge,
  type Viewport,
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

// Save-file schema. Bump SAVE_VERSION when the format changes
// incompatibly. Loaders should accept any version <= SAVE_VERSION
// and apply migrations.
const SAVE_VERSION = 1
const APP_NAME = 'ChipBlocks'

interface SaveFileV1 {
  version: 1
  app: typeof APP_NAME
  savedAt: string  // ISO 8601
  viewport: Viewport
  nodes: AppNode[]
  edges: Edge[]
}

const initialNodes: AppNode[] = [
  { id: '1', type: 'oscillator', position: { x: 50, y: 60 },  data: { freq: 440 } },
  { id: '2', type: 'triangle',   position: { x: 50, y: 200 }, data: { freq: 660 } },
  { id: '3', type: 'sawtooth',   position: { x: 50, y: 340 }, data: { freq: 220 } },
  { id: '4', type: 'mixer',      position: { x: 350, y: 130 }, data: {} },
  { id: '5', type: 'output',     position: { x: 650, y: 130 }, data: {} },
]

const initialEdges: Edge[] = [
  { id: 'e1-4', source: '1', target: '4', sourceHandle: 'audio-out', targetHandle: 'in-1' },
  { id: 'e2-4', source: '2', target: '4', sourceHandle: 'audio-out', targetHandle: 'in-2' },
  { id: 'e4-5', source: '4', target: '5', sourceHandle: 'mix-out',   targetHandle: 'audio-in' },
]

function AppContent() {
  const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges)
  const [isPlaying, setIsPlaying] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorToast, setErrorToast] = useState<string | null>(null)

  const { getViewport, setViewport } = useReactFlow()

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
    const payload: SaveFileV1 = {
      version: SAVE_VERSION,
      app: APP_NAME,
      savedAt: new Date().toISOString(),
      viewport: getViewport(),
      nodes,
      edges,
    }
    const data = JSON.stringify(payload, null, 2)
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

        // Validate minimum shape.
        if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
          setErrorToast('Graph file is missing nodes/edges arrays.')
          return
        }

        // Newer-version safety: warn but still try to load.
        if (typeof parsed.version === 'number' && parsed.version > SAVE_VERSION) {
          setErrorToast(
            `Graph was saved with a newer ChipBlocks (v${parsed.version}); ` +
              `attempting to load anyway.`,
          )
        }

        setNodes(parsed.nodes as AppNode[])
        setEdges(parsed.edges as Edge[])
        if (parsed.viewport && typeof parsed.viewport === 'object') {
          setViewport(parsed.viewport as Viewport)
        }
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

function App() {
  // ReactFlowProvider exposes useReactFlow() to AppContent so we can
  // capture and restore the viewport during save/load.
  return (
    <ReactFlowProvider>
      <AppContent />
    </ReactFlowProvider>
  )
}

export default App

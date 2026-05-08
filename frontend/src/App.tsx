import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { Chat, type CanvasActions } from './Chat'
import { SettingsModal } from './SettingsModal'
import { Palette, PALETTE_DRAG_TYPE, defaultDataForType } from './Palette'
import { type DragEvent } from 'react'
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

const SAVE_VERSION = 1
const APP_NAME = 'ChipBlocks'

interface SaveFileV1 {
  version: 1
  app: typeof APP_NAME
  savedAt: string
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
  const [chatOpen, setChatOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [hasApiKey, setHasApiKey] = useState(false)
  const [paletteCollapsed, setPaletteCollapsed] = useState(false)

  const { getViewport, setViewport, screenToFlowPosition, getNodes } = useReactFlow()

  // On mount, check whether an API key is already saved.
  useEffect(() => {
    window.ai.hasKey().then(setHasApiKey).catch(() => setHasApiKey(false))
  }, [])

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

  const refreshKeyStatus = useCallback(async () => {
    try {
      setHasApiKey(await window.ai.hasKey())
    } catch {
      setHasApiKey(false)
    }
  }, [])

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
        if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
          setErrorToast('Graph file is missing nodes/edges arrays.')
          return
        }
        if (typeof parsed.version === 'number' && parsed.version > SAVE_VERSION) {
          setErrorToast(
            `Graph was saved with a newer ChipBlocks (v${parsed.version}); attempting to load anyway.`,
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

  // Canvas actions exposed to the AI consultant via tool calls. Each
  // returns a short string id of the new entity (or true for in-place
  // updates) so the Chat component can display a confirmation.
  const canvasActions: CanvasActions = useMemo(
    () => ({
      addNode: (type, data, position) => {
        const id = `${type}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`
        // Smarter default placement: just to the right of the existing
        // rightmost node, vertically near the average node y. Falls back
        // to a fixed position when the canvas is empty. Override always
        // wins if the caller passes an explicit `position`.
        let finalPosition = position
        if (!finalPosition) {
          const allNodes = getNodes()
          if (allNodes.length === 0) {
            finalPosition = { x: 200, y: 200 }
          } else {
            const rightmostX = Math.max(...allNodes.map((n) => n.position.x))
            const avgY = allNodes.reduce((s, n) => s + n.position.y, 0) / allNodes.length
            finalPosition = {
              x: rightmostX + 200,
              y: avgY + (Math.random() - 0.5) * 80,
            }
          }
        }
        const finalData = data ?? defaultDataForType(type)
        setNodes((nds) => [
          ...nds,
          { id, type, position: finalPosition, data: finalData } as AppNode,
        ])
        return id
      },
      addEdge: (sourceId, targetId, sourceHandle, targetHandle) => {
        const id = `e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`
        setEdges((eds) => [
          ...eds,
          { id, source: sourceId, target: targetId, sourceHandle, targetHandle },
        ])
        return id
      },
      updateNodeData: (id, newData) => {
        setNodes((nds) =>
          nds.map((n) =>
            n.id === id ? ({ ...n, data: { ...n.data, ...newData } } as AppNode) : n,
          ),
        )
        return true
      },
      deleteNode: (id) => {
        // Removing a node also removes any edges connected to it.
        let removedCount = 0
        setEdges((eds) =>
          eds.filter((e) => {
            const connected = e.source === id || e.target === id
            if (connected) removedCount += 1
            return !connected
          }),
        )
        setNodes((nds) => nds.filter((n) => n.id !== id))
        return removedCount
      },
      deleteEdge: (id) => {
        let found = false
        setEdges((eds) => {
          const next = eds.filter((e) => {
            if (e.id === id) {
              found = true
              return false
            }
            return true
          })
          return next
        })
        return found
      },
    }),
    [setNodes, setEdges, getNodes],
  )

  // Drag-and-drop from the palette: the canvas wrapper accepts drops
  // carrying our private MIME type and spawns a new node at the drop
  // location with the block type's default data.
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes(PALETTE_DRAG_TYPE)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    }
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    const type = e.dataTransfer.getData(PALETTE_DRAG_TYPE)
    if (!type) return
    e.preventDefault()
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const id = `${type}_${Date.now().toString(36)}`
    setNodes((nds) => [
      ...nds,
      { id, type, position, data: defaultDataForType(type) } as AppNode,
    ])
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
        <button onClick={handlePlay} disabled={isPlaying}>▶ Play</button>
        <button onClick={handleSave}>Save</button>
        <button onClick={handleLoad}>Load</button>
        <button
          onClick={() => setChatOpen((v) => !v)}
          className={chatOpen ? 'toolbar-toggle-active' : ''}
          title="Toggle AI consultant"
        >
          💬 Chat
        </button>
        <button onClick={() => setSettingsOpen(true)} title="Settings">⚙</button>
      </div>
      <div className="main-area">
        <Palette
          collapsed={paletteCollapsed}
          onToggle={() => setPaletteCollapsed((v) => !v)}
        />
        <div className="canvas" onDragOver={onDragOver} onDrop={onDrop}>
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
        {chatOpen && (
          <Chat
            nodes={nodes}
            edges={edges}
            hasApiKey={hasApiKey}
            canvasActions={canvasActions}
            onClose={() => setChatOpen(false)}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}
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
      {settingsOpen && (
        <SettingsModal
          hasApiKey={hasApiKey}
          onClose={() => setSettingsOpen(false)}
          onKeyChanged={refreshKeyStatus}
        />
      )}
    </div>
  )
}

function App() {
  return (
    <ReactFlowProvider>
      <AppContent />
    </ReactFlowProvider>
  )
}

export default App

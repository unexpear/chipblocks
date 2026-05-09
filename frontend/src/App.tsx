import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
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
import { AboutModal } from './AboutModal'
import { ErrorBoundary } from './ErrorBoundary'
import { Palette, PALETTE, PALETTE_DRAG_TYPE, defaultDataForType } from './Palette'
import { EXAMPLES, type ExampleGraph } from './examples'
import { type DragEvent } from 'react'
import type { BuildTarget } from './types/ipc'
import './App.css'

const SAVE_VERSION = 1
const APP_NAME = 'ChipBlocks'
const STARTER_HINT_KEY = 'chipblocks:starterHintDismissed'

interface BuildTargetOption {
  id: BuildTarget
  label: string
  description: string
  icon: string
  bundleFilename: string
}

const BUILD_TARGETS: BuildTargetOption[] = [
  {
    id: 'icestick',
    label: 'Lattice iCEstick',
    description: 'iCE40 HX1K · ~$30 USB dev board · flash with iceprog',
    icon: '🔧',
    bundleFilename: 'chipblocks-fpga-icestick.zip',
  },
  {
    id: 'tinyfpga-bx',
    label: 'TinyFPGA BX',
    description: 'iCE40 LP8K · USB-native, ~5× the LUTs · flash with tinyprog',
    icon: '🔧',
    bundleFilename: 'chipblocks-fpga-tinyfpga-bx.zip',
  },
  {
    id: 'tt',
    label: 'Tiny Tapeout (real ASIC)',
    description: 'Submission package for Tiny Tapeout · sources + info.yaml · they fab the chip',
    icon: '🚀',
    bundleFilename: 'chipblocks-tt.zip',
  },
]

interface SaveFileV1 {
  version: 1
  app: typeof APP_NAME
  savedAt: string
  viewport: Viewport
  nodes: AppNode[]
  edges: Edge[]
}

// Default starter graph. Intentionally minimal — Oscillator -> Output is
// the smallest thing that produces sound, and "click Play" is the
// shortest possible learning loop. Bigger demos live in examples/ and
// are reachable from the Load -> Examples menu.
const initialNodes: AppNode[] = [
  { id: 'starter-osc', type: 'oscillator', position: { x: 100, y: 200 }, data: { freq: 440 } },
  { id: 'starter-out', type: 'output',     position: { x: 450, y: 200 }, data: {} },
]

const initialEdges: Edge[] = [
  { id: 'starter-edge', source: 'starter-osc', target: 'starter-out', sourceHandle: 'audio-out', targetHandle: 'audio-in' },
]

// Validate a parsed `chipblocks-graph.json` before swapping it onto
// the canvas. m5 from the 2026-05-08 security review: a maliciously
// crafted save file shared user-to-user could embed prompt-injection
// strings in `data` fields that leak into the AI consultant's
// per-turn canvas-state system block. Type-checking on the data
// fields (only flat objects of strings/numbers/booleans, only known
// block types) neutralizes the vector at the door.
const KNOWN_BLOCK_TYPES = new Set(PALETTE.map((p) => p.type))

interface ValidatedGraph {
  ok: true
  nodes: AppNode[]
  edges: Edge[]
  viewport?: Viewport
  versionWarning?: string
}

interface InvalidGraph {
  ok: false
  error: string
}

function isPlainPrimitiveObject(v: unknown): v is Record<string, string | number | boolean | null> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  for (const value of Object.values(v)) {
    if (
      value !== null &&
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean'
    ) return false
  }
  return true
}

function validateLoadedGraph(input: unknown): ValidatedGraph | InvalidGraph {
  if (input === null || typeof input !== 'object') {
    return { ok: false, error: 'Graph file is not an object.' }
  }
  const parsed = input as Record<string, unknown>
  if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
    return { ok: false, error: 'Graph file is missing nodes/edges arrays.' }
  }
  let versionWarning: string | undefined
  if (typeof parsed.version === 'number' && parsed.version > SAVE_VERSION) {
    versionWarning = `Graph was saved with a newer ChipBlocks (v${parsed.version}); attempting to load anyway.`
  }
  const nodeIds = new Set<string>()
  const validNodes: AppNode[] = []
  for (const raw of parsed.nodes as unknown[]) {
    if (raw === null || typeof raw !== 'object') {
      return { ok: false, error: 'A node entry is not an object.' }
    }
    const n = raw as Record<string, unknown>
    if (typeof n.id !== 'string' || typeof n.type !== 'string') {
      return { ok: false, error: 'A node is missing a string `id` or `type`.' }
    }
    if (!KNOWN_BLOCK_TYPES.has(n.type)) {
      return { ok: false, error: `Unknown block type "${n.type}" in saved graph.` }
    }
    if (n.data !== undefined && !isPlainPrimitiveObject(n.data)) {
      return { ok: false, error: `Node "${n.id}" has invalid data (must be a flat object of primitives).` }
    }
    if (n.position !== null && typeof n.position !== 'object') {
      return { ok: false, error: `Node "${n.id}" has invalid position.` }
    }
    nodeIds.add(n.id)
    validNodes.push(raw as AppNode)
  }
  const validEdges: Edge[] = []
  for (const raw of parsed.edges as unknown[]) {
    if (raw === null || typeof raw !== 'object') {
      return { ok: false, error: 'An edge entry is not an object.' }
    }
    const e = raw as Record<string, unknown>
    if (typeof e.id !== 'string' || typeof e.source !== 'string' || typeof e.target !== 'string') {
      return { ok: false, error: 'An edge is missing string id/source/target.' }
    }
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) {
      return { ok: false, error: `Edge "${e.id}" references unknown node id.` }
    }
    validEdges.push(raw as Edge)
  }
  let viewport: Viewport | undefined
  if (parsed.viewport && typeof parsed.viewport === 'object') {
    viewport = parsed.viewport as Viewport
  }
  return { ok: true, nodes: validNodes, edges: validEdges, viewport, versionWarning }
}

// APG menu pattern keyboard navigation: ArrowDown/Up move focus
// between items, Home/End jump to first/last, with wrap-around.
// `refs` is a sparse array of buttons (entries can be null until
// React mounts each item). We filter to mounted buttons before
// computing the next focus target.
function handleMenuKeyDown(
  e: KeyboardEvent<HTMLElement>,
  refs: (HTMLButtonElement | null)[],
) {
  const items = refs.filter((b): b is HTMLButtonElement => b !== null)
  if (items.length === 0) return
  const currentIndex = items.findIndex((b) => b === document.activeElement)
  let nextIndex = currentIndex
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length
      break
    case 'ArrowUp':
      e.preventDefault()
      nextIndex = currentIndex < 0
        ? items.length - 1
        : (currentIndex - 1 + items.length) % items.length
      break
    case 'Home':
      e.preventDefault()
      nextIndex = 0
      break
    case 'End':
      e.preventDefault()
      nextIndex = items.length - 1
      break
    default:
      return
  }
  items[nextIndex]?.focus()
}

function AppContent() {
  const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges)
  const [isPlaying, setIsPlaying] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorToast, setErrorToast] = useState<string | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [examplesOpen, setExamplesOpen] = useState(false)
  const [buildMenuOpen, setBuildMenuOpen] = useState(false)
  const [hasApiKey, setHasApiKey] = useState(false)
  const [paletteCollapsed, setPaletteCollapsed] = useState(false)
  const [showStarterHint, setShowStarterHint] = useState(
    () => typeof window !== 'undefined' && !window.localStorage.getItem(STARTER_HINT_KEY),
  )

  const { getViewport, setViewport, screenToFlowPosition, getNodes } = useReactFlow()

  // Refs for popover items so we can move focus via ArrowUp/Down.
  // Index matches BUILD_TARGETS / EXAMPLES order.
  const buildItemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const exampleItemRefs = useRef<(HTMLButtonElement | null)[]>([])

  // On mount, check whether an API key is already saved.
  useEffect(() => {
    window.ai.hasKey().then(setHasApiKey).catch(() => setHasApiKey(false))
  }, [])

  // When a popover opens, focus its first item — APG menu pattern. The
  // RAF defer lets React paint the popover before we look up the ref.
  useEffect(() => {
    if (!buildMenuOpen) return
    requestAnimationFrame(() => {
      buildItemRefs.current[0]?.focus()
    })
  }, [buildMenuOpen])

  useEffect(() => {
    if (!examplesOpen) return
    requestAnimationFrame(() => {
      exampleItemRefs.current[0]?.focus()
    })
  }, [examplesOpen])

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

  const dismissStarterHint = useCallback(() => {
    setShowStarterHint(false)
    try {
      window.localStorage.setItem(STARTER_HINT_KEY, '1')
    } catch {
      // localStorage unavailable (Electron security policy edge case) — banner just won't be sticky.
    }
  }, [])

  const loadExample = (ex: ExampleGraph) => {
    setNodes(ex.nodes)
    setEdges(ex.edges)
    setExamplesOpen(false)
    dismissStarterHint()
  }

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
    dismissStarterHint()
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const text = await file.text()
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        setErrorToast('Invalid graph file — could not parse JSON.')
        return
      }
      const validation = validateLoadedGraph(parsed)
      if (!validation.ok) {
        setErrorToast(validation.error)
        return
      }
      const { nodes: validNodes, edges: validEdges, viewport, versionWarning } = validation
      if (versionWarning) {
        setErrorToast(versionWarning)
      }
      setNodes(validNodes)
      setEdges(validEdges)
      if (viewport) setViewport(viewport)
    }
    input.click()
  }

  const handlePlay = async () => {
    dismissStarterHint()
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

  // Build: spawn the build pipeline in WSL2 for the selected target
  // (FPGA bitstream for icestick / tinyfpga-bx, or sources-only Tiny
  // Tapeout submission package). Get back a zip and prompt download.
  const [isBuilding, setIsBuilding] = useState(false)

  const handleBuild = async (target: BuildTargetOption) => {
    dismissStarterHint()
    setBuildMenuOpen(false)
    setIsBuilding(true)
    setStatusMessage(target.id === 'tt' ? 'Generating Tiny Tapeout package…' : `Building bitstream (${target.label})…`)
    setErrorToast(null)
    try {
      const result = await window.chipblocks.build({ nodes, edges }, target.id)
      if (!result.ok) {
        setStatusMessage(null)
        setErrorToast(result.error ?? 'Build failed')
        return
      }
      if (!result.zipData) {
        setStatusMessage(null)
        setErrorToast('Build returned no zip data')
        return
      }
      const blob = new Blob([result.zipData], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = target.bundleFilename
      a.click()
      URL.revokeObjectURL(url)
      const sizeKb = (result.zipData.byteLength / 1024).toFixed(1)
      setStatusMessage(target.id === 'tt' ? `Submission ready (${sizeKb} KB)` : `Bitstream ready (${sizeKb} KB)`)
    } catch (err) {
      setStatusMessage(null)
      setErrorToast(`Build failed: ${(err as Error).message}`)
    } finally {
      setIsBuilding(false)
    }
  }

  const handleCancelBuild = async () => {
    await window.chipblocks.cancelBuild()
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
    dismissStarterHint()
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
        {(isPlaying || isBuilding) && (
          <>
            <span className="spinner" aria-label={isBuilding ? 'Building' : 'Synthesizing'} />
            <span className="toolbar-status" role="status" aria-live="polite">{statusMessage}</span>
            <button
              onClick={isBuilding ? handleCancelBuild : handleCancel}
              className="toolbar-cancel"
            >
              Cancel
            </button>
          </>
        )}
        {!isPlaying && !isBuilding && statusMessage && (
          <span className="toolbar-status" role="status" aria-live="polite">{statusMessage}</span>
        )}
        <button onClick={handlePlay} disabled={isPlaying || isBuilding}>▶ Play</button>
        <div className="toolbar-dropdown-anchor">
          <button
            onClick={() => setBuildMenuOpen((v) => !v)}
            disabled={isPlaying || isBuilding}
            className={buildMenuOpen ? 'toolbar-toggle-active' : ''}
            aria-expanded={buildMenuOpen}
            aria-haspopup="menu"
            title="Pick a target and build the chip"
          >
            🔧 Build ▾
          </button>
          {buildMenuOpen && (
            <>
              <div className="toolbar-dropdown-overlay" onClick={() => setBuildMenuOpen(false)} />
              <div
                className="toolbar-dropdown"
                role="menu"
                onKeyDown={(e) => handleMenuKeyDown(e, buildItemRefs.current)}
              >
                {BUILD_TARGETS.map((target, idx) => (
                  <button
                    key={target.id}
                    ref={(el) => { buildItemRefs.current[idx] = el }}
                    className="toolbar-dropdown-item"
                    role="menuitem"
                    onClick={() => handleBuild(target)}
                    title={target.description}
                  >
                    <span className="toolbar-dropdown-label">{target.icon} {target.label}</span>
                    <span className="toolbar-dropdown-desc">{target.description}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <button onClick={handleSave}>Save</button>
        <button onClick={handleLoad}>Load</button>
        <div className="toolbar-dropdown-anchor">
          <button
            onClick={() => setExamplesOpen((v) => !v)}
            className={examplesOpen ? 'toolbar-toggle-active' : ''}
            aria-expanded={examplesOpen}
            aria-haspopup="menu"
            title="Open a bundled example graph"
          >
            Examples ▾
          </button>
          {examplesOpen && (
            <>
              <div className="toolbar-dropdown-overlay" onClick={() => setExamplesOpen(false)} />
              <div
                className="toolbar-dropdown"
                role="menu"
                onKeyDown={(e) => handleMenuKeyDown(e, exampleItemRefs.current)}
              >
                {EXAMPLES.map((ex, idx) => (
                  <button
                    key={ex.id}
                    ref={(el) => { exampleItemRefs.current[idx] = el }}
                    className="toolbar-dropdown-item"
                    role="menuitem"
                    onClick={() => loadExample(ex)}
                    title={ex.description}
                  >
                    <span className="toolbar-dropdown-label">{ex.label}</span>
                    <span className="toolbar-dropdown-desc">{ex.description}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <button
          onClick={() => setChatOpen((v) => !v)}
          className={chatOpen ? 'toolbar-toggle-active' : ''}
          aria-pressed={chatOpen}
          title="Toggle AI consultant"
        >
          💬 Chat
        </button>
        <button className="toolbar-icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings">⚙</button>
        <button className="toolbar-icon-btn" onClick={() => setAboutOpen(true)} aria-label="About ChipBlocks" title="About ChipBlocks">ℹ</button>
      </div>
      <div className="main-area">
        <Palette
          collapsed={paletteCollapsed}
          onToggle={() => setPaletteCollapsed((v) => !v)}
          onAddBlock={(type) => {
            dismissStarterHint()
            canvasActions.addNode(type)
          }}
        />
        <div className="canvas" onDragOver={onDragOver} onDrop={onDrop}>
          <ErrorBoundary surface="the canvas">
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
          </ErrorBoundary>
          {showStarterHint && (
            <div className="starter-hint" role="note">
              <span className="starter-hint-icon">▶</span>
              <span className="starter-hint-text">
                Sample graph — click <strong>▶ Play</strong> in the toolbar to hear it.
              </span>
              <button
                className="starter-hint-close"
                onClick={dismissStarterHint}
                title="Dismiss"
                aria-label="Dismiss starter hint"
              >
                ×
              </button>
            </div>
          )}
        </div>
        {chatOpen && (
          <ErrorBoundary surface="the AI chat panel">
            <Chat
              nodes={nodes}
              edges={edges}
              hasApiKey={hasApiKey}
              canvasActions={canvasActions}
              onClose={() => setChatOpen(false)}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          </ErrorBoundary>
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
      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
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

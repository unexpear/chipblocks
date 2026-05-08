import { useEffect, useRef, useState } from 'react'
import type { Edge } from '@xyflow/react'
import type { AppNode } from './blocks'
import { getStoredModel, MODEL_OPTIONS } from './SettingsModal'
import { PALETTE } from './Palette'
import { buildSystemBlocks, buildTools } from './ai/prompt'
// Side-effect import: ./types/ipc declares the global Window types
// for window.chipblocks and window.ai. No symbols imported, just
// the ambient declaration.
import './types/ipc'

// ---- Anthropic content-block types -----------------------------------------
//
// The conversation history sent to the API has one of three content-block
// shapes per assistant message: text, tool_use, or tool_result (in user
// follow-up messages). For string-only assistant messages we use the
// short form `content: string`.

type TextBlock      = { type: 'text';        text: string }
type ToolUseBlock   = { type: 'tool_use';    id: string; name: string; input: Record<string, unknown> }
type ToolResultBlock = {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
}
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock

interface ApiMessage {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

// Renderer-supplied callbacks the AI can invoke via tool calls.
export interface CanvasActions {
  addNode: (
    type: string,
    data?: Record<string, unknown>,
    position?: { x: number; y: number },
  ) => string
  addEdge: (
    sourceId: string,
    targetId: string,
    sourceHandle?: string,
    targetHandle?: string,
  ) => string
  updateNodeData: (id: string, data: Record<string, unknown>) => boolean
  deleteNode: (id: string) => number  // returns # of edges also removed
  deleteEdge: (id: string) => boolean
}

interface ChatProps {
  nodes: AppNode[]
  edges: Edge[]
  hasApiKey: boolean
  canvasActions: CanvasActions
  onClose: () => void
  onOpenSettings: () => void
}

interface DisplayMessage {
  // 'tool' is a synthetic display-only role for showing tool-call results.
  role: 'user' | 'assistant' | 'tool'
  content: string
}

// Hard cap on agentic-loop iterations per user turn. Without this, a
// pathological tool-error retry loop could rack up tokens fast.
const MAX_ITERATIONS = 5

// Used by the preview-and-apply modal: format a one-line preview of a
// pending destructive tool call.
function describePendingDestructive(
  name: string,
  input: Record<string, unknown>,
  nodes: AppNode[],
  edges: Edge[],
): { title: string; lines: string[] } {
  if (name === 'delete_node') {
    const id = String(input.id ?? '')
    const node = nodes.find((n) => n.id === id)
    const edgeCount = edges.filter((e) => e.source === id || e.target === id).length
    if (!node) {
      return {
        title: 'Delete node',
        lines: [`Node ${id} not found on the canvas — nothing would change.`],
      }
    }
    const params =
      node.data && Object.keys(node.data).length > 0
        ? `(${Object.entries(node.data as Record<string, unknown>).map(([k, v]) => `${k}=${v}`).join(', ')})`
        : ''
    return {
      title: 'Delete node',
      lines: [
        `Type: ${node.type} ${params}`,
        `ID: ${id}`,
        edgeCount > 0
          ? `${edgeCount} connected edge${edgeCount === 1 ? '' : 's'} will also be removed.`
          : 'No connected edges.',
      ],
    }
  }
  if (name === 'delete_edge') {
    const id = String(input.id ?? '')
    const edge = edges.find((e) => e.id === id)
    if (!edge) {
      return {
        title: 'Delete edge',
        lines: [`Edge ${id} not found — nothing would change.`],
      }
    }
    return {
      title: 'Delete edge',
      lines: [
        `From: ${edge.source}.${edge.sourceHandle ?? '?'}`,
        `To:   ${edge.target}.${edge.targetHandle ?? '?'}`,
        `ID:   ${id}`,
      ],
    }
  }
  return { title: name, lines: [JSON.stringify(input)] }
}

export function Chat({ nodes, edges, hasApiKey, canvasActions, onClose, onOpenSettings }: ChatProps) {
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [iteration, setIteration] = useState(0)
  const [tokenTotals, setTokenTotals] = useState({ input: 0, output: 0 })
  const [error, setError] = useState<string | null>(null)

  // API-format conversation history (separate from `messages` because it
  // includes structured ContentBlock arrays for assistant messages and
  // synthetic user messages with tool_result blocks). Stays in sync with
  // displayed messages but also captures the tool_use / tool_result wiring
  // the API needs to thread tool calls properly.
  const apiHistoryRef = useRef<ApiMessage[]>([])

  // Track the in-flight request id so we can cancel.
  const currentReqId = useRef<string | null>(null)
  const streamingRef = useRef('')
  const messageListRef = useRef<HTMLDivElement>(null)

  // Pending destructive tool call: when set, the modal renders and the
  // agentic loop is awaiting the user's Apply/Reject decision.
  const [pending, setPending] = useState<{
    name: 'delete_node' | 'delete_edge'
    input: Record<string, unknown>
  } | null>(null)
  const pendingResolveRef = useRef<((r: { ok: boolean; result: string }) => void) | null>(null)
  const pendingHeadingRef = useRef<HTMLHeadingElement>(null)
  const pendingPreviousFocusRef = useRef<HTMLElement | null>(null)

  // For the agentic loop, we set up listeners once and route by request id.
  // The Promise-based `sendOneTurn` below registers per-request callbacks
  // via these refs.
  const onChunkRef = useRef<((d: { id: string; text: string }) => void) | null>(null)
  const onDoneRef = useRef<
    | ((d: {
        id: string
        usage: { input: number; output: number }
        tool_calls?: { id: string; name: string; input: Record<string, unknown> }[]
        stop_reason?: string
      }) => void)
    | null
  >(null)
  const onErrorRef = useRef<((d: { id: string; message: string }) => void) | null>(null)

  useEffect(() => {
    const el = messageListRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, streaming])

  // Focus management + Escape handling for the destructive-action confirm
  // modal. When `pending` flips from null to set: capture the previously
  // focused element, move focus to the dialog heading, listen for Escape
  // (treated as Reject). When it flips back to null: restore focus.
  useEffect(() => {
    if (!pending) return
    pendingPreviousFocusRef.current = document.activeElement as HTMLElement | null
    const raf = requestAnimationFrame(() => {
      pendingHeadingRef.current?.focus()
    })
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onRejectPending()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKeyDown)
      pendingPreviousFocusRef.current?.focus?.()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending])

  useEffect(() => {
    const offChunk = window.ai.onChunk((data) => {
      onChunkRef.current?.(data)
    })
    const offDone = window.ai.onDone((data) => {
      onDoneRef.current?.(data)
    })
    const offError = window.ai.onError((data) => {
      onErrorRef.current?.(data)
    })
    return () => {
      offChunk()
      offDone()
      offError()
    }
  }, [])

  // Validate the AI's tool-call input before applying it to the
  // canvas state. This is a defense-in-depth check (m4 from the
  // 2026-05-08 security review): the AI is the model, which is
  // ultimately untrusted user-controllable text — a prompt-injected
  // graph file or a creative model could try to add a node with
  // type "__proto__" or wire an edge to a non-existent node id.
  // Today's nodeTypes map and React Flow handle most of these
  // gracefully, but rejecting at the door means a bad tool call
  // is a clean error to the AI rather than a corrupted canvas.
  const KNOWN_BLOCK_TYPES = new Set(PALETTE.map((p) => p.type))

  const isPlainData = (v: unknown): v is Record<string, unknown> => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
    for (const [, value] of Object.entries(v)) {
      if (
        value !== null &&
        typeof value !== 'string' &&
        typeof value !== 'number' &&
        typeof value !== 'boolean'
      ) return false
    }
    return true
  }

  const applyToolCall = async (
    name: string,
    input: Record<string, unknown>,
  ): Promise<{ ok: boolean; result: string }> => {
    try {
      if (name === 'add_node') {
        const type = String(input.type ?? '')
        if (!KNOWN_BLOCK_TYPES.has(type)) {
          return { ok: false, result: `Unknown block type "${type}". Valid types: ${[...KNOWN_BLOCK_TYPES].join(', ')}` }
        }
        const data = input.data === undefined ? undefined : input.data
        if (data !== undefined && !isPlainData(data)) {
          return { ok: false, result: `Invalid data for ${type}: must be a flat object of strings/numbers/booleans.` }
        }
        const id = canvasActions.addNode(type, data as Record<string, unknown> | undefined)
        return { ok: true, result: `Added ${type} as ${id}` }
      }
      if (name === 'add_edge') {
        const sourceId = String(input.source_id ?? '')
        const targetId = String(input.target_id ?? '')
        if (!nodes.some((n) => n.id === sourceId)) {
          return { ok: false, result: `Source node "${sourceId}" not found on the canvas.` }
        }
        if (!nodes.some((n) => n.id === targetId)) {
          return { ok: false, result: `Target node "${targetId}" not found on the canvas.` }
        }
        const id = canvasActions.addEdge(
          sourceId,
          targetId,
          input.source_handle ? String(input.source_handle) : undefined,
          input.target_handle ? String(input.target_handle) : undefined,
        )
        return {
          ok: true,
          result: `Wired ${sourceId}.${input.source_handle} → ${targetId}.${input.target_handle} as ${id}`,
        }
      }
      if (name === 'update_node_params') {
        const id = String(input.id ?? '')
        if (!nodes.some((n) => n.id === id)) {
          return { ok: false, result: `Node "${id}" not found on the canvas.` }
        }
        const data = input.data
        if (!isPlainData(data)) {
          return { ok: false, result: `Invalid data: must be a flat object of strings/numbers/booleans.` }
        }
        canvasActions.updateNodeData(id, data)
        return { ok: true, result: `Updated ${id}` }
      }
      // Destructive tools: route through the preview-and-apply modal.
      if (name === 'delete_node' || name === 'delete_edge') {
        return await new Promise<{ ok: boolean; result: string }>((resolve) => {
          pendingResolveRef.current = resolve
          setPending({ name, input })
        })
      }
      return { ok: false, result: `Unknown tool: ${name}` }
    } catch (err) {
      return { ok: false, result: (err as Error).message }
    }
  }

  const onConfirmPending = () => {
    if (!pending) return
    let result: { ok: boolean; result: string }
    try {
      if (pending.name === 'delete_node') {
        const id = String(pending.input.id ?? '')
        const removedEdges = canvasActions.deleteNode(id)
        result = {
          ok: true,
          result: `Deleted node ${id}${removedEdges > 0 ? ` and ${removedEdges} connected edge${removedEdges === 1 ? '' : 's'}` : ''}`,
        }
      } else {
        const id = String(pending.input.id ?? '')
        const found = canvasActions.deleteEdge(id)
        result = found
          ? { ok: true, result: `Deleted edge ${id}` }
          : { ok: false, result: `Edge ${id} not found` }
      }
    } catch (err) {
      result = { ok: false, result: (err as Error).message }
    }
    setPending(null)
    const resolve = pendingResolveRef.current
    pendingResolveRef.current = null
    resolve?.(result)
  }

  const onRejectPending = () => {
    if (!pending) return
    setPending(null)
    const resolve = pendingResolveRef.current
    pendingResolveRef.current = null
    resolve?.({ ok: false, result: 'User rejected the change.' })
  }

  // One iteration of the loop: ship the current history, await a complete
  // response (text + any tool calls), return what came back.
  const sendOneTurn = (apiMessages: ApiMessage[]) =>
    new Promise<{
      text: string
      toolCalls: { id: string; name: string; input: Record<string, unknown> }[]
      usage: { input: number; output: number }
    }>(async (resolve, reject) => {
      const id = crypto.randomUUID()
      currentReqId.current = id
      streamingRef.current = ''
      setStreaming('')

      onChunkRef.current = ({ id: chunkId, text }) => {
        if (chunkId !== id) return
        streamingRef.current += text
        setStreaming(streamingRef.current)
      }
      onDoneRef.current = ({ id: doneId, usage, tool_calls }) => {
        if (doneId !== id) return
        onChunkRef.current = null
        onDoneRef.current = null
        onErrorRef.current = null
        resolve({
          text: streamingRef.current,
          toolCalls: tool_calls ?? [],
          usage,
        })
      }
      onErrorRef.current = ({ id: errId, message }) => {
        if (errId !== id) return
        onChunkRef.current = null
        onDoneRef.current = null
        onErrorRef.current = null
        reject(new Error(message))
      }

      try {
        await window.ai.chat({
          id,
          model: getStoredModel(),
          messages: apiMessages,
          system: buildSystemBlocks(nodes, edges),
          tools: buildTools(),
        })
      } catch (err) {
        onChunkRef.current = null
        onDoneRef.current = null
        onErrorRef.current = null
        reject(err)
      }
    })

  // Drives the multi-step agentic loop. Each iteration: send, get text +
  // tools, append assistant message to history, apply tools (if any),
  // append tool_result user message to history, repeat — bounded by
  // MAX_ITERATIONS — until the model stops calling tools.
  const runAgenticTurn = async (initialHistory: ApiMessage[]) => {
    let history = initialHistory

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      setIteration(i + 1)
      streamingRef.current = ''
      setStreaming('')

      const { text, toolCalls, usage } = await sendOneTurn(history)
      setTokenTotals((t) => ({ input: t.input + usage.input, output: t.output + usage.output }))

      // Display the streamed text as a final assistant message.
      if (text.trim()) {
        setMessages((prev) => [...prev, { role: 'assistant', content: text }])
      }

      // Build the assistant API message: text + any tool_use blocks.
      const assistantContent: ContentBlock[] = []
      if (text.trim()) assistantContent.push({ type: 'text', text })
      for (const tc of toolCalls) {
        assistantContent.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.input,
        })
      }
      const assistantMsg: ApiMessage = {
        role: 'assistant',
        // If only text and no tool_use, use string form for cleanliness.
        content:
          toolCalls.length === 0 && text.trim()
            ? text
            : assistantContent,
      }
      history = [...history, assistantMsg]

      if (toolCalls.length === 0) {
        // No tools called this turn — conversation has stopped naturally.
        break
      }

      // Apply each tool, display the result in chat, and assemble
      // tool_result blocks for the follow-up user message. applyToolCall
      // is async because destructive tools route through the
      // preview-and-apply modal and resolve only when the user clicks.
      const toolResults: ToolResultBlock[] = []
      for (const call of toolCalls) {
        const r = await applyToolCall(call.name, call.input)
        setMessages((prev) => [
          ...prev,
          {
            role: 'tool',
            content: `${r.ok ? '✓' : '✗'} ${call.name}: ${r.result}`,
          },
        ])
        toolResults.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: JSON.stringify({ ok: r.ok, message: r.result }),
          is_error: !r.ok,
        })
      }

      // Synthetic user message carrying the tool_result blocks back to Claude.
      history = [...history, { role: 'user', content: toolResults }]

      if (i === MAX_ITERATIONS - 1) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'tool',
            content: `(reached ${MAX_ITERATIONS}-iteration cap; stopping)`,
          },
        ])
      }
    }

    apiHistoryRef.current = history
    setIteration(0)
    setIsStreaming(false)
    streamingRef.current = ''
    setStreaming('')
    currentReqId.current = null
  }

  const send = async () => {
    const text = input.trim()
    if (!text || isStreaming) return
    if (!hasApiKey) {
      setError('Configure your Anthropic API key in Settings first.')
      return
    }

    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setInput('')
    setError(null)
    setIsStreaming(true)

    const newHistory: ApiMessage[] = [
      ...apiHistoryRef.current,
      { role: 'user', content: text },
    ]

    try {
      await runAgenticTurn(newHistory)
    } catch (err) {
      setError((err as Error).message)
      setIsStreaming(false)
      setIteration(0)
      currentReqId.current = null
    }
  }

  const cancel = async () => {
    const id = currentReqId.current
    if (!id) return
    await window.ai.cancel(id)
    setIsStreaming(false)
    setIteration(0)
    streamingRef.current = ''
    setStreaming('')
    currentReqId.current = null
  }

  const clearConversation = () => {
    setMessages([])
    apiHistoryRef.current = []
    setStreaming('')
    setError(null)
    setTokenTotals({ input: 0, output: 0 })
    setIteration(0)
  }

  const onInputKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  // Render the preview-and-apply modal when a destructive tool call is
  // pending. This sits alongside the chat aside; CSS positions it as a
  // fixed overlay regardless of DOM placement.
  const pendingPreview = pending
    ? describePendingDestructive(pending.name, pending.input, nodes, edges)
    : null

  return (
    <>
    <aside className="chat-panel">
      <div className="chat-header">
        <span className="chat-title">AI Consultant</span>
        <span className="chat-spacer" />
        <button className="chat-icon-btn" onClick={onOpenSettings} title="Settings">⚙</button>
        <button className="chat-icon-btn" onClick={clearConversation} title="Clear conversation">↺</button>
        <button className="chat-icon-btn" onClick={onClose} title="Close chat">×</button>
      </div>

      {!hasApiKey ? (
        <div className="chat-empty">
          <p>Add your Anthropic API key to enable the consultant.</p>
          <p className="chat-empty-note">
            ChipBlocks calls Anthropic with your key (BYOK). Your key is stored encrypted via your OS keychain (Electron <code>safeStorage</code>) and never sent anywhere except Anthropic.
          </p>
          <button onClick={onOpenSettings}>Open settings</button>
        </div>
      ) : (
        <>
          <div className="chat-messages" ref={messageListRef} aria-live="polite">
            {messages.length === 0 && !streaming && (
              <div className="chat-hint">
                Ask anything — e.g. <em>"Drop in a low-pass filter at 600 Hz between the oscillator and the output, then tell me what changed"</em> or <em>"What does my current graph produce?"</em>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`chat-msg chat-msg-${m.role}`}>
                <div className="chat-msg-role">{
                  m.role === 'user' ? 'You' :
                  m.role === 'assistant' ? 'AI' :
                  'Tool'
                }</div>
                <div className="chat-msg-body">{m.content}</div>
              </div>
            ))}
            {isStreaming && (
              <div className="chat-msg chat-msg-assistant">
                <div className="chat-msg-role">AI{iteration > 1 ? ` (step ${iteration})` : ''}</div>
                <div className="chat-msg-body">{streaming}<span className="chat-cursor">▍</span></div>
              </div>
            )}
            {error && (
              <div className="chat-error" onClick={() => setError(null)} title="Click to dismiss">
                <strong>Error:</strong> {error}
              </div>
            )}
          </div>

          <div className="chat-input-row">
            <textarea
              className="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onInputKey}
              placeholder={isStreaming ? 'AI is thinking…' : 'Ask the consultant…'}
              rows={2}
              disabled={isStreaming}
            />
            {isStreaming ? (
              <button onClick={cancel} className="chat-send-btn chat-cancel-btn">Stop</button>
            ) : (
              <button onClick={send} className="chat-send-btn" disabled={!input.trim()}>
                Send
              </button>
            )}
          </div>

          <div className="chat-footer">
            <span>Tokens: {tokenTotals.input.toLocaleString()} in / {tokenTotals.output.toLocaleString()} out</span>
            <span className="chat-spacer" />
            <span className="chat-model">{
              MODEL_OPTIONS.find((m) => m.id === getStoredModel())?.label.split(' — ')[0]
              ?? getStoredModel()
            }</span>
          </div>
        </>
      )}
    </aside>
    {pending && pendingPreview && (
      <div className="modal-backdrop">
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-preview-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-header">
            <h2 id="confirm-preview-title" ref={pendingHeadingRef} tabIndex={-1}>
              AI wants to {pendingPreview.title.toLowerCase()}
            </h2>
          </div>
          <div className="modal-body">
            <p className="modal-note">
              The AI consultant is about to make a destructive change. Apply it, or reject and the AI will see the rejection and can try something else.
            </p>
            <div className="confirm-preview">
              {pendingPreview.lines.map((line, i) => (
                <div key={i} className="confirm-line">{line}</div>
              ))}
            </div>
            <div className="modal-actions">
              <button onClick={onConfirmPending} className="confirm-apply">Apply</button>
              <button onClick={onRejectPending} className="modal-danger">Reject</button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  )
}

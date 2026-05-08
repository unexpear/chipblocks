import { useEffect, useRef, useState } from 'react'
import type { Edge } from '@xyflow/react'
import type { AppNode } from './blocks'
import { getStoredModel, MODEL_OPTIONS } from './SettingsModal'
import { PALETTE } from './Palette'

declare global {
  interface Window {
    ai: {
      saveKey: (key: string) => Promise<boolean>
      hasKey: () => Promise<boolean>
      clearKey: () => Promise<boolean>
      chat: (req: {
        id: string
        model?: string
        messages: ApiMessage[]
        system: { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }[]
        tools?: unknown[]
      }) => Promise<boolean>
      cancel: (id: string) => Promise<boolean>
      onChunk: (cb: (data: { id: string; text: string }) => void) => () => void
      onDone: (
        cb: (data: {
          id: string
          usage: { input: number; output: number }
          stop_reason?: string
          tool_calls?: { id: string; name: string; input: Record<string, unknown> }[]
        }) => void,
      ) => () => void
      onError: (cb: (data: { id: string; message: string }) => void) => () => void
    }
  }
}

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

const STATIC_SYSTEM = `You are the AI consultant for ChipBlocks, a free open-source visual chip-design app.

The user is building a digital audio "chip" by wiring together blocks on a canvas. Your job is to help them understand what they have, suggest what to add or change, and answer chip-design questions in plain English. The user is non-technical — avoid HDL jargon (RTL, FSM, synthesis, place-and-route) unless they ask.

# Available block types

ChipBlocks has 9 block types. All audio signals are 8-bit signed (-128 to +127) at 44100 Hz.

**Oscillator** — square-wave source.
- Output port \`audio-out\` (8-bit signed audio)
- Parameter \`freq\`: frequency in Hz (20–20000)

**Triangle** — triangle-wave source. Mellower harmonics than square.
- Output port \`audio-out\`
- Parameter \`freq\`: Hz

**Sawtooth** — sawtooth-wave source. Brighter / buzzier than triangle.
- Output port \`audio-out\`
- Parameter \`freq\`: Hz

**Mixer** — averages two audio signals.
- Input ports \`in-1\`, \`in-2\` (both 8-bit signed)
- Output port \`mix-out\`. Equals (in-1 + in-2) / 2.

**Output** — audio sink. Whatever's wired to its \`audio-in\` port becomes the WAV file when the user hits Play. There must be exactly one Output block in the graph for audio to come out.
- Input port \`audio-in\`

**ADSR** — Attack/Decay/Sustain/Release amplitude envelope.
- Input ports: \`gate\` (1-bit trigger), \`audio-in\` (8-bit signed)
- Output port: \`audio-out\`
- Parameters: \`attack_ms\`, \`decay_ms\`, \`sustain_level\` (0–127), \`release_ms\`

**Gate** — periodic 1-bit pulse generator. Wire to ADSR's \`gate\` to retrigger the envelope.
- Output port \`gate-out\` (1-bit)
- Parameters: \`rate_hz\`, \`duty_pct\` (1–99)

**Low-pass** — 1-pole IIR low-pass filter. Lower cutoff = more smoothing.
- Input port \`audio-in\` (8-bit signed)
- Output port \`audio-out\`
- Parameter \`cutoff_hz\` (1–22050)

**S & H** — sample-and-hold. Captures \`audio-in\` on each rising edge of \`clock\`.
- Input ports: \`audio-in\` (8-bit signed), \`clock\` (1-bit)
- Output port \`audio-out\`

# Tool use

You have three tools to mutate the canvas: \`add_node\`, \`add_edge\`, and \`update_node_params\`. When the user asks you to make a change, use the tools — don't just describe the change in text.

After tool calls, you'll receive \`tool_result\` content blocks with the outcome of each call (the new node/edge id, or an error). Use those results to plan further calls or to write a final text summary of what you did.

# Style

- Be concrete. Reference specific block types and parameter values.
- Keep responses tight — a short paragraph or a short list.
- If the goal isn't possible with the current 9 block types, say so plainly. Don't invent capabilities.
- After multi-step tool sequences, end with a short text confirmation of what you did so the user knows where things landed.`

function buildSystemBlocks(nodes: AppNode[], edges: Edge[]) {
  return [
    {
      type: 'text' as const,
      text: STATIC_SYSTEM,
      cache_control: { type: 'ephemeral' as const },
    },
    {
      type: 'text' as const,
      text:
        '# Current canvas state\n\n' +
        'The user has these blocks wired right now. Reference them by `id` when relevant.\n\n' +
        '```json\n' +
        JSON.stringify({ nodes, edges }, null, 2) +
        '\n```',
    },
  ]
}

function buildTools() {
  const blockTypeIds = PALETTE.map((p) => p.type)
  return [
    {
      name: 'add_node',
      description:
        'Add a new block to the canvas. Returns the new node id.',
      input_schema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: blockTypeIds,
            description: 'The block type to add',
          },
          data: {
            type: 'object',
            description:
              'Optional initial parameters (e.g. {"freq": 440} for waveform sources, {"cutoff_hz": 800} for lowpass, {"attack_ms": 10, "decay_ms": 100, "sustain_level": 80, "release_ms": 200} for adsr). Omit to use defaults.',
          },
        },
        required: ['type'],
      },
    },
    {
      name: 'add_edge',
      description:
        "Wire two blocks together. Connects the source block's named output handle to the target block's named input handle.",
      input_schema: {
        type: 'object',
        properties: {
          source_id: { type: 'string' },
          target_id: { type: 'string' },
          source_handle: { type: 'string', description: 'e.g. "audio-out", "mix-out", "gate-out"' },
          target_handle: { type: 'string', description: 'e.g. "audio-in", "in-1", "in-2", "gate", "clock"' },
        },
        required: ['source_id', 'target_id', 'source_handle', 'target_handle'],
      },
    },
    {
      name: 'update_node_params',
      description: 'Change parameters on an existing block by id. Pass only the fields you want to change.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          data: { type: 'object' },
        },
        required: ['id', 'data'],
      },
    },
  ]
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

  const applyToolCall = (
    name: string,
    input: Record<string, unknown>,
  ): { ok: boolean; result: string } => {
    try {
      if (name === 'add_node') {
        const type = String(input.type ?? '')
        const data = (input.data as Record<string, unknown> | undefined) ?? undefined
        const id = canvasActions.addNode(type, data)
        return { ok: true, result: `Added ${type} as ${id}` }
      }
      if (name === 'add_edge') {
        const id = canvasActions.addEdge(
          String(input.source_id ?? ''),
          String(input.target_id ?? ''),
          input.source_handle ? String(input.source_handle) : undefined,
          input.target_handle ? String(input.target_handle) : undefined,
        )
        return {
          ok: true,
          result: `Wired ${input.source_id}.${input.source_handle} → ${input.target_id}.${input.target_handle} as ${id}`,
        }
      }
      if (name === 'update_node_params') {
        canvasActions.updateNodeData(
          String(input.id ?? ''),
          (input.data as Record<string, unknown>) ?? {},
        )
        return { ok: true, result: `Updated ${input.id}` }
      }
      return { ok: false, result: `Unknown tool: ${name}` }
    } catch (err) {
      return { ok: false, result: (err as Error).message }
    }
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
      // tool_result blocks for the follow-up user message.
      const toolResults: ToolResultBlock[] = []
      for (const call of toolCalls) {
        const r = applyToolCall(call.name, call.input)
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

  return (
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
          <div className="chat-messages" ref={messageListRef}>
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
  )
}

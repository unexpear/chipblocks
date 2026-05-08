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
        messages: { role: 'user' | 'assistant'; content: string }[]
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

interface ChatMessage {
  // 'tool' is a synthetic role for display only — shows the result of an
  // AI tool call. Not sent back to the model.
  role: 'user' | 'assistant' | 'tool'
  content: string
}

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

**ADSR** — Attack/Decay/Sustain/Release amplitude envelope. Shapes a signal so it fades in, fades down to a sustain level, holds, then fades out when its gate drops.
- Input ports: \`gate\` (1-bit trigger), \`audio-in\` (8-bit signed)
- Output port: \`audio-out\`
- Parameters: \`attack_ms\`, \`decay_ms\`, \`sustain_level\` (0–127), \`release_ms\`

**Gate** — periodic 1-bit pulse generator. Wire to ADSR's \`gate\` port to retrigger the envelope on every pulse.
- Output port \`gate-out\` (1-bit)
- Parameters: \`rate_hz\`, \`duty_pct\` (1–99)

**Low-pass** — 1-pole IIR low-pass filter. Smooths an audio signal; lower cutoff = more smoothing.
- Input port \`audio-in\` (8-bit signed)
- Output port \`audio-out\`
- Parameter \`cutoff_hz\` (1–22050)

**S & H** (sample-and-hold) — captures \`audio-in\` on each rising edge of \`clock\`, holds the value at \`audio-out\` until the next rising edge. Useful for arpeggio/stair-step effects.
- Input ports: \`audio-in\` (8-bit signed), \`clock\` (1-bit)
- Output port \`audio-out\`

# Tool use

You have three tools to mutate the canvas: \`add_node\`, \`add_edge\`, and \`update_node_params\`. When the user asks you to make a change ("drop in a low-pass filter", "make the oscillator 880 Hz", "wire the sawtooth to the mixer's second input"), use the tools — don't just describe the change. The user sees each tool call appear as a confirmation in the chat.

Use \`add_node\` first to spawn new blocks, then \`add_edge\` to wire them, then \`update_node_params\` if needed. Reference existing nodes by their \`id\` from the canvas state below.

# Style

- Be concrete. Reference specific block types and parameter values.
- Keep responses tight — a short paragraph or a short list. The user can ask follow-ups.
- If the goal isn't possible with the current 9 block types, say so plainly. Don't invent capabilities.`

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

// Anthropic tool definitions. Schema-validated by the API.
function buildTools() {
  const blockTypeIds = PALETTE.map((p) => p.type)
  return [
    {
      name: 'add_node',
      description:
        'Add a new block to the canvas. Returns the new node id. Use this to introduce new blocks before wiring them with add_edge.',
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
              'Optional initial parameters specific to the block type (e.g. {"freq": 440} for oscillator/triangle/sawtooth, {"cutoff_hz": 800} for lowpass, {"attack_ms": 10, "decay_ms": 100, "sustain_level": 80, "release_ms": 200} for adsr). Omit to use defaults.',
          },
        },
        required: ['type'],
      },
    },
    {
      name: 'add_edge',
      description:
        'Wire two blocks together. Connects the source block`s named output handle to the target block`s named input handle.',
      input_schema: {
        type: 'object',
        properties: {
          source_id: { type: 'string', description: 'ID of the source (output) node' },
          target_id: { type: 'string', description: 'ID of the target (input) node' },
          source_handle: {
            type: 'string',
            description:
              'Output port name on the source (e.g. "audio-out" for waveform sources, "mix-out" for mixer, "gate-out" for gate).',
          },
          target_handle: {
            type: 'string',
            description:
              'Input port name on the target (e.g. "audio-in", "in-1", "in-2", "gate", "clock").',
          },
        },
        required: ['source_id', 'target_id', 'source_handle', 'target_handle'],
      },
    },
    {
      name: 'update_node_params',
      description: "Change a parameter on an existing block by id. Pass only the fields you want to change.",
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID of the node to update' },
          data: {
            type: 'object',
            description: 'Partial parameters to merge into the node`s data',
          },
        },
        required: ['id', 'data'],
      },
    },
  ]
}

export function Chat({ nodes, edges, hasApiKey, canvasActions, onClose, onOpenSettings }: ChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [tokenTotals, setTokenTotals] = useState({ input: 0, output: 0 })
  const [error, setError] = useState<string | null>(null)

  const currentReqId = useRef<string | null>(null)
  const streamingRef = useRef('')
  const messageListRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = messageListRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, streaming])

  // Apply a tool call from Claude to the canvas; return a short status string
  // for display in the chat as a tool annotation.
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

  useEffect(() => {
    const offChunk = window.ai.onChunk(({ id, text }) => {
      if (id !== currentReqId.current) return
      streamingRef.current += text
      setStreaming(streamingRef.current)
    })
    const offDone = window.ai.onDone(({ id, usage, tool_calls }) => {
      if (id !== currentReqId.current) return
      const finalText = streamingRef.current
      streamingRef.current = ''
      setStreaming('')
      setIsStreaming(false)
      currentReqId.current = null

      // Append the assistant message (text portion) if non-empty.
      const newMessages: ChatMessage[] = []
      if (finalText.trim()) {
        newMessages.push({ role: 'assistant', content: finalText })
      }

      // Apply each tool call and append a synthetic 'tool' message
      // describing the result.
      if (tool_calls && tool_calls.length > 0) {
        for (const call of tool_calls) {
          const r = applyToolCall(call.name, call.input)
          newMessages.push({
            role: 'tool',
            content: `${r.ok ? '✓' : '✗'} ${call.name}: ${r.result}`,
          })
        }
      }

      setMessages((prev) => [...prev, ...newMessages])
      setTokenTotals((t) => ({ input: t.input + usage.input, output: t.output + usage.output }))
    })
    const offError = window.ai.onError(({ id, message }) => {
      if (id !== currentReqId.current) return
      streamingRef.current = ''
      setStreaming('')
      setIsStreaming(false)
      currentReqId.current = null
      setError(message)
    })
    return () => {
      offChunk()
      offDone()
      offError()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const send = async () => {
    const text = input.trim()
    if (!text || isStreaming) return
    if (!hasApiKey) {
      setError('Configure your Anthropic API key in Settings first.')
      return
    }
    const userMsg: ChatMessage = { role: 'user', content: text }
    const newHistory = [...messages, userMsg]
    setMessages(newHistory)
    setInput('')
    setError(null)
    setIsStreaming(true)
    streamingRef.current = ''
    setStreaming('')

    const id = crypto.randomUUID()
    currentReqId.current = id

    // Filter out synthetic 'tool' role messages before sending to the API
    // — they're for display only.
    const apiMessages = newHistory
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

    try {
      await window.ai.chat({
        id,
        model: getStoredModel(),
        messages: apiMessages,
        system: buildSystemBlocks(nodes, edges),
        tools: buildTools(),
      })
    } catch (err) {
      setError((err as Error).message)
      setIsStreaming(false)
      currentReqId.current = null
    }
  }

  const cancel = async () => {
    const id = currentReqId.current
    if (!id) return
    await window.ai.cancel(id)
    setIsStreaming(false)
    streamingRef.current = ''
    setStreaming('')
    currentReqId.current = null
  }

  const clearConversation = () => {
    setMessages([])
    setStreaming('')
    setError(null)
    setTokenTotals({ input: 0, output: 0 })
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
                Ask anything — e.g. <em>"Drop in a low-pass filter between the oscillator and the output"</em> or <em>"What does my current graph produce?"</em>
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
                <div className="chat-msg-role">AI</div>
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

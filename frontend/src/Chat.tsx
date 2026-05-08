import { useEffect, useRef, useState } from 'react'
import type { Edge } from '@xyflow/react'
import type { AppNode } from './blocks'
import { getStoredModel, MODEL_OPTIONS } from './SettingsModal'

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
      }) => Promise<boolean>
      cancel: (id: string) => Promise<boolean>
      onChunk: (cb: (data: { id: string; text: string }) => void) => () => void
      onDone: (cb: (data: { id: string; usage: { input: number; output: number } }) => void) => () => void
      onError: (cb: (data: { id: string; message: string }) => void) => () => void
    }
  }
}

interface ChatProps {
  nodes: AppNode[]
  edges: Edge[]
  hasApiKey: boolean
  onClose: () => void
  onOpenSettings: () => void
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

// Static, cacheable portion of the system prompt. Block library spec
// changes only when we add new block types — perfect for prompt caching.
const STATIC_SYSTEM = `You are the AI consultant for ChipBlocks, a free open-source visual chip-design app.

The user is building a digital audio "chip" by wiring together blocks on a canvas. Your job is to help them understand what they have, suggest what to add or change, and answer chip-design questions in plain English. The user is non-technical — avoid HDL jargon (RTL, FSM, synthesis, place-and-route) unless they ask.

# Available block types

ChipBlocks has 7 block types. All audio signals are 8-bit signed (-128 to +127) at 44100 Hz.

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

**ADSR** — Attack/Decay/Sustain/Release amplitude envelope. Shapes a signal so it fades in, fades down to a sustain level, holds, then fades out when its gate drops. Classic synth element for making notes sound like notes.
- Input ports: \`gate\` (1-bit trigger), \`audio-in\` (8-bit signed)
- Output port: \`audio-out\`
- Parameters: \`attack_ms\`, \`decay_ms\`, \`sustain_level\` (0–127), \`release_ms\`

**Gate** — periodic 1-bit pulse generator. Wire to ADSR's \`gate\` port to retrigger the envelope on every pulse.
- Output port \`gate-out\` (1-bit)
- Parameters: \`rate_hz\`, \`duty_pct\` (1–99)

# Style

- Be concrete. When suggesting changes, name specific block types and parameter values.
- For "how do I do X?" questions, suggest a specific wiring of existing blocks. Sketch with arrow notation if useful (e.g. \`Triangle(220) → ADSR ← Gate(2) → Output\`).
- Keep responses tight — a short paragraph or a short list. The user can ask follow-ups.
- If the goal isn't possible with the current 7 block types, say so plainly. Don't invent capabilities.`

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

export function Chat({ nodes, edges, hasApiKey, onClose, onOpenSettings }: ChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [tokenTotals, setTokenTotals] = useState({ input: 0, output: 0 })
  const [error, setError] = useState<string | null>(null)

  const currentReqId = useRef<string | null>(null)
  const streamingRef = useRef('')
  const messageListRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to the bottom when new content arrives.
  useEffect(() => {
    const el = messageListRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, streaming])

  // Subscribe to AI streaming events from the main process.
  useEffect(() => {
    const offChunk = window.ai.onChunk(({ id, text }) => {
      if (id !== currentReqId.current) return
      streamingRef.current += text
      setStreaming(streamingRef.current)
    })
    const offDone = window.ai.onDone(({ id, usage }) => {
      if (id !== currentReqId.current) return
      const finalText = streamingRef.current
      streamingRef.current = ''
      setStreaming('')
      setIsStreaming(false)
      currentReqId.current = null
      setMessages((prev) => [...prev, { role: 'assistant', content: finalText }])
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

    try {
      await window.ai.chat({
        id,
        model: getStoredModel(),
        messages: newHistory,
        system: buildSystemBlocks(nodes, edges),
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
    // Enter sends; Shift+Enter inserts a newline.
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
                Ask anything — e.g. <em>"How do I make a vibrato sound?"</em> or <em>"What does my current graph produce?"</em>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`chat-msg chat-msg-${m.role}`}>
                <div className="chat-msg-role">{m.role === 'user' ? 'You' : 'AI'}</div>
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

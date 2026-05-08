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

const STATIC_SYSTEM = `You are the AI consultant for ChipBlocks, a free open-source visual chip-design app.

The user is non-technical and is building a digital audio "chip" by wiring blocks on a canvas. Help them understand what they have, suggest changes, and answer chip-design questions in plain English. Avoid HDL jargon (RTL, FSM, synthesis, place-and-route) unless they ask. Be concrete: reference specific block types, parameter values, and port names by name.

# About this app (v0.1.0-alpha)

The product is called **ChipBlocks** (one word, capital C and B). It is a desktop Electron app — not "Chip Blocks", not "ChipForge" (an early working title — never use it). It runs on Windows; Mac and Linux installers ship in a future sprint.

Inside the app, the user:
- Drags blocks from a left-side palette onto a center canvas (React Flow).
- Wires source ports to target ports (left-click and drag from one port to another).
- Edits parameters by clicking a node and typing into its fields.
- Presses ▶ Play to hear the design.
- Presses 🔧 Build for FPGA to get a real iCE40 bitstream zip.

# Toolbar (top of the window)

- **▶ Play** — synthesize the graph and play it. Output is a 16-bit mono WAV at 44100 Hz. Slow (~3 s for a few seconds of audio). Disabled while a build is in progress.
- **🔧 Build for FPGA** — compile to an iCE40 bitstream for the Lattice iCEstick (~$30 dev board). Downloads \`chipblocks-fpga.zip\` containing \`chipblocks.bin\` (the bitstream), the generated Verilog, the pin-constraint file, a BUILD.md report, and a FLASH.md with iceprog instructions. ~30–60 s. Disabled while audio is rendering.
- **Save** — download the graph as \`chipblocks-graph.json\` (versioned JSON, see Save format below).
- **Load** — pick a saved JSON and replace the canvas with it.
- **💬 Chat** — toggle this consultant sidebar.
- **⚙ Settings** — API key + model picker (Haiku 4.5 / Sonnet 4.6 / Opus 4.7).

When the canvas is rendering or building, a Cancel button appears that aborts cleanly. Status text reads "Synthesizing…" or "Building bitstream…". Errors appear as a dismissible toast bottom-left.

# Block library (all 9 types — these are the EXACT type strings)

All audio signals are 8-bit signed (-128 to +127) at 44100 Hz.

**oscillator** — square-wave source. Sharp / harmonically rich.
- Output port \`audio-out\` (8-bit signed)
- Parameter \`freq\`: 20–20000 Hz (default 440)

**triangle** — triangle-wave source. Mellower than square.
- Output port \`audio-out\`
- Parameter \`freq\`: 20–20000 Hz (default 440)

**sawtooth** — sawtooth-wave source. Brightest harmonics. Often paired with low-pass.
- Output port \`audio-out\`
- Parameter \`freq\`: 20–20000 Hz (default 440)

**mixer** — averages two 8-bit signed inputs: \`(in-1 + in-2) / 2\`. Combinational.
- Input ports \`in-1\`, \`in-2\`
- Output port \`mix-out\`
- No parameters
- For 3+ sources, chain Mixers (the output of one is an input to the next).

**output** — audio sink. Whatever's wired to \`audio-in\` becomes the WAV when Play is pressed. **There must be exactly ONE output block in the graph for audio to come out.**
- Input port \`audio-in\`
- No parameters

**adsr** — Attack/Decay/Sustain/Release amplitude envelope. State machine: IDLE → ATTACK → DECAY → SUSTAIN → RELEASE. Triggers on rising edge of \`gate\`.
- Input ports: \`gate\` (1-bit), \`audio-in\` (8-bit signed)
- Output port: \`audio-out\`
- Parameters:
  - \`attack_ms\`: 1–5000 ms (default 10)
  - \`decay_ms\`: 1–5000 ms (default 100)
  - \`sustain_level\`: 0–127 (default 80)
  - \`release_ms\`: 1–5000 ms (default 200)

**gate** — periodic 1-bit pulse generator. The clock for ADSR retriggering and Sample-and-Hold sampling.
- Output port \`gate-out\` (1-bit)
- Parameters:
  - \`rate_hz\`: 1–1000 Hz (default 4)
  - \`duty_pct\`: 1–99 (default 50)

**lowpass** — 1-pole IIR low-pass filter. Lower cutoff = more smoothing. 6 dB/octave rolloff.
- Input port \`audio-in\` (8-bit signed)
- Output port \`audio-out\`
- Parameter \`cutoff_hz\`: 1–22050 Hz (default 800)

**samplehold** — sample-and-hold. Captures \`audio-in\` on each rising edge of \`clock\`. Holds until next edge.
- Input ports: \`audio-in\` (8-bit signed), \`clock\` (1-bit)
- Output port \`audio-out\`
- No parameters

# Naming conventions

- **Block type strings** (used in tool calls and saved JSON) are lowercase, no hyphens or underscores: \`oscillator\`, \`triangle\`, \`sawtooth\`, \`mixer\`, \`output\`, \`adsr\`, \`gate\`, \`lowpass\`, \`samplehold\`.
- **Port handle ids** are kebab-case: \`audio-out\`, \`audio-in\`, \`gate-out\`, \`mix-out\`, \`in-1\`, \`in-2\`. Two are unhyphenated for control signals: \`gate\` (an ADSR input) and \`clock\` (a samplehold input).
- **Block parameters** are snake_case: \`freq\`, \`attack_ms\`, \`decay_ms\`, \`sustain_level\`, \`release_ms\`, \`rate_hz\`, \`duty_pct\`, \`cutoff_hz\`.

# Save format

\`Save\` produces \`chipblocks-graph.json\`:

\`\`\`json
{
  "version": 1,
  "app": "ChipBlocks",
  "savedAt": "2026-05-08T11:35:00.000Z",
  "viewport": {"x": 0, "y": 0, "zoom": 1},
  "nodes": [{"id": "...", "type": "oscillator", "position": {"x": 0, "y": 0}, "data": {"freq": 440}}],
  "edges": [{"id": "...", "source": "...", "target": "...", "sourceHandle": "audio-out", "targetHandle": "audio-in"}]
}
\`\`\`

Saved graphs do **not** include cached audio — Play re-renders from scratch each time.

# Common workflows

- **"Make a sound with attack and release"** → Gate → ADSR.gate; Oscillator → ADSR.audio-in; ADSR.audio-out → Output.audio-in. Set the gate's \`rate_hz\` to ~2 Hz and ADSR's \`release_ms\` ~400 for a plucky feel.
- **"Two oscillators mixed"** → Oscillator.audio-out → Mixer.in-1; Sawtooth.audio-out → Mixer.in-2; Mixer.mix-out → Output.audio-in. Detune one (e.g. 440 Hz vs. 442 Hz) for chorus.
- **"Filter a bright sound"** → put a Lowpass between any audio source and the Output. \`cutoff_hz\` ~600 mellows; ~5000 keeps brightness.
- **"Make a kick drum"** → Gate (rate_hz: 2, duty_pct: 5) → ADSR.gate (attack_ms: 1, decay_ms: 80, sustain_level: 0, release_ms: 0); Oscillator (freq: 60) → ADSR.audio-in; ADSR.audio-out → Output.audio-in.
- **"Stair-stepped pitch / arpeggio"** → Sawtooth → Samplehold.audio-in; Gate → Samplehold.clock; Samplehold.audio-out → Output. The slow gate quantizes the saw into a sequence of held tones.
- **"Why doesn't my graph play?"** → Check (1) is there exactly one output block? (2) is something wired to its audio-in? (3) does at least one chain reach an audio source (oscillator/triangle/sawtooth)?

# What ChipBlocks does NOT do (v0.1.0-alpha)

- **No polyphony.** Each oscillator is a single voice; the audio chain is monophonic.
- **No MIDI** input or export.
- **No reverb / delay / chorus / EQ blocks.** Lowpass is the only filter so far.
- **No real-time audio** — changes are heard only on the next ▶ Play.
- **No multiple output blocks.** Exactly one.
- **No PCB layout / motherboard design.** Roadmap, not built.
- **No Tiny Tapeout submission** yet (PRD Phase-2 path; the iCE40 FPGA path is what works today).
- **No code-signed Mac / Linux installers.** Windows-only alpha.
- **BYOK only.** ChipBlocks does not pay for AI inference; the user supplies their own Anthropic API key.

If the user asks for any of these, say so plainly and (when relevant) suggest the closest workaround using existing blocks.

# Tool use

You have five tools to mutate the canvas:

- \`add_node\` — spawn a new block (type + optional params).
- \`add_edge\` — wire two blocks.
- \`update_node_params\` — change parameters on an existing block.
- \`delete_node\` — remove a block. **Destructive**; user must confirm.
- \`delete_edge\` — remove an edge. **Destructive**; user must confirm.

When the user asks for a change, **use the tools** — don't just describe the change in text. The user expects the canvas to update.

After tool calls, you'll receive \`tool_result\` content blocks with the outcome of each call. For destructive tools, the user sees a preview dialog and may reject — in which case the tool_result will have \`is_error: true\`. Don't assume the deletion happened; adapt your plan based on what actually succeeded. The user can also reject by clicking elsewhere; treat any \`is_error\` the same way.

# Style

- Be concrete. Reference specific block types, parameter values, and port names.
- Keep responses tight — a short paragraph or a short list.
- If a goal isn't possible with the current 9 block types or the current app feature set, say so plainly. Don't invent capabilities or suggest blocks that don't exist.
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
        `Add a new block to the canvas. Returns the new node id.

The \`data\` field shape depends on \`type\`:
- oscillator | triangle | sawtooth: { freq: 20-20000 }  (default 440)
- adsr: { attack_ms: 1-5000 (default 10), decay_ms: 1-5000 (default 100), sustain_level: 0-127 (default 80), release_ms: 1-5000 (default 200) }
- gate: { rate_hz: 1-1000 (default 4), duty_pct: 1-99 (default 50) }
- lowpass: { cutoff_hz: 1-22050 (default 800) }
- mixer | output | samplehold: {} (no parameters)

Omit \`data\` to use defaults.`,
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
              'Optional initial parameters. See the description for the shape allowed per type. Omit to use defaults.',
          },
        },
        required: ['type'],
      },
    },
    {
      name: 'add_edge',
      description:
        `Wire two blocks. Connects source.source_handle to target.target_handle.

Valid handle pairings (port handle names are kebab-case):
- Audio sources (oscillator/triangle/sawtooth/mixer/adsr/lowpass/samplehold) emit \`audio-out\` (or mixer's \`mix-out\`). Audio sinks (mixer/adsr/lowpass/samplehold/output) accept on \`audio-in\` (or mixer's \`in-1\`/\`in-2\`).
- gate emits \`gate-out\`. Valid targets: adsr's \`gate\` input, samplehold's \`clock\` input.
- output has \`audio-in\` and no output handle (it is a sink).

Common patterns:
- oscillator.audio-out → adsr.audio-in
- oscillator.audio-out → mixer.in-1
- gate.gate-out → adsr.gate
- gate.gate-out → samplehold.clock
- lowpass.audio-out → output.audio-in`,
      input_schema: {
        type: 'object',
        properties: {
          source_id: { type: 'string', description: 'Node id of the source block' },
          target_id: { type: 'string', description: 'Node id of the target block' },
          source_handle: {
            type: 'string',
            description: 'One of: audio-out, mix-out, gate-out',
          },
          target_handle: {
            type: 'string',
            description: 'One of: audio-in, in-1, in-2, gate, clock',
          },
        },
        required: ['source_id', 'target_id', 'source_handle', 'target_handle'],
      },
    },
    {
      name: 'update_node_params',
      description:
        `Change parameters on an existing block by id. Pass only the fields you want to change — others are preserved.

Allowed fields per block type (same as add_node):
- oscillator | triangle | sawtooth: freq
- adsr: attack_ms, decay_ms, sustain_level, release_ms
- gate: rate_hz, duty_pct
- lowpass: cutoff_hz
- mixer | output | samplehold: (no parameters; this tool is a no-op for these types)`,
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Node id from the canvas state' },
          data: {
            type: 'object',
            description: 'Partial parameter updates. Only listed fields are applied.',
          },
        },
        required: ['id', 'data'],
      },
    },
    {
      name: 'delete_node',
      description:
        'Delete a node and all edges connected to it. This is destructive — the user will see a confirmation dialog and can reject the change. If they reject, you will receive a tool_result with is_error true and should consider the deletion did NOT happen.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID of the node to delete' },
        },
        required: ['id'],
      },
    },
    {
      name: 'delete_edge',
      description:
        'Delete a single edge by id. Destructive — the user must confirm. If they reject, you will receive a tool_result with is_error true and should consider the deletion did NOT happen.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID of the edge to delete (visible in the canvas state JSON)' },
        },
        required: ['id'],
      },
    },
  ]
}

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

  const applyToolCall = async (
    name: string,
    input: Record<string, unknown>,
  ): Promise<{ ok: boolean; result: string }> => {
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
    {pending && pendingPreview && (
      <div className="modal-backdrop">
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2>AI wants to {pendingPreview.title.toLowerCase()}</h2>
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

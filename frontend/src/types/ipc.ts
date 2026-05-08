// Single source of truth for the renderer-side IPC contract types
// exposed by the preload script (frontend/electron/preload/index.ts)
// via contextBridge.exposeInMainWorld. Both App.tsx and Chat.tsx
// (and any future surface that uses window.chipblocks / window.ai)
// import these declarations from here so the type stays consistent
// with the runtime contract — no more triple-declared interfaces
// drifting silently when the channel shape changes.
//
// The runtime side of this contract lives in:
//   frontend/electron/preload/index.ts  - exposeInMainWorld bindings
//   frontend/electron/main/ipc.ts       - synth/build IPC handlers
//   frontend/electron/main/ai.ts        - ai:* IPC handlers
//
// When you add or rename a channel, update both the runtime call
// site AND this types file. tsc will then catch any caller that
// hasn't been migrated.

// Build target ids accepted by window.chipblocks.build's second arg.
// Mirrored from backend/build.py's --target choices (FPGA boards) and
// the Tiny Tapeout submission target. Keep in sync.
export type BuildTarget = 'icestick' | 'tinyfpga-bx' | 'tt'

export interface ChipblocksBridge {
  synth: (graph: unknown) => Promise<{
    ok: boolean
    wavData?: ArrayBuffer
    error?: string
  }>
  cancel: () => Promise<boolean>
  build: (graph: unknown, target: BuildTarget) => Promise<{
    ok: boolean
    zipData?: ArrayBuffer
    error?: string
  }>
  cancelBuild: () => Promise<boolean>
}

// Anthropic-shaped chat request/response types as the renderer sees
// them. The full content-block types (TextBlock, ToolUseBlock,
// ToolResultBlock) live in Chat.tsx because they're internal to the
// agentic loop; only the IPC payload shape lives here.
export interface AiBridge {
  saveKey: (key: string) => Promise<boolean>
  hasKey: () => Promise<boolean>
  clearKey: () => Promise<boolean>
  chat: (req: {
    id: string
    model?: string
    messages: unknown[]
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

declare global {
  interface Window {
    chipblocks: ChipblocksBridge
    ai: AiBridge
  }
}

// Empty export keeps the file a module so the `declare global` is a
// type-only augmentation rather than a script-side declaration.
export {}

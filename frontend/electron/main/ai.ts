/**
 * AI consultant IPC bridge — main-process side.
 *
 * Owns the Anthropic SDK calls so the API key never crosses into the
 * renderer. The key is stored encrypted via Electron's safeStorage
 * (OS keychain on macOS / DPAPI on Windows / libsecret on Linux).
 *
 * Streaming text deltas are forwarded to the renderer via webContents
 * events (`ai:chunk`, `ai:done`, `ai:error`) keyed by a per-request id
 * so multiple in-flight streams don't collide.
 */

import { ipcMain, safeStorage, app, BrowserWindow } from 'electron'
import Anthropic from '@anthropic-ai/sdk'
import { writeFile, readFile, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

// Encrypted key on disk, in the userData dir.
const keyFile = () => path.join(app.getPath('userData'), 'anthropic-key.dat')

// Track in-flight streams per request id so we can cancel them.
const inflight = new Map<string, AbortController>()

const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 4096

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChatRequest {
  id: string
  messages: ChatMessage[]
  // System is an array of blocks; first is the cached static spec,
  // second is the per-turn canvas-state context. Built by the renderer.
  system: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>
}

// ---- API key storage --------------------------------------------------------

async function saveApiKey(plaintext: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is not available on this system.')
  }
  const encrypted = safeStorage.encryptString(plaintext)
  await writeFile(keyFile(), encrypted)
}

async function loadApiKey(): Promise<string | null> {
  const f = keyFile()
  if (!existsSync(f)) return null
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    const encrypted = await readFile(f)
    return safeStorage.decryptString(encrypted)
  } catch {
    return null
  }
}

async function clearApiKey(): Promise<void> {
  const f = keyFile()
  if (existsSync(f)) await unlink(f)
}

async function hasApiKey(): Promise<boolean> {
  return existsSync(keyFile()) && safeStorage.isEncryptionAvailable()
}

// ---- Streaming chat ---------------------------------------------------------

async function runChat(window: BrowserWindow, req: ChatRequest): Promise<void> {
  const apiKey = await loadApiKey()
  if (!apiKey) {
    window.webContents.send('ai:error', {
      id: req.id,
      message: 'No API key configured. Open settings to add one.',
    })
    return
  }

  const controller = new AbortController()
  inflight.set(req.id, controller)

  const client = new Anthropic({ apiKey })

  try {
    const stream = client.messages.stream(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: req.system,
        messages: req.messages,
      },
      { signal: controller.signal },
    )

    for await (const event of stream) {
      // Forward only the small text-delta event so the IPC payload is plain JSON.
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        if (window.isDestroyed()) {
          controller.abort()
          return
        }
        window.webContents.send('ai:chunk', { id: req.id, text: event.delta.text })
      }
    }

    const final = await stream.finalMessage()
    if (!window.isDestroyed()) {
      window.webContents.send('ai:done', {
        id: req.id,
        usage: {
          input: final.usage.input_tokens,
          output: final.usage.output_tokens,
        },
      })
    }
  } catch (err) {
    const msg = (err as Error).message ?? String(err)
    if (!window.isDestroyed()) {
      window.webContents.send('ai:error', { id: req.id, message: msg })
    }
  } finally {
    inflight.delete(req.id)
  }
}

// ---- IPC registration --------------------------------------------------------

export function registerAiHandlers(): void {
  ipcMain.handle('ai:save-key', async (_event, key: string) => {
    if (typeof key !== 'string' || key.length < 10) {
      throw new Error('API key looks invalid (too short).')
    }
    await saveApiKey(key)
    return true
  })

  ipcMain.handle('ai:has-key', async () => hasApiKey())

  ipcMain.handle('ai:clear-key', async () => {
    await clearApiKey()
    return true
  })

  ipcMain.handle('ai:chat', async (event, req: ChatRequest) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return false
    // Fire-and-forget; runChat sends its own ai:done / ai:error events.
    void runChat(window, req).catch((err) => {
      window.webContents.send('ai:error', {
        id: req.id,
        message: (err as Error).message,
      })
    })
    return true
  })

  ipcMain.handle('ai:cancel', async (_event, id: string) => {
    const ctrl = inflight.get(id)
    if (ctrl) {
      ctrl.abort()
      inflight.delete(id)
      return true
    }
    return false
  })

  // Abort any orphan streams when the window goes away (HMR reload, app close).
  app.on('browser-window-created', (_e, win) => {
    win.on('closed', () => {
      for (const ctrl of inflight.values()) ctrl.abort()
      inflight.clear()
    })
  })
}

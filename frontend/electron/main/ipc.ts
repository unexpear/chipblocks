import { ipcMain } from 'electron'
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { writeFile, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

interface SynthGraph {
  nodes: Array<{ id: string; type?: string; data?: Record<string, unknown> }>
  edges: Array<{ source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }>
}

interface SynthResult {
  ok: boolean
  wavData?: ArrayBuffer
  error?: string
}

// Single in-flight process slot. v1 is single-flight (only one synth at a
// time). If multi-concurrent ever matters, swap this for a Map keyed by
// request id.
let currentProc: ChildProcess | null = null
let wasCancelled = false

// Convert a Windows path "C:\foo\bar" to a WSL path "/mnt/c/foo/bar".
function winToWsl(p: string): string {
  const normalized = p.replace(/\\/g, '/')
  const m = normalized.match(/^([A-Za-z]):(\/.*)$/)
  if (!m) throw new Error(`Cannot convert non-Windows path to WSL: ${p}`)
  return `/mnt/${m[1].toLowerCase()}${m[2]}`
}

// Locate the synth script at <project_root>/backend/synth.py.
function getSynthScriptPath(): string {
  return path.join(process.env.APP_ROOT ?? '', '..', 'backend', 'synth.py')
}

async function runSynth(graph: SynthGraph): Promise<SynthResult> {
  const dir = await mkdtemp(path.join(tmpdir(), 'chipforge-'))
  const winJsonPath = path.join(dir, 'graph.json')
  const winWavPath = path.join(dir, 'out.wav')
  await writeFile(winJsonPath, JSON.stringify(graph), 'utf8')

  let wslJsonPath: string
  let wslWavPath: string
  let wslScriptPath: string
  try {
    wslJsonPath = winToWsl(winJsonPath)
    wslWavPath = winToWsl(winWavPath)
    wslScriptPath = winToWsl(getSynthScriptPath())
  } catch (err) {
    return { ok: false, error: `Path conversion failed: ${(err as Error).message}` }
  }

  wasCancelled = false

  return new Promise<SynthResult>((resolve) => {
    const proc = spawn(
      'wsl.exe',
      [
        '-d', 'Ubuntu',
        '--',
        'python3', wslScriptPath,
        '--in', wslJsonPath,
        '--out', wslWavPath,
      ],
      {
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUNBUFFERED: '1',
          WSLENV: 'PYTHONIOENCODING/u:PYTHONUNBUFFERED/u',
        },
      },
    )
    currentProc = proc

    let stderr = ''
    let stdout = ''
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf8') })
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8') })

    const TIMEOUT_MS = 30_000
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      // The close handler will resolve with the cancelled / timed-out message.
    }, TIMEOUT_MS)

    proc.on('close', async (code) => {
      clearTimeout(timer)
      currentProc = null

      if (wasCancelled) {
        resolve({ ok: false, error: 'Cancelled by user' })
        return
      }
      if (code === 0) {
        if (stdout) console.log('[synth stdout]', stdout)
        try {
          const buf = await readFile(winWavPath)
          const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
          resolve({ ok: true, wavData: ab as ArrayBuffer })
        } catch (err) {
          resolve({ ok: false, error: `Failed to read WAV: ${(err as Error).message}` })
        }
      } else {
        resolve({ ok: false, error: friendlyError(stderr, code) })
      }
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      currentProc = null
      resolve({ ok: false, error: `Failed to spawn wsl.exe: ${err.message}` })
    })
  })
}

function cancelSynth(): boolean {
  if (currentProc) {
    wasCancelled = true
    currentProc.kill('SIGKILL')
    currentProc = null
    return true
  }
  return false
}

function friendlyError(stderr: string, code: number | null): string {
  const lines = stderr.trim().split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i])
      if (parsed && typeof parsed.error === 'string') return parsed.error
    } catch {
      // not JSON, try the previous line
    }
  }
  return `Synth failed (exit ${code}): ${stderr.slice(-500) || '(no stderr output)'}`
}

export function registerIpcHandlers() {
  ipcMain.handle('synth:run', async (_event, graph: SynthGraph) => {
    return runSynth(graph)
  })
  ipcMain.handle('synth:cancel', async () => {
    return cancelSynth()
  })
}

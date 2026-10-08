// Laya advisor client: one warm sidecar for the whole run (JSON lines over stdin/stdout).
// Policy (from scratchpad/ui-judge-eval/REPORT.md): English checkpoint, panel text only, compacted
// to <= 1200 chars, all questions for a screen in ONE request, never a gate. A flag is raised only
// when Laya disagrees with the coded assert at confidence >= 0.9.
import { spawn } from 'node:child_process'
import readline from 'node:readline'

// No machine paths here: the runner passes the sidecar script and Python from LAYA_SIDECAR /
// LAYA_PYTHON or --laya-sidecar / --laya-python. Without them Laya is simply off.
export const LAYA_DEFAULTS = {
  python: 'python',
  sidecar: null,
  flagAt: 0.9,
  maxChars: 1200,
  readyTimeoutMs: 120000,
}

export class Laya {
  constructor(opts = {}) {
    this.o = { ...LAYA_DEFAULTS, ...opts }
    this.ready = false
    this.failed = null
    this.pending = new Map()
    this.n = 0
    this.calls = 0
    this.totalMs = 0
  }

  start() {
    this.t0 = Date.now()
    if (!this.o.sidecar) {
      this.failed = 'no sidecar configured'
      return
    }
    try {
      this.p = spawn(this.o.python, [this.o.sidecar], {
        env: { ...process.env, USE_TF: '0', PYTHONUTF8: '1', HF_HUB_DISABLE_PROGRESS_BARS: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (e) {
      this.failed = `could not start sidecar: ${e.message}`
      return
    }
    this.readyPromise = new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!this.ready) this.failed = `sidecar not ready after ${this.o.readyTimeoutMs} ms`
        resolve()
      }, this.o.readyTimeoutMs)
      this.p.stderr.on('data', (d) => {
        if (/sidecar ready/.test(String(d))) {
          this.ready = true
          this.coldMs = Date.now() - this.t0
          clearTimeout(timer)
          resolve()
        }
      })
      this.p.on('exit', (code) => {
        if (!this.ready) this.failed = `sidecar exited early (code ${code})`
        clearTimeout(timer)
        resolve()
        for (const [, r] of this.pending) r({ error: 'sidecar exited' })
      })
      this.p.on('error', (e) => {
        this.failed = `sidecar error: ${e.message}`
        clearTimeout(timer)
        resolve()
      })
    })
    readline.createInterface({ input: this.p.stdout }).on('line', (line) => {
      let r
      try {
        r = JSON.parse(line)
      } catch {
        return
      }
      const cb = this.pending.get(r.id)
      if (cb) {
        this.pending.delete(r.id)
        cb(r)
      }
    })
  }

  async whenReady() {
    if (this.readyPromise) await this.readyPromise
    return this.ready && !this.failed
  }

  /** questions: [{id, q}] — one request, english checkpoint. */
  async ask(stateText, questions) {
    if (!(await this.whenReady())) return { error: this.failed ?? 'not ready' }
    const id = ++this.n
    const qs = Object.fromEntries(questions.map((x) => [x.id, { type: 'noul', instructions: x.q }]))
    const t = Date.now()
    const res = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve({ error: 'laya timeout (10 s)' })
      }, 10000)
      this.pending.set(id, (r) => {
        clearTimeout(timer)
        resolve(r)
      })
      this.p.stdin.write(
        `${JSON.stringify({ id, state: stateText, questions: qs, model: 'english' })}\n`,
      )
    })
    const ms = Date.now() - t
    this.calls++
    this.totalMs += ms
    return { ...res, roundtripMs: ms }
  }

  stop() {
    try {
      this.p?.stdin.end()
    } catch {}
    setTimeout(() => {
      try {
        this.p?.kill()
      } catch {}
    }, 3000).unref()
  }
}

/** Panel text → short Laya state: aria-snapshot lines, no refs/imgs/quotes, long lines cut, <= maxChars. */
export function compactForLaya(ariaYaml, maxChars = 1200, benign = []) {
  // Known-benign text (app-map benignText) is removed first: in the eval the Gerber footer
  // 'Not plotted (not a Gerber or drill file): …' alone produced a p=1.0 false refusal.
  for (const b of benign) ariaYaml = ariaYaml.replace(new RegExp(b.pattern, 'g'), '')
  const lines = []
  for (const raw of ariaYaml.split('\n')) {
    let l = raw
      .trim()
      .replace(/^- /, '')
      .replace(/\s*\[ref=e\d+\]/g, '')
      .replace(/"/g, '')
    if (!l || l === 'img' || l === 'img:' || /^option /.test(l) || /^\/placeholder/.test(l))
      continue
    if (l.length > 200) l = `${l.slice(0, 200)} …`
    lines.push(l)
  }
  let out = lines.join('\n')
  if (out.length > maxChars) out = `${out.slice(0, maxChars - 2)} …`
  return out
}

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

// Laya's real input limit (rl_agent_config.json of the v2 checkpoint): max_len 512 tokens for
// [CLS] question [SEP] options [SEP] state [SEP]. The checkpoint questions in app-map.json take 31-45
// tokens of that, which leaves at least 465 tokens for the state. Laya does not refuse a longer state:
// it silently drops the tokens that do not fit from the END. Characters are not a safe proxy (real
// states run 2.3-4.5 characters per token; net lists full of '↔' and part names are the dense ones),
// so the state is also held to LAYA_STATE_TOKENS by estimateLayaTokens.
export const LAYA_STATE_TOKENS = 465
// A plain line longer than LAYA_LINE_CHARS is cut there, exactly as before (`<first 200> …`): the v2
// checkpoint was fine-tuned on that format, and changing it moved its answers on healthy screens. A
// line that carries an alert (a refusal, NOT LOADED, an error) is a message the user is meant to read,
// so it may run to LAYA_ALERT_LINE_CHARS, is shortened only by whole sentences, and never loses an
// alert sentence. That alert text is what the old cut was losing.
export const LAYA_LINE_CHARS = 200
export const LAYA_ALERT_LINE_CHARS = 600
const ELLIPSIS = '\u2026'

// What makes a sentence or line important enough to survive compaction: refusal, load and trust
// failures, errors. Known-benign wording that matches (app-map benignText) is stripped before this runs.
export const LAYA_ALERT_RE =
  /not plotted|was skipped|nothing is plotted|refus|not loaded|\bfail(?:ed|s|ure)?\b|\berror\b|invalid|untrusted|did not verify|does not verify|no longer match|could not|cannot|can't|mismatch|unloaded|crash|blocked|warning/i

const isAlert = (t) => LAYA_ALERT_RE.test(t)
// SHA-256 digests and keys in an alert line: 64 hex characters of no meaning to Laya (~40 tokens each).
const LONG_HEX = /\b[0-9a-f]{24,}\b/gi

/**
 * Upper estimate of Laya's (ModernBERT BPE) token count for a state, without the tokenizer: a letter
 * run costs one token per 4 letters, a digit run one per 2 digits, ASCII punctuation 1, any other
 * symbol 3. Checked against the v2 tokenizer on 898 real states (the v2 test2 captures re-compacted
 * plus every recorded replay request): it never came out under the real count (estimate/real
 * 1.04-1.44).
 */
export function estimateLayaTokens(text) {
  let n = 0
  for (const [p] of text.matchAll(/[A-Za-z]+|[0-9]+|[^\sA-Za-z0-9]/gu)) {
    const c = p.codePointAt(0)
    if (/[A-Za-z]/.test(p[0])) n += Math.ceil(p.length / 4)
    else if (/[0-9]/.test(p[0])) n += Math.ceil(p.length / 2)
    else n += c < 128 ? 1 : 3
  }
  return n
}

/** Split a line body into sentences (keeps the punctuation; never splits inside a word). */
function sentences(body) {
  return body.split(/(?<=[.!?])\s+/).filter((x) => x.trim())
}

/**
 * Shorten one long line by whole sentences: every alert sentence is kept, then the other sentences in
 * reading order while the line stays within `cap`; each run of dropped sentences becomes one ellipsis.
 * A line is never cut mid-sentence, so a refusal arrives as the sentence the app showed.
 */
export function shortenLine(line, cap = isAlert(line) ? LAYA_ALERT_LINE_CHARS : LAYA_LINE_CHARS) {
  if (line.length <= cap) return line
  const m = /^([a-z][\w ]*?:\s)/i.exec(line)
  const prefix = m ? m[1] : ''
  const parts = sentences(line.slice(prefix.length))
  if (parts.length <= 1) {
    // One endless sentence: keep the part around the first alert word if there is one, else the start.
    const a = LAYA_ALERT_RE.exec(line)
    if (!a || a.index < cap / 2) return `${line.slice(0, cap)} ${ELLIPSIS}`
    const from = Math.max(prefix.length, a.index - Math.floor(cap / 4))
    return `${prefix}${ELLIPSIS} ${line.slice(from, from + cap - prefix.length)} ${ELLIPSIS}`
  }
  const keep = parts.map(isAlert)
  let len = prefix.length + parts.reduce((n, p, i) => n + (keep[i] ? p.length + 1 : 0), 0)
  for (let i = 0; i < parts.length; i++) {
    if (keep[i]) continue
    if (len + parts[i].length + 1 > cap) continue
    keep[i] = true
    len += parts[i].length + 1
  }
  const out = []
  for (let i = 0; i < parts.length; i++) {
    if (keep[i]) out.push(parts[i])
    else if (out.at(-1) !== ELLIPSIS) out.push(ELLIPSIS)
  }
  return prefix + out.join(' ')
}

/** Just the alert sentences of a line (with its role prefix), the gaps marked. */
function alertOnly(line) {
  const m = /^([a-z][\w ]*?:\s)/i.exec(line)
  const prefix = m ? m[1] : ''
  const out = []
  for (const p of sentences(line.slice(prefix.length))) {
    if (isAlert(p)) out.push(p)
    else if (out.at(-1) !== ELLIPSIS) out.push(ELLIPSIS)
  }
  return prefix + out.join(' ')
}

/**
 * Panel text -> short Laya state: aria-snapshot lines, no refs/imgs/quotes, <= maxChars and
 * <= maxTokens (estimated; Laya's real room is LAYA_STATE_TOKENS). Plain lines over 200 chars are cut
 * as before; alert lines are kept whole up to 600 chars, else shortened by whole sentences keeping the
 * alert ones, with hex digests shortened. When the whole state is too long, alert lines
 * (refusals, NOT LOADED, errors) are kept first, then the line just above each, then plain lines from
 * the top; so a refusal is never cut off by the text above it, by us or by Laya's own 512-token cut.
 */
export function compactForLaya(
  ariaYaml,
  maxChars = 1200,
  benign = [],
  maxTokens = LAYA_STATE_TOKENS,
) {
  // Known-benign text (app-map benignText) is removed first: in the eval the Gerber footer
  // 'Not plotted (not a Gerber or drill file): ...' alone produced a p=1.0 false refusal.
  for (const b of benign) ariaYaml = ariaYaml.replace(new RegExp(b.pattern, 'g'), '')
  const lines = []
  for (const raw of ariaYaml.split('\n')) {
    const l = raw
      .trim()
      .replace(/^- /, '')
      .replace(/\s*\[ref=e\d+\]/g, '')
      .replace(/"/g, '')
    if (!l || l === 'img' || l === 'img:' || /^option /.test(l) || /^\/placeholder/.test(l))
      continue
    if (isAlert(l))
      lines.push(shortenLine(l.replace(LONG_HEX, (h) => `${h.slice(0, 8)}${ELLIPSIS}`)))
    else lines.push(l.length > LAYA_LINE_CHARS ? `${l.slice(0, LAYA_LINE_CHARS)} ${ELLIPSIS}` : l)
  }
  let budget = Math.max(16, maxChars)
  let text = fitLines(lines, budget)
  // Dense text (symbols, part names) can be within the character budget and still overflow Laya's
  // tokens: shrink the character budget in proportion and fit again.
  for (let est = estimateLayaTokens(text); est > maxTokens && budget > 64; ) {
    budget = Math.floor((budget * maxTokens * 0.97) / est)
    text = fitLines(lines, budget)
    est = estimateLayaTokens(text)
  }
  return text
}

/** Choose whole lines (alerts first) to fit `budget` characters, in reading order, gaps marked. */
function fitLines(source, budget) {
  const joined = source.join('\n')
  if (joined.length <= budget) return joined
  const lines = [...source]
  // If the alert lines alone do not fit, each is first reduced to its alert sentences.
  const alert = lines.map(isAlert)
  const alertCost = lines.reduce(
    (n, l, i) => n + (alert[i] ? l.length + 2 + ELLIPSIS.length : 0),
    0,
  )
  if (alertCost > budget)
    for (let i = 0; i < lines.length; i++) if (alert[i]) lines[i] = alertOnly(lines[i])
  const keep = lines.map(() => false)
  const marker = ELLIPSIS.length + 1
  let used = 0
  const take = (i) => {
    const cost = lines[i].length + 1 + marker
    if (used + cost > budget) return false
    keep[i] = true
    used += lines[i].length + 1
    return true
  }
  for (let i = 0; i < lines.length; i++) if (alert[i]) take(i)
  // the line just above an alert usually names what it is about (the pack, the file)
  for (let i = 1; i < lines.length; i++) if (keep[i] && alert[i] && !keep[i - 1]) take(i - 1)
  for (let i = 0; i < lines.length; i++) if (!keep[i] && !take(i)) break
  const out = []
  for (let i = 0; i < lines.length; i++) {
    if (keep[i]) out.push(lines[i])
    else if (out.at(-1) !== ELLIPSIS) out.push(ELLIPSIS)
  }
  const text = out.join('\n')
  // Only possible when one alert line alone is longer than the budget: cut that line's tail.
  return text.length > budget ? `${text.slice(0, budget - 2)} ${ELLIPSIS}` : text
}

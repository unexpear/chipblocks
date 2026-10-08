// App-aware click-through engine: resolves the app map, drives Playwright, evaluates coded asserts
// (the source of truth), runs per-screen invariants + the global crash watch after every step, and
// asks Laya (advisory only) at checkpoints.
import fs from 'node:fs'
import path from 'node:path'
import { compactForLaya } from './laya.mjs'

export class StepError extends Error {
  constructor(category, message, extra = {}) {
    super(message)
    this.category = category // 'assert' | 'unreachable' | 'driver' | 'console' | 'crash'
    Object.assign(this, extra)
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim()

export class Engine {
  constructor({ map, page, context, outDir, laya, log, workflowName }) {
    this.map = map
    this.page = page
    this.context = context
    this.outDir = outDir
    this.laya = laya
    this.log = log ?? (() => {})
    this.wf = workflowName
    this.vars = {}
    this.console = [] // {type, text, step, benign}
    this.badResponses = [] // {status, url}
    this.pageErrors = []
    this.currentStep = null
    this.layaFlags = []
    this.layaRuns = []
    this.regionSeq = 0
    page.on('console', (m) => {
      if (m.type() !== 'error' && m.type() !== 'warning') return
      this.console.push({
        type: m.type(),
        text: m.text(),
        url: m.location()?.url ?? '',
        step: this.currentStep,
      })
    })
    page.on('pageerror', (e) =>
      this.pageErrors.push({ text: String(e.stack || e.message), step: this.currentStep }),
    )
    page.on('response', (r) => {
      if (r.status() >= 400)
        this.badResponses.push({ status: r.status(), url: r.url(), step: this.currentStep })
    })
  }

  // ---------- map lookup ----------
  screen(id) {
    const s = this.map.screens[id]
    if (!s) throw new StepError('driver', `unknown screen '${id}' (not in app map)`)
    return s
  }

  control(ref) {
    const [sid, cid] = ref.split('.')
    const c = this.screen(sid).controls?.[cid]
    if (!c) throw new StepError('driver', `unknown control '${ref}' (not in app map)`)
    return c.sel
  }

  fill(spec, params) {
    if (!params) return spec
    const s = JSON.stringify(spec).replace(/\{(\w+)\}/g, (m, k) =>
      params[k] !== undefined ? String(params[k]).replace(/"/g, '\\"') : m,
    )
    return JSON.parse(s)
  }

  // ---------- selectors ----------
  locator(spec, params) {
    spec = this.fill(spec, params)
    if (typeof spec === 'string') spec = this.control(spec)
    spec = this.fill(spec, params)
    let root = this.page
    if (spec.within) root = this.locator(spec.within, params)
    let loc
    if (spec.rowButton) {
      // Shortcuts rows: <div><span>{label}</span><span>{key}</span><button>Change|cancel</button></div>
      loc = root
        .getByText(spec.rowButton, { exact: true })
        .locator('xpath=..')
        .getByRole('button', { name: new RegExp(`^(${spec.name})$`) })
    } else if (spec.role) {
      const o = {}
      if (spec.nameRe) o.name = new RegExp(spec.nameRe)
      else if (spec.name !== undefined) o.name = spec.name
      if (spec.exact) o.exact = true
      if (spec.pressed !== undefined) o.pressed = spec.pressed
      loc = root.getByRole(spec.role, o)
    } else if (spec.label) loc = root.getByLabel(spec.label, { exact: !!spec.exact })
    else if (spec.testid) loc = root.getByTestId(spec.testid)
    else if (spec.textRe) loc = root.getByText(new RegExp(spec.textRe, spec.flags ?? ''))
    else if (spec.text) loc = root.getByText(spec.text, { exact: !!spec.exact })
    else if (spec.css) loc = root.locator(spec.css)
    else throw new StepError('driver', `bad selector ${JSON.stringify(spec)}`)
    if (spec.textIs !== undefined)
      loc = loc.filter({
        hasText: new RegExp(`^${String(spec.textIs).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
      })
    // Every project tab stays mounted (display:none) — only ever act on what the user can see.
    if (!spec.role && !spec.includeHidden) loc = loc.filter({ visible: true })
    return spec.all ? loc : loc.nth(spec.nth ?? 0)
  }

  describe(spec) {
    return typeof spec === 'string' ? spec : JSON.stringify(spec)
  }

  // ---------- regions ----------
  regionSpec(ref) {
    if (typeof ref === 'object') return ref
    const [sid, rid] = ref.split('.')
    const s = this.screen(sid)
    const r = rid ? s.regions?.[rid] : s.region
    if (!r) throw new StepError('driver', `unknown region '${ref}'`)
    return r
  }

  /** Returns a Locator for the region element, or null if not present. */
  async regionLocator(ref) {
    const spec = this.regionSpec(ref)
    if (spec.locator) {
      const l = this.locator(spec.locator)
      return (await l.count()) > 0 ? l : null
    }
    const tag = `r${++this.regionSeq}`
    const found = await this.page.evaluate(
      ({ spec, tag }) => {
        for (const e of document.querySelectorAll('[data-uir-region]'))
          e.removeAttribute('data-uir-region')
        const n = (s) => (s || '').replace(/\s+/g, ' ').trim()
        // only what is rendered: project tabs stay mounted with display:none
        const all = [...document.querySelectorAll('body *')].filter(
          (e) => e.getClientRects().length > 0,
        )
        let el = null
        if (spec.leafRe) {
          const re = new RegExp(spec.leafRe)
          // deepest element whose whole text matches (text may be split over child spans)
          el = all.find(
            (e) =>
              re.test(n(e.textContent)) && ![...e.children].some((c) => re.test(n(c.textContent))),
          )
        } else if (spec.anchor) {
          const cands = all.filter((e) => n(e.textContent).includes(spec.anchor))
          el =
            cands.find(
              (e) => ![...e.children].some((c) => n(c.textContent).includes(spec.anchor)),
            ) || null
          if (el) {
            for (let i = 0; i < (spec.up ?? 0) && el.parentElement; i++) el = el.parentElement
            const need = spec.contains ?? []
            while (el && need.some((t) => !n(el.innerText).includes(t))) el = el.parentElement
          }
        }
        if (!el) return false
        el.setAttribute('data-uir-region', tag)
        return true
      },
      { spec, tag },
    )
    return found ? this.page.locator(`[data-uir-region="${tag}"]`) : null
  }

  async regionText(ref) {
    const l = await this.regionLocator(ref)
    if (!l) return null
    try {
      return norm(await l.first().innerText({ timeout: 2000 }))
    } catch {
      return null
    }
  }

  // ---------- asserts (polling, Playwright-expect style) ----------
  async evalOnce(a, params) {
    switch (a.type) {
      case 'visible': {
        const l = this.locator(a.sel, params)
        const ok = (await l.count()) > 0 && (await l.isVisible())
        return { ok, detail: ok ? 'visible' : `not visible: ${this.describe(a.sel)}` }
      }
      case 'absent': {
        const l = this.locator(
          { ...(typeof a.sel === 'string' ? this.control(a.sel) : a.sel), all: true },
          params,
        )
        const vis = await l.filter({ visible: true }).count()
        return {
          ok: vis === 0,
          detail: vis === 0 ? 'absent' : `${vis} visible: ${this.describe(a.sel)}`,
        }
      }
      case 'count': {
        const l = this.locator(
          { ...(typeof a.sel === 'string' ? this.control(a.sel) : a.sel), all: true },
          params,
        )
        const c = await l.filter({ visible: true }).count()
        const ok =
          (a.eq === undefined || c === a.eq) &&
          (a.min === undefined || c >= a.min) &&
          (a.max === undefined || c <= a.max)
        return { ok, detail: `count=${c}`, value: c }
      }
      case 'enabled':
      case 'disabled': {
        const l = this.locator(a.sel, params)
        if ((await l.count()) === 0)
          return { ok: false, detail: `missing: ${this.describe(a.sel)}` }
        const dis = await l.isDisabled()
        return { ok: a.type === 'disabled' ? dis : !dis, detail: dis ? 'disabled' : 'enabled' }
      }
      case 'pressed': {
        const l = this.locator(a.sel, params)
        if ((await l.count()) === 0) return { ok: false, detail: 'missing' }
        const v = await l.getAttribute('aria-pressed')
        return { ok: String(v) === String(a.value), detail: `aria-pressed=${v}` }
      }
      case 'value': {
        const l = this.locator(a.sel, params)
        if ((await l.count()) === 0) return { ok: false, detail: 'missing' }
        const v = await l.inputValue()
        const ok = a.equals !== undefined ? v === String(a.equals) : new RegExp(a.matches).test(v)
        return { ok, detail: `value="${v}"` }
      }
      case 'checked': {
        const l = this.locator(a.sel, params)
        if ((await l.count()) === 0) return { ok: false, detail: 'missing' }
        const c = await l.isChecked()
        return { ok: c === (a.value ?? true), detail: c ? 'checked' : 'unchecked' }
      }
      case 'attrNumber': {
        const l = this.locator(a.sel, params)
        if ((await l.count()) === 0) return { ok: false, detail: 'missing' }
        const v = Number(await l.getAttribute(a.name))
        const fails = []
        for (const c of a.check) {
          const B = this.num(c.b)
          const ok = {
            eq: Math.abs(v - B) < 1e-6 * Math.max(1, Math.abs(B)),
            lt: v < B,
            gt: v > B,
            le: v <= B,
            ge: v >= B,
          }[c.op]
          if (!ok) fails.push(`${a.name}=${v} ${c.op} ${c.b}(${B})`)
        }
        return {
          ok: fails.length === 0,
          detail: fails.length ? fails.join('; ') : `${a.name}=${v}`,
        }
      }
      case 'focused': {
        const l = this.locator(a.sel, params)
        const f = (await l.count()) > 0 && (await l.evaluate((e) => e === document.activeElement))
        return { ok: f, detail: f ? 'focused' : 'not focused' }
      }
      case 'attr': {
        const l = this.locator(a.sel, params)
        if ((await l.count()) === 0) return { ok: false, detail: 'missing' }
        const v = (await l.getAttribute(a.name)) ?? ''
        let ok = true
        if (a.matches) ok &&= new RegExp(a.matches, a.flags ?? '').test(v)
        if (a.notMatches) ok &&= !new RegExp(a.notMatches, a.flags ?? '').test(v)
        return { ok, detail: `${a.name}="${v.slice(0, 160)}"`, value: v }
      }
      case 'text': {
        const t = a.region
          ? await this.regionText(a.region)
          : norm(
              await this.locator(a.sel, params)
                .innerText()
                .catch(() => null),
            )
        if (t === null)
          return {
            ok: false,
            detail: `region not found: ${this.describe(a.region ?? a.sel)}`,
            missing: true,
          }
        let ok = true
        let why = ''
        if (a.matches) {
          const m = new RegExp(a.matches, a.flags ?? '').test(t)
          ok &&= m
          if (!m) why = `no /${a.matches}/`
        }
        if (a.notMatches) {
          const mm = t.match(new RegExp(a.notMatches, a.flags ?? ''))
          ok &&= !mm
          if (mm) why = `found "${mm[0]}"`
        }
        let shown = t.slice(0, 200)
        if (a.hint && t.includes(a.hint)) {
          const i = t.indexOf(a.hint)
          shown = `…${t.slice(i, i + 120)}`
        }
        return { ok, detail: ok ? 'text ok' : `${why} in "${shown}…"`, text: t }
      }
      case 'numbers': {
        const t = await this.regionText(a.region)
        if (t === null)
          return {
            ok: false,
            detail: `region not found: ${this.describe(a.region)}`,
            missing: true,
          }
        const m = t.match(new RegExp(a.re, a.flags ?? ''))
        if (!m) return { ok: false, detail: `no /${a.re}/ in "${t.slice(0, 200)}"`, nomatch: true }
        const val = (x) =>
          typeof x === 'number'
            ? x
            : /^\$\d+$/.test(x)
              ? Number(m[Number(x.slice(1))])
              : this.num(x)
        const fails = []
        for (const c of a.check) {
          const A = val(c.a)
          const B = c.b !== undefined ? val(c.b) : undefined
          const ok = {
            eq: A === B,
            ne: A !== B,
            lt: A < B,
            le: A <= B,
            gt: A > B,
            ge: A >= B,
            between: A >= c.min && A <= c.max,
          }[c.op]
          if (!ok)
            fails.push(
              `${c.a}=${A} ${c.op} ${c.b ?? `[${c.min},${c.max}]`}${B !== undefined ? `(${B})` : ''}`,
            )
        }
        return {
          ok: fails.length === 0,
          detail: fails.length
            ? `failed: ${fails.join('; ')} (matched "${m[0]}")`
            : `ok (matched "${m[0]}")`,
          groups: m,
        }
      }
      case 'clickable': {
        const l = this.locator(a.sel, params)
        if ((await l.count()) === 0) return { ok: false, detail: 'missing' }
        const h = await this.hitTest(l)
        return {
          ok: h.ok,
          detail: h.ok ? 'clickable' : `covered by ${h.by}${h.rect ? ` at y=${h.rect.y}` : ''}`,
        }
      }
      case 'noAlarms': {
        const t = await this.regionText(a.region)
        if (t === null) return { ok: false, detail: 'region not found', missing: true }
        let s = t
        for (const b of [
          ...this.map.benignText,
          ...(a.alsoBenign ?? []).map((p) => ({ pattern: p })),
        ])
          s = s.replace(new RegExp(b.pattern, 'g'), ' ')
        const hits = [...s.matchAll(new RegExp(this.map.alarmWords, 'gi'))].map((m) =>
          s.slice(Math.max(0, m.index - 40), m.index + 60),
        )
        return {
          ok: hits.length === 0,
          detail: hits.length
            ? `alarm words after removing known-benign text: ${hits.map((h) => `"…${norm(h)}…"`).join(' | ')}`
            : 'no unexplained alarm words',
        }
      }
      case 'not': {
        const r = await this.evalOnce(a.assert, params)
        return { ok: !r.ok, detail: `not(${r.detail})` }
      }
      case 'all': {
        for (const x of a.of) {
          const r = await this.evalOnce(x, params)
          if (!r.ok) return { ok: false, detail: r.detail }
        }
        return { ok: true, detail: 'all ok' }
      }
      case 'any': {
        const ds = []
        for (const x of a.of) {
          const r = await this.evalOnce(x, params)
          if (r.ok) return { ok: true, detail: r.detail }
          ds.push(r.detail)
        }
        return { ok: false, detail: `none of: ${ds.join(' | ')}` }
      }
      case 'implies': {
        const c = await this.evalOnce(a.if, params)
        if (!c.ok) return { ok: true, detail: 'n/a (condition false)', vacuous: true }
        const r = await this.evalOnce(a.then, params)
        return { ok: r.ok, detail: `if held → ${r.detail}` }
      }
      case 'iff': {
        const x = await this.evalOnce(a.a, params)
        const y = await this.evalOnce(a.b, params)
        return { ok: x.ok === y.ok, detail: `${x.ok}/${y.ok}: ${x.detail} ⟷ ${y.detail}` }
      }
      case 'equalsVar': {
        const t = await this.regionText(a.region)
        const m = t?.match(new RegExp(a.re))
        const v = m ? m[a.group ?? 1] : undefined
        return {
          ok: v !== undefined && String(v) === String(this.vars[a.var]),
          detail: `${v} vs @${a.var}=${this.vars[a.var]}`,
        }
      }
      default:
        throw new StepError('driver', `unknown assert type ${a.type}`)
    }
  }

  num(x) {
    if (typeof x === 'number') return x
    const m = String(x).match(/^@(\w+)(?:\*([\d.]+))?$/)
    if (m) return Number(this.vars[m[1]]) * (m[2] ? Number(m[2]) : 1)
    return Number(x)
  }

  async check(a, params, { timeoutMs, once } = {}) {
    const limit = once ? 0 : (timeoutMs ?? a.timeoutMs ?? this.map.defaults.assertTimeoutMs)
    const t0 = Date.now()
    let r
    for (;;) {
      r = await this.evalOnce(a, params)
      if (r.ok || Date.now() - t0 >= limit) break
      await sleep(150)
    }
    return { ...r, ms: Date.now() - t0 }
  }

  async waitReady(screenId, params) {
    const s = this.screen(screenId)
    for (const a of s.ready ?? []) {
      const r = await this.check(a, params, { timeoutMs: this.map.defaults.readyTimeoutMs })
      if (!r.ok)
        throw new StepError('assert', `screen '${screenId}' never became ready: ${r.detail}`, {
          screen: screenId,
        })
    }
  }

  // ---------- driving ----------
  async hitTest(loc) {
    try {
      await loc.scrollIntoViewIfNeeded({ timeout: 1500 })
    } catch {}
    return loc.evaluate((el) => {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return { ok: false, by: 'zero-size box' }
      const x = r.left + r.width / 2
      const y = r.top + r.height / 2
      if (y < 0 || y > innerHeight || x < 0 || x > innerWidth)
        return {
          ok: false,
          by: `nothing (centre ${Math.round(x)},${Math.round(y)} is outside the ${innerWidth}×${innerHeight} viewport)`,
          rect: { x: Math.round(r.left), y: Math.round(r.top) },
        }
      const hit = document.elementFromPoint(x, y)
      if (hit === el || el.contains(hit)) return { ok: true }
      const d = hit
        ? `${hit.tagName.toLowerCase()}${hit.getAttribute('data-panel-dock') ? `[data-panel-dock=${hit.getAttribute('data-panel-dock')}]` : ''} "${(hit.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50)}"`
        : 'nothing'
      return { ok: false, by: d, rect: { x: Math.round(r.left), y: Math.round(r.top) } }
    })
  }

  async click(spec, params, { dbl = false } = {}) {
    const attempts = this.map.defaults.clickAttempts
    const loc = this.locator(spec, params)
    let last = ''
    for (let i = 1; i <= attempts; i++) {
      try {
        await loc.waitFor({ state: 'visible', timeout: i === 1 ? 5000 : 2000 })
      } catch {
        last = `not visible after wait: ${this.describe(spec)}`
        continue
      }
      if (await loc.isDisabled().catch(() => false))
        throw new StepError('assert', `control is disabled: ${this.describe(spec)}`)
      const h = await this.hitTest(loc)
      if (!h.ok) {
        last = `covered by ${h.by}${h.rect ? ` (control top-left ${h.rect.x},${h.rect.y})` : ''}`
        await sleep(250 * i)
        continue
      }
      try {
        await (dbl ? loc.dblclick({ timeout: 3000 }) : loc.click({ timeout: 3000 }))
        return { attempts: i }
      } catch (e) {
        last = String(e.message).split('\n')[0]
        await sleep(250 * i)
      }
    }
    const covered = last.startsWith('covered by')
    throw new StepError(
      covered ? 'unreachable' : 'driver',
      `could not click ${this.describe(spec)} after ${attempts} attempts: ${last}`,
    )
  }

  async doAction(act, params) {
    const p = { ...params, ...(act.with ?? {}) }
    act = this.fill(act, p)
    if (act.macro) {
      const mc = this.map.macros?.[act.macro]
      if (!mc) throw new StepError('driver', `unknown macro ${act.macro}`)
      for (const a of mc.do) await this.doAction(a, p)
    } else if (act.ifVisible) {
      const l = this.locator(act.ifVisible, p)
      const branch = (await l.count()) > 0 && (await l.isVisible()) ? act.then : act.else
      for (const a of branch ?? []) await this.doAction(a, p)
    } else if (act.waitReady) {
      await this.waitReady(act.waitReady, p)
    } else if (act.goto !== undefined) {
      await this.page.goto(new URL(act.goto, this.map.defaults.url).toString(), {
        waitUntil: 'domcontentloaded',
      })
    } else if (act.open) {
      const s = this.screen(act.open)
      for (const a of s.reach ?? []) await this.doAction(a, p)
      await this.waitReady(act.open, p)
    } else if (act.click) {
      await this.click(act.click, p)
    } else if (act.dblclick) {
      await this.click(act.dblclick, p, { dbl: true })
    } else if (act.fill) {
      const l = this.locator(act.fill, p)
      await l.waitFor({ state: 'visible', timeout: 5000 })
      await l.fill(String(act.value))
    } else if (act.select) {
      const l = this.locator(act.select, p)
      await l.waitFor({ state: 'visible', timeout: 5000 })
      const want = act.option
      const val = await l.evaluate((el, w) => {
        const o = [...el.options].find((o) => o.textContent.replace(/\s+/g, ' ').trim() === w)
        return o ? o.value : null
      }, want)
      if (val === null)
        throw new StepError(
          'assert',
          `option "${want}" not offered by ${this.describe(act.select)}`,
        )
      await l.selectOption(val)
    } else if (act.type !== undefined) {
      await this.page.keyboard.type(String(act.type))
    } else if (act.press) {
      await this.page.keyboard.press(act.press)
    } else if (act.dispatch) {
      await this.page.evaluate((ev) => window.dispatchEvent(new Event(ev)), act.dispatch)
    } else if (act.waitFor) {
      const r = await this.check(act.waitFor, p, {
        timeoutMs: act.timeoutMs ?? this.map.defaults.readyTimeoutMs,
      })
      if (!r.ok)
        throw new StepError(
          'assert',
          `waited for ${act.waitFor.id ?? act.waitFor.type}: ${r.detail}`,
        )
    } else if (act.capture?.attr) {
      const c = act.capture
      const l = this.locator(c.sel, p)
      const v = await l.getAttribute(c.attr, { timeout: 5000 })
      if (v === null)
        throw new StepError('assert', `capture ${c.name}: no ${c.attr} on ${this.describe(c.sel)}`)
      this.vars[c.name] = v
    } else if (act.capture) {
      const c = act.capture
      const t = await this.regionText(c.region)
      const m = t?.match(new RegExp(c.re))
      if (!m) throw new StepError('assert', `capture ${c.name}: no /${c.re}/ in ${c.region}`)
      this.vars[c.name] = m[c.group ?? 1]
    } else if (act.setViewport) {
      await this.page.setViewportSize(act.setViewport)
    } else if (act.mouseClickAt) {
      const l = this.locator(act.mouseClickAt.sel, p)
      const box = await l.boundingBox()
      if (!box) throw new StepError('driver', 'no box for mouseClickAt')
      await this.page.mouse.click(
        box.x + (act.mouseClickAt.dx ?? 5),
        box.y + (act.mouseClickAt.dy ?? 5),
      )
    } else {
      throw new StepError('driver', `unknown action ${JSON.stringify(act)}`)
    }
  }

  // ---------- console / crash ----------
  newConsoleProblems(sinceIdx, sincePageErr) {
    const benign = this.map.consoleBenign
    const bad404 = this.badResponses.filter((r) => r.status === 404)
    const problems = []
    for (const c of this.console.slice(sinceIdx)) {
      if (c.type !== 'error') continue
      const b = benign.find((x) => new RegExp(x.pattern).test(c.text))
      // a 404 is benign only when its URL is the favicon (console location, else the network log)
      const urlOk = (u) => new RegExp(b.onlyIf404Url).test(u)
      if (
        b &&
        (!b.onlyIf404Url ||
          (c.url ? urlOk(c.url) : bad404.length > 0 && bad404.every((r) => urlOk(r.url))))
      ) {
        c.benign = b.why
        continue
      }
      problems.push(`console.error: ${c.text.slice(0, 300)}`)
    }
    for (const e of this.pageErrors.slice(sincePageErr))
      problems.push(`pageerror: ${e.text.slice(0, 300)}`)
    return problems
  }

  // ---------- artifacts ----------
  async saveArtifacts(stepId, regionRef) {
    const dir = path.join(this.outDir, 'artifacts', this.wf)
    fs.mkdirSync(dir, { recursive: true })
    const base = path.join(dir, stepId.replace(/[^\w.-]+/g, '_'))
    const out = {}
    try {
      await this.page.screenshot({ path: `${base}.png`, fullPage: false })
      out.screenshot = `${base}.png`
    } catch {}
    let el = null
    if (regionRef) {
      try {
        el = await this.regionLocator(regionRef)
      } catch {}
    }
    try {
      const target = el ?? this.page.locator('body')
      const aria = await target.first().ariaSnapshot({ timeout: 3000 })
      const text = norm(await target.first().innerText({ timeout: 3000 }))
      fs.writeFileSync(
        `${base}.panel.txt`,
        `# region: ${regionRef ? this.describe(regionRef) : 'body'}${el ? '' : ' (region not found → whole page)'}\n\n## innerText\n${text}\n\n## accessibility snapshot\n${aria}\n`,
        'utf8',
      )
      out.panelText = `${base}.panel.txt`
      let html = await target.first().evaluate((e) => e.outerHTML)
      if (html.length > 40000) html = `${html.slice(0, 40000)}\n<!-- truncated at 40000 chars -->`
      fs.writeFileSync(`${base}.dom.html`, html, 'utf8')
      out.dom = `${base}.dom.html`
    } catch (e) {
      out.artifactError = String(e.message).split('\n')[0]
    }
    try {
      fs.writeFileSync(
        `${base}.console.txt`,
        this.console
          .map(
            (c) =>
              `[${c.type}]${c.benign ? '[benign]' : ''} (step ${c.step}) ${c.text}${c.url ? `  @ ${c.url}` : ''}`,
          )
          .join('\n') +
          '\n\n# HTTP >= 400\n' +
          this.badResponses.map((r) => `${r.status} ${r.url}`).join('\n') +
          '\n\n# page errors\n' +
          this.pageErrors.map((e) => e.text).join('\n---\n'),
        'utf8',
      )
      out.console = `${base}.console.txt`
    } catch {}
    return out
  }

  // ---------- Laya (advisory) ----------
  async layaCheckpoint(screenId, stepId) {
    if (!this.laya) return null
    const s = this.screen(screenId)
    if (!s.laya?.length) return null
    const el = await this.regionLocator(s.region ? `${screenId}` : null).catch(() => null)
    if (!el) return { skipped: 'region not found' }
    const aria = await el
      .first()
      .ariaSnapshot({ timeout: 3000 })
      .catch(() => null)
    if (!aria) return { skipped: 'no snapshot' }
    const state = compactForLaya(
      aria,
      this.laya.o.maxChars,
      this.laya.o.stripBenign === false ? [] : this.map.benignText,
    )
    const truths = []
    for (const q of s.laya) {
      const r = await this.evalOnce(q.truth)
      if (r.missing || r.nomatch) continue // assert not applicable on this screen state → don't ask
      truths.push({ ...q, truth: r.ok })
    }
    if (!truths.length) return { skipped: 'no applicable questions' }
    const res = await this.laya.ask(
      state,
      truths.map((t) => ({ id: t.id, q: t.q })),
    )
    if (res.error) return { error: res.error }
    const answers = truths.map((t) => {
      const p = res.answers?.[t.id]?.noul
      const says = p >= 0.5
      const conf = Math.max(p, 1 - p)
      const flag = says !== t.truth && conf >= this.laya.o.flagAt
      return {
        id: t.id,
        q: t.q,
        assertSays: t.truth,
        layaP: p,
        layaSays: says,
        conf: Number(conf.toFixed(4)),
        agree: says === t.truth,
        flag,
      }
    })
    const run = {
      step: stepId,
      screen: screenId,
      stateChars: state.length,
      modelMs: res.latency_ms,
      roundtripMs: res.roundtripMs,
      answers,
    }
    this.layaRuns.push(run)
    for (const a of answers)
      if (a.flag)
        this.layaFlags.push({
          step: stepId,
          screen: screenId,
          ...a,
          note: 'take a look: Laya disagrees with the coded assert at >= 0.9 (the assert decides)',
        })
    return run
  }
}

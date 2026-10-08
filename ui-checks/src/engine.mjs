// App-aware click-through engine: resolves the app map, drives Playwright, evaluates coded asserts
// (the source of truth), runs per-screen invariants + the global crash watch after every step, and
// asks Laya (advisory only) at checkpoints.
import fs from 'node:fs'
import path from 'node:path'
import { compactForLaya } from './laya.mjs'
import { makePack } from './pack-fixture.mjs'
import { readZip } from './zip.mjs'

export class StepError extends Error {
  constructor(category, message, extra = {}) {
    super(message)
    this.category = category // 'assert' | 'unreachable' | 'driver' | 'console' | 'crash'
    Object.assign(this, extra)
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim()
// "a.b[0].length" or ["key/with/slashes", 0] → value (undefined when any step is missing)
const jsonAt = (doc, at) => {
  const keys = Array.isArray(at)
    ? at
    : String(at)
        .replace(/\[(\d+)\]/g, '.$1')
        .split('.')
        .filter((k) => k !== '')
  let v = doc
  for (const k of keys) {
    if (v === null || v === undefined) return undefined
    v = k === 'length' && (Array.isArray(v) || typeof v === 'string') ? v.length : v[k]
  }
  return v
}

export class Engine {
  constructor({
    map,
    page,
    context,
    outDir,
    laya,
    log,
    workflowName,
    target = 'browser',
    session = null,
    pathVars = {},
  }) {
    this.map = map
    this.context = context
    this.target = target
    this.session = session // ElectronSession in --target electron
    this.pathVars = pathVars // {sandbox}, {home}, {userData}, {files}, {out}, {fixtures}
    this.dialogMark = 0
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
    this.attachPage(page)
  }

  /** (Re)attach to a page — once at start, and again after an Electron relaunch. */
  attachPage(page) {
    this.page = page
    if (this.session?.app) {
      // main-process console errors count like renderer ones
      this.session.app.on('console', (m) => {
        if (m.type() === 'error')
          this.console.push({
            type: 'error',
            text: `[main] ${m.text()}`,
            url: 'main-process',
            step: this.currentStep,
          })
      })
    }
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
    const all = { ...this.pathVars, ...(params ?? {}) }
    if (!Object.keys(all).length) return spec
    // JSON-escape the value: Windows paths carry backslashes
    const s = JSON.stringify(spec).replace(/\{(\w+)\}/g, (m, k) =>
      all[k] !== undefined ? JSON.stringify(String(all[k])).slice(1, -1) : m,
    )
    return JSON.parse(s)
  }

  electronOnly(what) {
    if (!this.session?.app)
      throw new StepError('driver', `${what} needs --target electron (no Electron app in this run)`)
    return this.session
  }

  /** Called by the runner before each step: dialogs are counted per step. */
  async beginStep() {
    if (this.session?.app) this.dialogMark = (await this.session.dialogCalls()).length
  }

  async stepDialogs() {
    if (!this.session?.app) return []
    return (await this.session.dialogCalls()).slice(this.dialogMark)
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
    if (a.with) params = { ...params, ...a.with } // assert-level placeholders
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
      // ---- Electron target: native menu, window, dialogs, files on disk ----
      case 'menuItem': {
        const f = this.fill(a, params)
        const it = await this.electronOnly('menuItem').menuItem(f.path.split(/\s*▸\s*/))
        if (!it.found)
          return {
            ok: f.exists === false,
            detail: `no '${it.missing}' (has: ${it.available.join(', ')})`,
          }
        if (f.exists === false) return { ok: false, detail: `'${it.label}' exists` }
        const bad = []
        if (f.enabled !== undefined && it.enabled !== f.enabled) bad.push(`enabled=${it.enabled}`)
        if (f.accelerator !== undefined && it.accelerator !== f.accelerator)
          bad.push(`accelerator=${it.accelerator}`)
        if (f.checked !== undefined && it.checked !== f.checked) bad.push(`checked=${it.checked}`)
        for (const want of f.submenuIncludes ?? [])
          if (!(it.submenu ?? []).some((l) => l === want || l.startsWith(want)))
            bad.push(`submenu lacks '${want}' (has: ${(it.submenu ?? []).join(', ')})`)
        return {
          ok: bad.length === 0,
          detail: bad.length
            ? `${it.label}: ${bad.join(', ')}`
            : `${it.label} (enabled=${it.enabled}${it.accelerator ? `, ${it.accelerator}` : ''})`,
        }
      }
      case 'windowTitle': {
        const f = this.fill(a, params)
        const t = await this.electronOnly('windowTitle').windowTitle()
        const ok = new RegExp(f.matches).test(t ?? '')
        return { ok, detail: `window title "${t}"` }
      }
      case 'dialogs': {
        // native dialogs the app asked for during this step (stubbed in the main process)
        const f = this.fill(a, params)
        this.electronOnly('dialogs')
        const calls = (await this.stepDialogs()).filter((c) => c.kind === f.kind)
        const last = calls.at(-1)
        const bad = []
        if (f.count !== undefined && calls.length !== f.count)
          bad.push(`${calls.length} ${f.kind} dialog(s), expected ${f.count}`)
        if (f.min !== undefined && calls.length < f.min)
          bad.push(`${calls.length} ${f.kind} dialog(s), expected ≥ ${f.min}`)
        const fields = { titleRe: 'title', defaultPathRe: 'defaultPath', contentRe: 'content' }
        for (const [k, field] of Object.entries(fields))
          if (f[k] !== undefined && !new RegExp(f[k]).test(last?.[field] ?? ''))
            bad.push(`last ${field} "${last?.[field] ?? '(none)'}" !~ /${f[k]}/`)
        for (const want of f.filtersInclude ?? [])
          if (!(last?.filters ?? []).includes(want)) bad.push(`filters lack '${want}'`)
        return {
          ok: bad.length === 0,
          detail: bad.length
            ? bad.join('; ')
            : `${calls.length} ${f.kind} dialog(s)${last?.title ? ` — "${last.title}"` : ''}${last?.defaultPath ? ` default ${last.defaultPath}` : ''}`,
        }
      }
      case 'file': {
        const f = this.fill(a, params)
        const file = path.resolve(f.path)
        const exists = fs.existsSync(file)
        if (f.exists === false)
          return { ok: !exists, detail: exists ? `${file} exists` : `${file} absent` }
        if (!exists) return { ok: false, detail: `${file} does not exist` }
        const st = fs.statSync(file)
        if (st.isDirectory()) return { ok: f.dir === true, detail: `${file} is a folder` }
        const bad = []
        if (f.minBytes !== undefined && st.size < f.minBytes)
          bad.push(`${st.size} bytes < ${f.minBytes}`)
        const text = fs.readFileSync(file, 'utf8')
        if (f.matches && !new RegExp(f.matches, f.flags ?? '').test(text))
          bad.push(`text !~ /${f.matches}/`)
        if (f.notMatches && new RegExp(f.notMatches, f.flags ?? '').test(text))
          bad.push(`text ~ /${f.notMatches}/`)
        if (f.json) {
          let doc
          try {
            doc = JSON.parse(text)
          } catch (e) {
            return { ok: false, detail: `${file} is not JSON: ${e.message}` }
          }
          for (const c of f.json) {
            const v = jsonAt(doc, c.at)
            const show = JSON.stringify(v)?.slice(0, 120)
            if (c.eq !== undefined && JSON.stringify(v) !== JSON.stringify(c.eq))
              bad.push(`${c.at} = ${show}, expected ${JSON.stringify(c.eq)}`)
            if (c.matches !== undefined && !new RegExp(c.matches).test(String(v ?? '')))
              bad.push(`${c.at} = ${show} !~ /${c.matches}/`)
            if (c.gte !== undefined && !(Number(v) >= c.gte))
              bad.push(`${c.at} = ${show} < ${c.gte}`)
            if (c.exists === false && v !== undefined) bad.push(`${c.at} present (${show})`)
            if (c.exists === true && v === undefined) bad.push(`${c.at} missing`)
          }
        }
        return {
          ok: bad.length === 0,
          detail: bad.length ? `${file}: ${bad.join('; ')}` : `${file} (${st.size} bytes)`,
        }
      }
      case 'zip': {
        const f = this.fill(a, params)
        const file = path.resolve(f.path)
        if (!fs.existsSync(file)) return { ok: false, detail: `${file} does not exist` }
        let z
        try {
          z = readZip(file)
        } catch (e) {
          return { ok: false, detail: `${file} does not open as a ZIP: ${e.message}` }
        }
        const bad = []
        for (const want of f.entries ?? []) {
          const re = new RegExp(want.nameRe)
          const hits = z.entries.filter((e) => re.test(e.name))
          if (!hits.length) {
            bad.push(`no entry /${want.nameRe}/`)
            continue
          }
          for (const e of hits) {
            if (e.size < (want.minBytes ?? 1)) bad.push(`${e.name} is ${e.size} bytes`)
            const head = e.data.subarray(0, 4096).toString('utf8')
            if (want.startsRe && !new RegExp(want.startsRe).test(head))
              bad.push(`${e.name} starts "${head.slice(0, 40).replace(/\s+/g, ' ')}"`)
            if (want.contains && !e.data.toString('utf8').includes(want.contains))
              bad.push(`${e.name} lacks "${want.contains}"`)
          }
        }
        if (f.minEntries !== undefined && z.entries.length < f.minEntries)
          bad.push(`${z.entries.length} entries < ${f.minEntries}`)
        if (f.noEmptyEntries)
          for (const e of z.entries) if (e.size === 0) bad.push(`${e.name} is empty`)
        const list = z.entries.map((e) => `${e.name} (${e.size})`).join(', ')
        return {
          ok: bad.length === 0,
          detail: bad.length
            ? `${bad.join('; ')} — entries: ${list}`
            : `${z.entries.length} entries, all CRC-checked: ${list}`,
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
      // Electron loads its own built index.html; "go to the start" there is a reload.
      if (this.session?.app) await this.page.reload({ waitUntil: 'domcontentloaded' })
      else
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
    } else if (act.menu) {
      const r = await this.electronOnly('menu').clickMenu(act.menu.split(/\s*▸\s*/))
      if (!r.ok) throw new StepError('assert', `native menu ${act.menu}: ${r.why}`)
      // A person cannot pick two menu items within one frame; let the renderer commit the IPC's state
      // update first (back-to-back Select All → Copy otherwise copies the pre-selection canvas).
      await this.settle()
    } else if (act.settle) {
      await this.settle()
    } else if (act.dialog) {
      // queue the answer the next native open/save dialog gets
      const s = this.electronOnly('dialog')
      const d = act.dialog
      if (d.open)
        await s.queueDialog('open', { paths: [].concat(d.open).map((f) => path.resolve(f)) })
      else if (d.save) await s.queueDialog('save', { path: path.resolve(d.save) })
      else if (d.cancel) await s.queueDialog(d.cancel, { cancel: true })
      else throw new StepError('driver', `bad dialog action ${JSON.stringify(d)}`)
    } else if (act.relaunch) {
      // quit the app and start it again on the same sandbox (persistence checks)
      const s = this.electronOnly('relaunch')
      await s.close()
      await s.launch()
      this.dialogMark = 0
      this.attachPage(s.page)
    } else if (act.writeFile) {
      const w = act.writeFile
      const file = this.sandboxed(w.path, 'writeFile')
      fs.mkdirSync(path.dirname(file), { recursive: true })
      if (w.copyFrom) fs.copyFileSync(path.resolve(w.copyFrom), file)
      else
        fs.writeFileSync(
          file,
          w.json !== undefined ? JSON.stringify(w.json, null, 2) : String(w.text ?? ''),
          'utf8',
        )
    } else if (act.editFile) {
      const e = act.editFile
      const file = this.sandboxed(e.path, 'editFile')
      if (!fs.existsSync(file))
        throw new StepError('precondition', `editFile: ${file} does not exist`)
      let t = fs.readFileSync(file, 'utf8')
      if (e.replace) {
        if (!t.includes(e.replace[0]))
          throw new StepError('precondition', `editFile: "${e.replace[0]}" not found in ${file}`)
        t = t.replace(e.replace[0], e.replace[1])
      }
      if (e.append !== undefined) t += e.append
      fs.writeFileSync(file, t, 'utf8')
    } else if (act.makePack) {
      const m = act.makePack
      const file = this.sandboxed(m.path, 'makePack')
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const { text, publicKeyHex } = makePack(m)
      fs.writeFileSync(file, text, 'utf8')
      if (m.keyVar) this.vars[m.keyVar] = publicKeyHex
    } else {
      throw new StepError('driver', `unknown action ${JSON.stringify(act)}`)
    }
  }

  /** Two animation frames: React has committed whatever the last event scheduled. */
  async settle() {
    await this.page
      .evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
      .catch(() => {})
  }

  /** Test-side writes stay inside the Electron sandbox. */
  sandboxed(p, what) {
    this.electronOnly(what)
    const file = path.resolve(p)
    const rel = path.relative(path.resolve(this.pathVars.sandbox), file)
    if (rel.startsWith('..') || path.isAbsolute(rel))
      throw new StepError('driver', `${what}: ${file} is outside the sandbox`)
    return file
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
    if (this.session?.app) {
      // Electron: what the stubbed native dialogs were asked, and what is in the sandbox
      try {
        const tree = []
        const walk = (d, depth) => {
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, e.name)
            if (e.isDirectory()) {
              if (
                depth < 6 &&
                !/^(Cache|Code Cache|GPUCache|Dawn\w*|blob_storage|Crashpad|Network|Shared Dictionary|Session Storage|Local Storage|DIPS|logs)$/.test(
                  e.name,
                )
              )
                walk(full, depth + 1)
            } else
              tree.push(`${path.relative(this.pathVars.sandbox, full)}  ${fs.statSync(full).size}`)
          }
        }
        walk(this.pathVars.sandbox, 0)
        const calls = await this.session.dialogCalls()
        fs.writeFileSync(
          `${base}.electron.txt`,
          `# native dialogs since launch (stubbed)\n${JSON.stringify(calls, null, 2)}\n\n# sandbox files\n${tree.join('\n')}\n`,
          'utf8',
        )
        out.electron = `${base}.electron.txt`
      } catch (e) {
        out.electronError = String(e.message).split('\n')[0]
      }
    }
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

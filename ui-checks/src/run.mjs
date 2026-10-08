#!/usr/bin/env node
// ChipBlocks app-aware UI click-through runner (ui-checks).
//   npm run ui-checks                                  every workflow (Laya only if configured)
//   npm run ui-checks:fast                             every workflow, Laya off
//   node ui-checks/src/run.mjs --workflow <name>[,…]   one or more workflows
//   node ui-checks/src/run.mjs --list                  workflow names
// Flags: --no-laya  --laya-sidecar <path>  --laya-python <exe>  --laya-raw  --headed  --url <u>
//        --repo <path>  --out <dir>  --keep-server  --chrome <exe>
// Env:   LAYA_SIDECAR, LAYA_PYTHON (Laya advisor, optional), CHROME_EXE (optional browser override)
import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { Engine, StepError } from './engine.mjs'
import { Laya } from './laya.mjs'
import { writeReports } from './report.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const args = process.argv.slice(2)
const flag = (n) => args.includes(`--${n}`)
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : d
}

// Tolerate a UTF-8 BOM (Windows editors add one) and say which file is broken.
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  } catch (e) {
    throw new Error(`${file}: ${e.message}`)
  }
}
const map = readJson(path.join(ROOT, 'map', 'app-map.json'))
const wfDir = path.join(ROOT, 'workflows')
const workflows = fs
  .readdirSync(wfDir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => readJson(path.join(wfDir, f)))

if (flag('list')) {
  for (const w of workflows) console.log(`${w.name.padEnd(28)} ${w.title}`)
  process.exit(0)
}
const want = opt('workflow')
const selected = want
  ? want.split(',').map((n) => {
      const w = workflows.find((x) => x.name === n.trim())
      if (!w) {
        console.error(`no workflow '${n}'. Use --list.`)
        process.exit(2)
      }
      return w
    })
  : workflows

const url = opt('url', map.defaults.url)
map.defaults.url = url
const repo = path.resolve(opt('repo', path.resolve(ROOT, '..')))
// Playwright's managed Chromium (`npx playwright install chromium`) unless a browser is named.
const chromeExe = opt('chrome', process.env.CHROME_EXE || '')
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const outDir = path.resolve(opt('out', path.join(ROOT, 'runs', stamp)))
fs.mkdirSync(outDir, { recursive: true })
const log = (...a) => console.log(...a)

async function reachable(u) {
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(2000) })
    return r.ok
  } catch {
    return false
  }
}

let server = null
async function ensureServer() {
  if (await reachable(url)) return { started: false }
  const port = new URL(url).port || '5180'
  log(`dev server not reachable at ${url}; starting vite in ${repo}`)
  server = spawn(`npx vite --config vite.renderer.config.ts --port ${Number(port)} --strictPort`, {
    cwd: repo,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  server.stdout.on('data', () => {})
  server.stderr.on('data', () => {})
  const t0 = Date.now()
  while (Date.now() - t0 < 60000) {
    if (await reachable(url)) return { started: true, pid: server.pid, ms: Date.now() - t0 }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('vite dev server did not come up within 60 s')
}
function stopServer() {
  if (!server) return
  try {
    if (process.platform === 'win32')
      execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: 'ignore' })
    else process.kill(-server.pid)
  } catch {}
  server = null
}
process.on('SIGINT', () => {
  stopServer()
  process.exit(130)
})

function gitHead() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: repo }).toString().trim()
  } catch {
    return 'unknown'
  }
}

async function runWorkflow(browser, wf, laya) {
  const vp = wf.viewport ?? map.defaults.viewport
  const context = await browser.newContext({ viewport: vp })
  const page = await context.newPage()
  const eng = new Engine({ map, page, context, outDir, laya, log, workflowName: wf.name })
  const result = {
    name: wf.name,
    title: wf.title,
    covers: wf.covers,
    notes: wf.notes,
    viewport: vp,
    steps: [],
    startedAt: new Date().toISOString(),
  }
  const t0 = Date.now()
  let blockedBy = null
  const hasBridge = async () =>
    page.evaluate(() => typeof window.chipblocks !== 'undefined').catch(() => false)
  for (const step of wf.steps) {
    const rec = { id: step.id, title: step.title, status: 'pass', asserts: [], invariants: [] }
    const ts = Date.now()
    eng.currentStep = step.id
    const c0 = eng.console.length
    const p0 = eng.pageErrors.length
    try {
      if (blockedBy && !step.independent) {
        rec.status = 'skip'
        rec.reason = `blocked: earlier step '${blockedBy}' failed`
        throw null
      }
      const req = (step.requires ?? []).filter((r) => r.startsWith('electron:'))
      if (req.length && !(await hasBridge())) {
        const why = req.map((r) => map.electronOnly.find((e) => e.id === r)?.skip ?? r).join(' ')
        rec.status = 'skip'
        rec.reason = `browser-only dev server: ${why}`
        throw null
      }
      for (const a of step.pre ?? []) {
        const r = await eng.check(a, step.with, { timeoutMs: 3000 })
        rec.asserts.push({
          kind: 'pre',
          id: a.id ?? a.type,
          why: a.why,
          ok: r.ok,
          detail: r.detail,
          ms: r.ms,
        })
        if (!r.ok)
          throw new StepError('precondition', `precondition ${a.id ?? a.type} failed: ${r.detail}`)
      }
      const acts = step.do === undefined ? [] : Array.isArray(step.do) ? step.do : [step.do]
      for (const a of acts) await eng.doAction(a, step.with)
      for (const a of step.expect ?? []) {
        const r = await eng.check(a, step.with)
        rec.asserts.push({
          kind: 'expect',
          id: a.id ?? a.type,
          why: a.why,
          ok: r.ok,
          detail: r.detail,
          ms: r.ms,
        })
      }
      // per-screen invariants, then the global crash watch
      const screens = step.screen ? [].concat(step.screen) : []
      for (const sid of screens) {
        for (const inv of eng.screen(sid).invariants ?? []) {
          const r = await eng.check(inv, step.with, { timeoutMs: 1500 })
          rec.invariants.push({
            id: inv.id,
            why: inv.why,
            ok: r.ok,
            detail: r.detail,
            vacuous: !!r.vacuous,
          })
        }
      }
      for (const g of map.globalWatch.afterEveryStep) {
        const r = await eng.check(g, null, { once: true })
        rec.invariants.push({ id: g.id, why: g.why, ok: r.ok, detail: r.detail, global: true })
      }
      const failedA = rec.asserts.filter((a) => !a.ok)
      const failedI = rec.invariants.filter((a) => !a.ok)
      const crash = failedI.find((i) => i.global)
      if (crash) throw new StepError('crash', `crash watch: ${crash.id}: ${crash.detail}`)
      if (failedA.length)
        throw new StepError('assert', failedA.map((a) => `${a.id}: ${a.detail}`).join(' ‖ '))
      if (failedI.length)
        throw new StepError('invariant', failedI.map((a) => `${a.id}: ${a.detail}`).join(' ‖ '))
      const cp = eng.newConsoleProblems(c0, p0)
      if (cp.length) throw new StepError('console', cp.join(' ‖ '))
      if (laya && step.laya)
        rec.laya = await eng.layaCheckpoint([].concat(step.screen).at(-1), step.id)
    } catch (e) {
      if (e !== null) {
        const cp = eng.newConsoleProblems(c0, p0)
        rec.status = 'fail'
        rec.category = e instanceof StepError ? e.category : 'driver'
        rec.reason =
          e instanceof StepError
            ? e.message
            : `runner error: ${String(e?.message ?? e).split('\n')[0]}`
        if (cp.length && rec.category !== 'console') rec.consoleDuringStep = cp
        if (step.knownIssue) {
          // A tagged, still-open app issue: reported, evidence saved, but it does not fail the run.
          rec.knownIssue = step.knownIssue
          rec.status = 'known'
        }
        const regionRef = [].concat(step.screen ?? []).at(-1)
        rec.artifacts = await eng.saveArtifacts(
          step.id,
          regionRef ? (map.screens[regionRef]?.region ? regionRef : null) : null,
        )
        if (!step.continueOnFail) blockedBy = step.id
      }
    }
    if (rec.status === 'pass' && step.knownIssue)
      rec.note = `known issue '${step.knownIssue}' no longer reproduces; remove the knownIssue tag`
    rec.ms = Date.now() - ts
    result.steps.push(rec)
    const mark = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP', known: 'KNOWN' }[rec.status]
    log(
      `  ${mark} ${wf.name} › ${step.id}${rec.reason ? ` — ${rec.reason.slice(0, 160)}` : ''} (${rec.ms} ms)`,
    )
  }
  result.ms = Date.now() - t0
  result.laya = { runs: eng.layaRuns, flags: eng.layaFlags }
  result.console = {
    errorList: eng.console
      .filter((c) => c.type === 'error')
      .map((c) => ({
        text: c.text.slice(0, 300),
        url: c.url,
        step: c.step,
        benign: c.benign ?? null,
      })),
    errors: eng.console.filter((c) => c.type === 'error').length,
    warnings: eng.console.filter((c) => c.type === 'warning').length,
    benignErrors: eng.console.filter((c) => c.benign).length,
    http4xx: eng.badResponses.map((r) => `${r.status} ${r.url}`),
  }
  await context.close()
  return result
}

const tStart = Date.now()
// Laya is an optional advisor: it runs only when a sidecar is configured, and never gates.
let laya = null
const layaSidecar = opt('laya-sidecar', process.env.LAYA_SIDECAR || '')
const layaPython = opt('laya-python', process.env.LAYA_PYTHON || 'python')
let layaOff = flag('no-laya')
  ? '--no-laya'
  : !layaSidecar
    ? 'not configured (set LAYA_SIDECAR or --laya-sidecar)'
    : null
if (!layaOff) {
  if (!fs.existsSync(layaSidecar)) layaOff = `sidecar not found at ${layaSidecar}`
  else {
    laya = new Laya({ python: layaPython, sidecar: layaSidecar, stripBenign: !flag('laya-raw') })
    laya.start()
  }
}
let srv
let exitCode = 0
try {
  srv = await ensureServer()
  let browser
  try {
    browser = await chromium.launch({
      ...(chromeExe ? { executablePath: chromeExe } : {}),
      headless: !flag('headed'),
    })
  } catch (e) {
    throw new Error(
      `could not launch Chromium (${String(e.message).split('\n')[0]}). Run \`npx playwright install chromium\` or pass --chrome <exe>.`,
    )
  }
  if (laya) {
    const ok = await laya.whenReady()
    log(
      ok
        ? `Laya sidecar ready (${laya.coldMs} ms cold)`
        : `Laya unavailable: ${laya.failed} — continuing without it`,
    )
    if (!ok) {
      layaOff = laya.failed
      laya.stop()
      laya = null
    }
  }
  const results = []
  for (const wf of selected) {
    log(`▶ ${wf.name} — ${wf.title}`)
    results.push(await runWorkflow(browser, wf, laya))
  }
  await browser.close()
  const run = {
    tool: 'chipblocks ui-runner',
    startedAt: new Date(tStart).toISOString(),
    ms: Date.now() - tStart,
    commit: gitHead(),
    url,
    repo,
    outDir,
    browser: chromeExe || 'playwright-managed chromium',
    devServer: srv,
    laya: laya
      ? {
          enabled: true,
          coldMs: laya.coldMs,
          calls: laya.calls,
          avgRoundtripMs: laya.calls ? Math.round(laya.totalMs / laya.calls) : null,
          flagAt: laya.o.flagAt,
        }
      : { enabled: false, reason: layaOff ?? 'off' },
    workflows: results,
  }
  const { md, json, totals } = writeReports(run, map, outDir)
  log(
    `\n${totals.pass} pass · ${totals.fail} fail · ${totals.known} known issue · ${totals.skip} skip  (${totals.failByCategory}) in ${(run.ms / 1000).toFixed(1)} s`,
  )
  log(`report: ${md}\njson:   ${json}`)
  exitCode = totals.fail > 0 ? 1 : 0
} catch (e) {
  console.error('runner aborted:', e)
  exitCode = 3
} finally {
  laya?.stop()
  if (!flag('keep-server')) stopServer()
}
process.exit(exitCode)

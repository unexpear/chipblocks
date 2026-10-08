// `--target electron`: builds the app if needed, launches the real Electron app through Playwright's
// _electron with every data folder pointed at a throwaway sandbox (isolate.cjs), stubs the native
// file dialogs in the main process, and reads the native menu.
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ISOLATE = path.join(HERE, 'isolate.cjs')
// Folders the app reads or writes. All of them must resolve inside the sandbox before a step runs.
const GUARDED = ['home', 'appData', 'userData', 'sessionData', 'documents', 'desktop', 'downloads']

function newestMtime(p) {
  if (!fs.existsSync(p)) return 0
  const st = fs.statSync(p)
  if (!st.isDirectory()) return st.mtimeMs
  let m = 0
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    m = Math.max(m, newestMtime(path.join(p, e.name)))
  }
  return m
}

/** Build out/ with electron-vite when it is missing or older than the sources (or when forced). */
export function ensureBuilt(repo, { force = false, skip = false, log = () => {} } = {}) {
  const outs = ['out/main/main.js', 'out/preload/preload.cjs', 'out/renderer/index.html'].map((p) =>
    path.join(repo, p),
  )
  const have = outs.every((p) => fs.existsSync(p))
  if (skip) {
    if (!have) throw new Error('--no-build was given but out/ has no build. Run `npm run build`.')
    return { built: false, reason: '--no-build' }
  }
  const builtAt = have ? Math.min(...outs.map((p) => fs.statSync(p).mtimeMs)) : 0
  const inputs = ['electron', 'src', 'schemas', 'electron.vite.config.ts', 'package-lock.json']
  const newest = Math.max(...inputs.map((p) => newestMtime(path.join(repo, p))))
  if (!force && have && builtAt >= newest)
    return { built: false, reason: 'out/ is newer than the sources' }
  const why = force ? '--build' : have ? 'sources changed since the last build' : 'no build yet'
  log(`building the Electron app (npx electron-vite build — ${why})…`)
  const t0 = Date.now()
  try {
    execSync('npx electron-vite build', { cwd: repo, stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 })
  } catch (e) {
    const tail = String(e.stdout ?? '') + String(e.stderr ?? '')
    throw new Error(`electron-vite build failed:\n${tail.slice(-3000)}`)
  }
  return { built: true, reason: why, ms: Date.now() - t0 }
}

/** A fresh sandbox: home (with Documents/Desktop/Downloads), userData, appData, files, out. */
export function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chipblocks-uic-'))
  const s = {
    root,
    home: path.join(root, 'home'),
    userData: path.join(root, 'userData'),
    appData: path.join(root, 'appData'),
    files: path.join(root, 'files'),
    out: path.join(root, 'out'),
  }
  for (const d of [s.home, s.userData, s.appData, s.files, s.out])
    fs.mkdirSync(d, { recursive: true })
  for (const d of ['Documents', 'Desktop', 'Downloads'])
    fs.mkdirSync(path.join(s.home, d), { recursive: true })
  return s
}

export function removeSandbox(s) {
  try {
    fs.rmSync(s.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
    return true
  } catch {
    return false
  }
}

const inside = (p, root) => {
  const rel = path.relative(path.resolve(root), path.resolve(p))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export class ElectronSession {
  constructor({ repo, sandbox, size, log }) {
    this.repo = repo
    this.sandbox = sandbox
    this.size = size
    this.log = log ?? (() => {})
    this.app = null
    this.page = null
    this.mainConsole = [] // main-process console messages {type, text}
    this.launches = 0
  }

  async launch() {
    const exe = createRequire(path.join(this.repo, 'package.json'))('electron')
    const env = {
      ...process.env,
      CHIPBLOCKS_UIC_SANDBOX: this.sandbox.root,
      USERPROFILE: this.sandbox.home,
      HOME: this.sandbox.home,
    }
    // Load the built renderer (file://), never a dev server; and none of the dev-only switches.
    for (const k of ['ELECTRON_RENDERER_URL', 'CHIP_DEBUG_PORT', 'ELECTRON_RUN_AS_NODE'])
      delete env[k]
    const t0 = Date.now()
    this.app = await _electron.launch({
      executablePath: exe,
      // Keep rendering while the window is covered (Windows occlusion tracking would otherwise stop
      // requestAnimationFrame and React Flow never measures new nodes).
      args: ['-r', ISOLATE, '--disable-features=CalculateNativeWinOcclusion', '.'],
      cwd: this.repo,
      env,
      timeout: 60000,
    })
    this.launches++
    this.app.on('console', (m) => this.mainConsole.push({ type: m.type(), text: m.text() }))
    this.paths = await this.verifyIsolation()
    await this.installDialogStubs()
    this.page = await this.app.firstWindow({ timeout: 30000 })
    await this.page.waitForLoadState('domcontentloaded')
    this.window = await this.app.evaluate(({ BrowserWindow }, size) => {
      const w = BrowserWindow.getAllWindows()[0]
      w.webContents.setBackgroundThrottling(false)
      if (size) w.setContentSize(size.width, size.height)
      return { content: w.getContentSize(), outer: w.getSize() }
    }, this.size ?? null)
    this.launchMs = Date.now() - t0
    return this.page
  }

  /** Every app data folder must resolve inside the sandbox; otherwise stop before anything runs. */
  async verifyIsolation() {
    const paths = await this.app.evaluate(
      ({ app }, names) => Object.fromEntries(names.map((n) => [n, app.getPath(n)])),
      GUARDED,
    )
    const outside = Object.entries(paths).filter(([, p]) => !inside(p, this.sandbox.root))
    if (outside.length) {
      await this.kill()
      throw new Error(
        `isolation check failed — app folders outside the sandbox: ${outside.map(([k, p]) => `${k}=${p}`).join(', ')}`,
      )
    }
    return paths
  }

  /**
   * Replace the native dialogs in the main process. Open/save answers come from a queue the steps
   * fill (`dialog` action); an unqueued dialog is answered "cancelled" and recorded, and error /
   * message boxes are recorded instead of shown, so nothing modal can ever block the run.
   */
  async installDialogStubs() {
    await this.app.evaluate(({ dialog }) => {
      const S = { queue: { open: [], save: [] }, calls: [] }
      globalThis.__uic = S
      const optsOf = (a, b) => (b && typeof b === 'object' ? b : a && !a.webContents ? a : {}) ?? {}
      const rec = (kind, o, answer) =>
        S.calls.push({
          kind,
          title: o.title ?? null,
          defaultPath: o.defaultPath ?? null,
          filters: (o.filters ?? []).map((f) => f.name),
          properties: o.properties ?? [],
          answer,
          at: Date.now(),
        })
      const nextOpen = (o) => {
        const n = S.queue.open.shift()
        rec('open', o, n ? (n.cancel ? 'cancel' : n.paths) : 'unqueued')
        return n && !n.cancel ? n.paths : null
      }
      const nextSave = (o) => {
        const n = S.queue.save.shift()
        rec('save', o, n ? (n.cancel ? 'cancel' : n.path) : 'unqueued')
        return n && !n.cancel ? n.path : null
      }
      dialog.showOpenDialog = async (a, b) => {
        const p = nextOpen(optsOf(a, b))
        return p ? { canceled: false, filePaths: p } : { canceled: true, filePaths: [] }
      }
      dialog.showOpenDialogSync = (a, b) => nextOpen(optsOf(a, b)) ?? undefined
      dialog.showSaveDialog = async (a, b) => {
        const p = nextSave(optsOf(a, b))
        return p ? { canceled: false, filePath: p } : { canceled: true, filePath: '' }
      }
      dialog.showSaveDialogSync = (a, b) => nextSave(optsOf(a, b)) ?? undefined
      dialog.showErrorBox = (title, content) =>
        S.calls.push({
          kind: 'errorBox',
          title,
          content: String(content).slice(0, 600),
          at: Date.now(),
        })
      dialog.showMessageBox = async (a, b) => {
        const o = optsOf(a, b)
        S.calls.push({
          kind: 'messageBox',
          title: o.title ?? null,
          content: o.message ?? null,
          at: Date.now(),
        })
        return { response: 0, checkboxChecked: false }
      }
      dialog.showMessageBoxSync = (a, b) => {
        const o = optsOf(a, b)
        S.calls.push({
          kind: 'messageBox',
          title: o.title ?? null,
          content: o.message ?? null,
          at: Date.now(),
        })
        return 0
      }
    })
  }

  async queueDialog(kind, answer) {
    await this.app.evaluate(
      (_electron, { kind, answer }) => {
        globalThis.__uic.queue[kind].push(answer)
      },
      { kind, answer },
    )
  }

  async dialogCalls() {
    return this.app.evaluate(() => globalThis.__uic?.calls ?? [])
  }

  async menuItem(segs) {
    return this.app.evaluate(({ Menu }, segs) => {
      let items = Menu.getApplicationMenu()?.items ?? []
      let item = null
      for (const seg of segs) {
        item =
          items.find((i) => i.label === seg) ?? items.find((i) => i.label?.startsWith(seg)) ?? null
        if (!item)
          return {
            found: false,
            missing: seg,
            available: items.map((i) => i.label).filter(Boolean),
          }
        items = item.submenu?.items ?? []
      }
      return {
        found: true,
        label: item.label,
        enabled: item.enabled,
        visible: item.visible,
        accelerator: item.accelerator ?? null,
        checked: item.checked,
        type: item.type,
        role: item.role ?? null,
        submenu: item.submenu ? item.submenu.items.map((i) => i.label).filter(Boolean) : null,
      }
    }, segs)
  }

  /** Click a native menu item the way a user would: refuses a disabled or missing item. */
  async clickMenu(segs) {
    return this.app.evaluate(({ Menu, BrowserWindow }, segs) => {
      let items = Menu.getApplicationMenu()?.items ?? []
      let item = null
      for (const seg of segs) {
        item =
          items.find((i) => i.label === seg) ?? items.find((i) => i.label?.startsWith(seg)) ?? null
        if (!item)
          return {
            ok: false,
            why: `no menu item '${seg}' (has: ${items
              .map((i) => i.label)
              .filter(Boolean)
              .join(', ')})`,
          }
        if (!item.enabled) return { ok: false, why: `menu item '${item.label}' is disabled` }
        items = item.submenu?.items ?? []
      }
      if (item.submenu) return { ok: false, why: `'${item.label}' is a submenu, not an item` }
      const w = BrowserWindow.getAllWindows()[0]
      item.click(undefined, w, w?.webContents)
      return { ok: true, label: item.label }
    }, segs)
  }

  async windowTitle() {
    return this.app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle() ?? null,
    )
  }

  async close() {
    if (!this.app) return
    const app = this.app
    this.app = null
    this.page = null
    try {
      await Promise.race([
        app.close(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('close timed out')), 15000)),
      ])
    } catch {
      try {
        app.process().kill()
      } catch {}
    }
  }

  async kill() {
    const app = this.app
    this.app = null
    try {
      app?.process().kill()
    } catch {}
  }
}

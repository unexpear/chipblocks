import { readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  session,
} from 'electron'
import { deserializeCircuit } from '../src/renderer/circuit-file.ts'
import { DEFAULT_KEYBINDS, type Keybinds, mergeKeybinds } from '../src/renderer/keybinds.ts'
import { isInternalNavigation } from './navigation.ts'

// Reconstruct __dirname under ESM output (package.json is type: module).
const moduleDir = dirname(fileURLToPath(import.meta.url))

// Dev-only, env-gated: open a Chrome DevTools Protocol endpoint so the REAL window can be driven +
// screenshotted over CDP for verification. No effect in production (the env var is never set there);
// the switches must be appended before the app is ready.
if (process.env.CHIP_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.CHIP_DEBUG_PORT)
  app.commandLine.appendSwitch('remote-allow-origins', '*')
}

// ---------------------------------------------------------------------------
// Save / Load (S19-v3-52). The renderer holds the circuit; the main process
// owns the file dialogs + disk I/O. Open validates HERE (a bad file gets a
// native error box and never reaches the canvas); Save asks the renderer for
// the serialized circuit, then writes it.
// ---------------------------------------------------------------------------

const CIRCUIT_FILTERS = [{ name: 'ChipBlocks Circuit', extensions: ['chipblocks'] }]
const NETLIST_FILTERS = [
  { name: 'Schematic / netlist', extensions: ['cir', 'net', 'sp', 'spice', 'ckt', 'kicad_sch'] },
  { name: 'SPICE netlist', extensions: ['cir', 'net', 'sp', 'spice', 'ckt'] },
  { name: 'KiCad schematic', extensions: ['kicad_sch'] },
  { name: 'All files', extensions: ['*'] },
]

/** The file the window is working on (drives plain Save + the window title). */
let currentCircuitPath: string | null = null
/** Whether the in-flight save request must re-ask for a location (Save As). */
let pendingSaveAs = false

function setCircuitPath(window: BrowserWindow, path: string | null): void {
  currentCircuitPath = path
  window.setTitle(path ? `ChipBlocks — ${basename(path)}` : 'ChipBlocks')
}

async function openCircuit(window: BrowserWindow): Promise<void> {
  const picked = await dialog.showOpenDialog(window, {
    filters: CIRCUIT_FILTERS,
    properties: ['openFile'],
  })
  const path = picked.filePaths[0]
  if (picked.canceled || path === undefined) return
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    dialog.showErrorBox('Could not open circuit', `Reading the file failed: ${String(error)}`)
    return
  }
  const result = deserializeCircuit(text)
  if (!result.ok) {
    dialog.showErrorBox('Could not open circuit', result.reason)
    return
  }
  window.webContents.send('file:opened', text)
  setCircuitPath(window, path)
}

async function importNetlist(window: BrowserWindow): Promise<void> {
  const picked = await dialog.showOpenDialog(window, {
    filters: NETLIST_FILTERS,
    properties: ['openFile'],
  })
  const path = picked.filePaths[0]
  if (picked.canceled || path === undefined) return
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    dialog.showErrorBox('Could not import netlist', `Reading the file failed: ${String(error)}`)
    return
  }
  // The renderer parses the netlist and shows the conversion report. An import is a NEW unsaved
  // circuit (not the opened .chipblocks file), so clear the current path → Save asks for a location.
  window.webContents.send('file:netlist-opened', text)
  setCircuitPath(window, null)
}

function registerSaveHandler(window: BrowserWindow): void {
  // The renderer answers a save request with the serialized circuit text.
  // removeHandler first so re-running createWindow (e.g. a macOS reactivate after all
  // windows have closed) can't throw "Attempted to register a second handler".
  ipcMain.removeHandler('file:save-data')
  ipcMain.handle('file:save-data', async (_event, text: string) => {
    let path = pendingSaveAs ? null : currentCircuitPath
    if (path === null) {
      const picked = await dialog.showSaveDialog(window, {
        filters: CIRCUIT_FILTERS,
        defaultPath: currentCircuitPath ?? 'circuit.chipblocks',
      })
      if (picked.canceled || picked.filePath === undefined) return { ok: false }
      path = picked.filePath
    }
    try {
      await writeFile(path, text, 'utf8')
    } catch (error) {
      dialog.showErrorBox('Could not save circuit', `Writing the file failed: ${String(error)}`)
      return { ok: false }
    }
    setCircuitPath(window, path)
    return { ok: true, path }
  })
}

function registerNetlistExportHandler(window: BrowserWindow): void {
  // The renderer answers an export request with the SPICE netlist text; we pick a file and write it.
  ipcMain.removeHandler('file:save-netlist')
  ipcMain.handle('file:save-netlist', async (_event, text: string) => {
    const picked = await dialog.showSaveDialog(window, {
      filters: NETLIST_FILTERS,
      defaultPath: 'circuit.cir',
    })
    if (picked.canceled || picked.filePath === undefined) return { ok: false }
    try {
      await writeFile(picked.filePath, text, 'utf8')
    } catch (error) {
      dialog.showErrorBox('Could not export netlist', `Writing the file failed: ${String(error)}`)
      return { ok: false }
    }
    return { ok: true, path: picked.filePath }
  })
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts (S19-v3-62). The bindings live in ONE file in the app's
// data folder; the renderer's Shortcuts panel reads and edits them over IPC,
// and the menu accelerators below are built from the same map — change a
// shortcut and the menu re-installs with the new key. A broken or missing
// file degrades to the defaults (mergeKeybinds), never to broken input.
// ---------------------------------------------------------------------------

const keybindsPath = () => join(app.getPath('userData'), 'keybinds.json')
let keybinds: Keybinds = { ...DEFAULT_KEYBINDS }

async function loadKeybinds(): Promise<void> {
  try {
    keybinds = mergeKeybinds(JSON.parse(await readFile(keybindsPath(), 'utf8')))
  } catch {
    keybinds = { ...DEFAULT_KEYBINDS } // no file yet (or unreadable) → defaults
  }
}

function registerKeybindHandlers(window: BrowserWindow): void {
  // removeHandler first — see registerSaveHandler (re-registration must be idempotent).
  ipcMain.removeHandler('keybinds:get')
  ipcMain.removeHandler('keybinds:set')
  ipcMain.handle('keybinds:get', () => keybinds)
  ipcMain.handle('keybinds:set', async (_event, saved: unknown) => {
    keybinds = mergeKeybinds(saved)
    try {
      await writeFile(keybindsPath(), JSON.stringify(keybinds, null, 2), 'utf8')
    } catch (error) {
      dialog.showErrorBox('Could not save shortcuts', `Writing the file failed: ${String(error)}`)
    }
    installMenu(window) // the menu shows the new accelerators immediately
    return keybinds
  })
}

// Custom application menu — replaces Electron's default. Top level: File, Edit,
// View (with the old Window items folded in), Settings, Shortcuts. Every label
// says what the item actually does. Settings drives the renderer over IPC: a
// Light-mode toggle, grid-color presets, and a Custom… item that opens the
// in-canvas color picker. File/Shortcuts accelerators come from the editable
// keybinds map.
function installMenu(window: BrowserWindow): void {
  const sendGrid = (color: string) => window.webContents.send('settings:grid-color', color)
  const buildTemplate = (
    themes: { id: string; label: string }[],
    active: string,
  ): MenuItemConstructorOptions[] => [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Circuit…',
          accelerator: keybinds.openCircuit,
          click: () => void openCircuit(window),
        },
        {
          label: 'Import Netlist / Schematic…',
          click: () => void importNetlist(window),
        },
        { type: 'separator' },
        {
          label: 'Save Circuit',
          accelerator: keybinds.saveCircuit,
          click: () => {
            pendingSaveAs = false
            window.webContents.send('file:save-request')
          },
        },
        {
          label: 'Save Circuit As…',
          accelerator: keybinds.saveCircuitAs,
          click: () => {
            pendingSaveAs = true
            window.webContents.send('file:save-request')
          },
        },
        {
          label: 'Export Netlist…',
          click: () => window.webContents.send('file:export-netlist-request'),
        },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        // Canvas undo/redo (S19-v3-73) — same registerAccelerator:false
        // pattern as the clipboard items below: the shortcut is DISPLAYED but
        // not claimed, so Ctrl+Z/Ctrl+Y reach the page (text fields keep
        // Chromium's native text undo via the renderer's input guard).
        {
          label: 'Undo',
          accelerator: keybinds.undo,
          registerAccelerator: false,
          click: () => window.webContents.send('edit:undo'),
        },
        {
          label: 'Redo',
          accelerator: keybinds.redo,
          registerAccelerator: false,
          click: () => window.webContents.send('edit:redo'),
        },
        { type: 'separator' },
        // Canvas clipboard (S19-v3-69). registerAccelerator:false is the key:
        // the accelerator is DISPLAYED but not claimed, so Ctrl+C/X/V reach the
        // page — the renderer's keybind handler does canvas copy/cut/paste, and
        // text fields keep Chromium's native clipboard behavior (its input
        // guard steps aside). A registered accelerator (or the old role items)
        // would swallow the keys before the canvas ever saw them.
        {
          label: 'Cut Parts',
          accelerator: keybinds.cut,
          registerAccelerator: false,
          click: () => window.webContents.send('edit:cut'),
        },
        {
          label: 'Copy Parts',
          accelerator: keybinds.copy,
          registerAccelerator: false,
          click: () => window.webContents.send('edit:copy'),
        },
        {
          label: 'Paste Parts',
          accelerator: keybinds.paste,
          registerAccelerator: false,
          click: () => window.webContents.send('edit:paste'),
        },
        { type: 'separator' },
        {
          label: 'Select All',
          accelerator: keybinds.selectAll,
          registerAccelerator: false,
          click: () => window.webContents.send('edit:select-all'),
        },
      ],
    },
    {
      // Window's items (Minimize, Close) folded in here, as requested.
      label: 'View',
      submenu: [
        { role: 'reload', label: 'Reload' },
        { role: 'toggleDevTools', label: 'Developer Tools' },
        { type: 'separator' },
        { role: 'zoomIn', label: 'Zoom In' },
        { role: 'zoomOut', label: 'Zoom Out' },
        { role: 'resetZoom', label: 'Actual Size' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Full Screen' },
        { type: 'separator' },
        { role: 'minimize', label: 'Minimize' },
        { role: 'close', label: 'Close Window' },
      ],
    },
    {
      label: 'Settings',
      submenu: [
        {
          label: 'Theme',
          submenu: themes.map((entry) => ({
            label: entry.label,
            type: 'radio' as const,
            checked: entry.id === active,
            click: () => window.webContents.send('settings:theme', entry.id),
          })),
        },
        {
          label: 'Symbol Style',
          submenu: [
            {
              label: 'US / IEEE-315 (default)',
              click: () => window.webContents.send('settings:symbol-style', 'ieee'),
            },
            {
              label: 'IEC (KiCad style)',
              click: () => window.webContents.send('settings:symbol-style', 'iec'),
            },
          ],
        },
        { type: 'separator' },
        {
          label: 'Grid color',
          submenu: [
            { label: 'Slate (default)', click: () => sendGrid('#31363f') },
            { label: 'Gray', click: () => sendGrid('#5a5f6a') },
            { label: 'Blue', click: () => sendGrid('#3b6ea5') },
            { label: 'Green', click: () => sendGrid('#3c7a4a') },
            { label: 'Amber', click: () => sendGrid('#9a7b3f') },
            { label: 'Rose', click: () => sendGrid('#a04a5a') },
            { type: 'separator' },
            {
              label: 'Custom…',
              click: () => window.webContents.send('settings:grid-color-custom'),
            },
          ],
        },
      ],
    },
    {
      label: 'Shortcuts',
      submenu: [
        {
          label: 'View / Change Shortcuts…',
          accelerator: keybinds.shortcutsPanel,
          click: () => window.webContents.send('shortcuts:open'),
        },
      ],
    },
  ]
  const apply = (themes: { id: string; label: string }[], active: string): void =>
    Menu.setApplicationMenu(Menu.buildFromTemplate(buildTemplate(themes, active)))
  // Build now with a placeholder; the renderer registers the real list (from theme.ts) on
  // start-up, so adding a theme there makes it appear here with no change to this file.
  apply([{ id: 'midnight', label: 'Midnight' }], 'midnight')
  ipcMain.on(
    'settings:register-themes',
    (_event, payload: { themes: { id: string; label: string }[]; active: string }) =>
      apply(payload.themes, payload.active),
  )
}

// ---------------------------------------------------------------------------
// Security hardening (defense-in-depth). contextIsolation + nodeIntegration are
// already safe (Electron 42 defaults + the contextBridge preload); these close
// the rest of the project's intended baseline (TOOLING-RESEARCH-2026-05.md):
// lock down navigation + window.open, and apply a Content-Security-Policy.
//
// The CSP is delivered two ways because Electron CANNOT set a response header on
// a file:// document — and the packaged app loads its renderer with loadFile().
// So the shipped build carries its (strict) policy as a <meta> tag injected at
// build time (electron.vite.config.ts). Here we cover the OTHER load path, the
// dev server, whose http origin DOES accept a header — loosened only enough for
// Vite's inline HMR preamble + websocket, while keeping the same inline-style
// allowance the shipped policy relies on.
const DEV_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Vite's dev preamble is inline + HMR uses eval
  "style-src 'self' 'unsafe-inline'", // the renderer is inline-styled throughout
  "img-src 'self' data:",
  "connect-src 'self' ws: wss:", // Vite HMR websocket
].join('; ')

function installDevContentSecurityPolicy(): void {
  // Dev only: the packaged file:// app gets its CSP from the build-injected
  // <meta> tag instead (a header can't reach a file:// document).
  if (process.env.ELECTRON_RENDERER_URL === undefined) return
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [DEV_CONTENT_SECURITY_POLICY],
      },
    })
  })
}

function hardenNavigation(window: BrowserWindow, devUrl: string | undefined): void {
  // Nothing in the app opens a second window or an external URL — the menu
  // drives everything over IPC. Deny window.open outright, and block any
  // navigation away from our own renderer so a stray or injected link can't
  // move the window to a remote origin that could then reach the `chipblocks`
  // IPC bridge. isInternalNavigation compares ORIGINS (not string prefixes, which
  // a userinfo @ trick or a UNC file path would slip past — see navigation.ts).
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  // Guard BOTH events with the same origin check: will-navigate fires for a link or
  // location change, but a SERVER-side redirect (a 302) fires will-redirect INSTEAD —
  // so a navigation to an allowed origin that then redirects out would slip past a
  // will-navigate-only guard. preventDefault on will-redirect cancels the navigation.
  window.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!isInternalNavigation(navigationUrl, devUrl)) event.preventDefault()
  })
  window.webContents.on('will-redirect', (event, navigationUrl) => {
    if (!isInternalNavigation(navigationUrl, devUrl)) event.preventDefault()
  })
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'ChipBlocks',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: join(moduleDir, '../preload/preload.cjs'),
      // Sandboxed renderer (OS-level process isolation). The preload is built as
      // CommonJS (preload.cjs — see electron.vite.config.ts) because a sandboxed
      // renderer loads its preload through a CommonJS-only shim; an ESM (.mjs)
      // preload silently fails to run, leaving window.chipblocks undefined. Keep
      // these in lockstep: preload output 'cjs' ⇄ this .cjs path ⇄ sandbox: true.
      sandbox: true,
      // Set explicitly, not left to Electron's secure defaults, so a future default
      // change or a stray edit can't silently weaken the renderer's isolation.
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // electron-vite sets ELECTRON_RENDERER_URL in dev (the Vite dev server);
  // in a build, load the bundled renderer index.html.
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl !== undefined) {
    window.loadURL(devUrl)
  } else {
    window.loadFile(join(moduleDir, '../renderer/index.html'))
  }

  hardenNavigation(window, devUrl)
  installMenu(window)
  registerSaveHandler(window)
  registerNetlistExportHandler(window)
  registerKeybindHandlers(window)
}

app.whenReady().then(async () => {
  await loadKeybinds()
  installDevContentSecurityPolicy()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

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
} from 'electron'
import { deserializeCircuit } from '../src/renderer/circuit-file.ts'
import { DEFAULT_KEYBINDS, type Keybinds, mergeKeybinds } from '../src/renderer/keybinds.ts'

// Reconstruct __dirname under ESM output (package.json is type: module).
const moduleDir = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Save / Load (S19-v3-52). The renderer holds the circuit; the main process
// owns the file dialogs + disk I/O. Open validates HERE (a bad file gets a
// native error box and never reaches the canvas); Save asks the renderer for
// the serialized circuit, then writes it.
// ---------------------------------------------------------------------------

const CIRCUIT_FILTERS = [{ name: 'ChipBlocks Circuit', extensions: ['chipblocks'] }]

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

function registerSaveHandler(window: BrowserWindow): void {
  // The renderer answers a save request with the serialized circuit text.
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
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Circuit…',
          accelerator: keybinds.openCircuit,
          click: () => void openCircuit(window),
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
        { type: 'separator' },
        { role: 'quit', label: 'Exit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
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
        { role: 'selectAll', label: 'Select All' },
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
          label: 'Light mode',
          type: 'checkbox',
          checked: false,
          click: (item) =>
            window.webContents.send('settings:theme', item.checked ? 'light' : 'dark'),
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
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'ChipBlocks',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: join(moduleDir, '../preload/preload.mjs'),
      sandbox: false,
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

  installMenu(window)
  registerSaveHandler(window)
  registerKeybindHandlers(window)
}

app.whenReady().then(async () => {
  await loadKeybinds()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

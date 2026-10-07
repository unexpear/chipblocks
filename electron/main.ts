import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
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
import { DEFAULT_KEYBINDS, type Keybinds, mergeKeybinds } from '../src/renderer/keybinds.ts'
import { type CanvasLoadingItemId, canvasLoadingItems } from './canvas-menu.ts'
import { planChipDescriptionRequest } from './chip-description.ts'
import { type CircuitOpenDecision, decideCircuitOpen } from './circuit-open.ts'
import { isMissingFile } from './missing-file.ts'
import { isInternalNavigation } from './navigation.ts'

// Reconstruct __dirname under ESM output (package.json is type: module).
const moduleDir = dirname(fileURLToPath(import.meta.url))

// Dev-only, env-gated: open a Chrome DevTools Protocol endpoint so the REAL window can be driven +
// screenshotted over CDP for verification. No effect in production (the env var is never set there);
// the switches must be appended before the app is ready.
if (process.env.CHIP_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.CHIP_DEBUG_PORT)
  app.commandLine.appendSwitch('remote-allow-origins', '*')
  // Keep the compositor producing frames while the window is covered or minimized. Windows' native
  // occlusion tracking otherwise marks the page hidden and stops requestAnimationFrame entirely
  // (even with backgroundThrottling off), which freezes React Flow's node measuring — new nodes
  // stay visibility:hidden and CDP-driven verification clicks fall through to the pane.
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
}

// ---------------------------------------------------------------------------
// Save / Load (S19-v3-52). The renderer holds the circuit; the main process
// owns the file dialogs + disk I/O. Open validates HERE (a bad file gets a
// native error box and never reaches the canvas); Save asks the renderer for
// the serialized circuit, then writes it.
// ---------------------------------------------------------------------------

const CIRCUIT_FILTERS = [{ name: 'ChipBlocks Circuit', extensions: ['chipblocks'] }]
const NETLIST_FILTERS = [
  {
    name: 'Schematic / netlist',
    extensions: ['cir', 'net', 'sp', 'spice', 'ckt', 'kicad_sch', 'v', 'sv', 'verilog'],
  },
  { name: 'SPICE netlist', extensions: ['cir', 'net', 'sp', 'spice', 'ckt'] },
  { name: 'KiCad schematic', extensions: ['kicad_sch'] },
  { name: 'Verilog', extensions: ['v', 'sv', 'verilog'] },
  { name: 'All files', extensions: ['*'] },
]
const VERILOG_FILTERS = [
  { name: 'Verilog', extensions: ['v'] },
  { name: 'All files', extensions: ['*'] },
]
const GDS_FILTERS = [
  { name: 'GDSII layout', extensions: ['gds'] },
  { name: 'All files', extensions: ['*'] },
]
const OASIS_FILTERS = [
  { name: 'OASIS layout', extensions: ['oas'] },
  { name: 'All files', extensions: ['*'] },
]
const LEF_FILTERS = [
  { name: 'LEF library', extensions: ['lef'] },
  { name: 'All files', extensions: ['*'] },
]
const DEF_FILTERS = [
  { name: 'DEF placed design', extensions: ['def'] },
  { name: 'All files', extensions: ['*'] },
]
const LIB_FILTERS = [
  { name: 'Liberty timing library', extensions: ['lib'] },
  { name: 'All files', extensions: ['*'] },
]
// A programmed FPGA chip file, and the open-source description of the chip it was programmed into. Only the
// extensions the renderer can actually read are offered by name; All files is there so anything else can be
// tried and get the renderer's specific refusal rather than being hidden behind a filter.
const BITSTREAM_FILTERS = [
  { name: 'FPGA chip file', extensions: ['bin', 'asc', 'bit', 'fs'] },
  { name: 'All files', extensions: ['*'] },
]
const CHIP_DESCRIPTION_FILTERS = [
  { name: 'FPGA chip description', extensions: ['txt', 'db', 'json'] },
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

/**
 * Whether a project's circuit canvas is on screen — the renderer says so whenever the user changes tab.
 *
 * The three File items below hand a file to that canvas. Without one there is nothing listening: measured in
 * the running app, picking "Read an FPGA Chip File…" from the My Projects screen opened the file chooser, read
 * the file, and then showed the user nothing whatsoever. Worse, with two projects open it was delivered to
 * whichever tab happened to have subscribed last — so a design could be read into a tab the user was not
 * looking at, over the top of the work already in it. The renderer now only listens in the tab on screen, and
 * these items go grey when there is no such tab, so the door is shut at both ends.
 */
let circuitCanvasOpen = false

function setCircuitCanvasOpen(open: boolean): void {
  circuitCanvasOpen = open
  const menu = Menu.getApplicationMenu()
  if (menu === null) return
  for (const { id, enabled } of canvasLoadingItems(open)) {
    const item = menu.getMenuItemById(id)
    if (item !== null) item.enabled = enabled
  }
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
  // Both failures — not a circuit file, and too big to draw — are refused HERE, before the canvas hears
  // about it and before the window is retitled for this file. The retitling is why the size check
  // belongs in the main process and not only in the renderer: `setCircuitPath` makes this the file Save
  // writes to, so a file refused AFTER the path was set would be quietly overwritten by whatever small
  // circuit was already on the canvas the next time the user pressed Ctrl+S. A refusal must not cost the
  // user the file it refused.
  const decision = decideCircuitOpen(text)
  if (!decision.ok) {
    dialog.showErrorBox('Could not open circuit', decision.reason)
    return
  }
  window.webContents.send('file:opened', text)
  setCircuitPath(window, path)
}

async function importNetlist(window: BrowserWindow): Promise<void> {
  // Several files at once, because a real Verilog design IS several files — a CPU core in one, the system
  // that instantiates it in another. Picking only the system file made the core look like a module nobody
  // defined, and the whole design was refused for a definition sitting in the folder beside it.
  const picked = await dialog.showOpenDialog(window, {
    filters: NETLIST_FILTERS,
    properties: ['openFile', 'multiSelections'],
  })
  if (picked.canceled || picked.filePaths.length === 0) return
  const files = await readAllAsText(picked.filePaths)
  if (files === null) {
    dialog.showErrorBox(
      'Could not import netlist',
      'One of the files you chose could not be read. Nothing has been changed.',
    )
    return
  }
  // The renderer parses the netlist and shows the conversion report. An import is a NEW unsaved
  // circuit (not the opened .chipblocks file), so clear the current path → Save asks for a location.
  window.webContents.send('file:netlist-opened', files)
  setCircuitPath(window, null)
}

async function openBitstream(window: BrowserWindow): Promise<void> {
  const picked = await dialog.showOpenDialog(window, {
    filters: BITSTREAM_FILTERS,
    properties: ['openFile'],
  })
  const path = picked.filePaths[0]
  if (picked.canceled || path === undefined) return
  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch (error) {
    dialog.showErrorBox('Could not open the chip file', `Reading the file failed: ${String(error)}`)
    return
  }
  // Bytes, not text: a bitstream is binary and utf8 decoding would corrupt it. The renderer decides what the
  // file IS — main deliberately does not validate here, because the renderer's refusal names the chip and says
  // which description file to go and find, which a native error box cannot.
  window.webContents.send('file:bitstream-opened', {
    name: basename(path),
    bytes: new Uint8Array(bytes),
  })
  // A decoded chip file is a NEW unsaved circuit, not the currently-open .chipblocks file — same as an import.
  setCircuitPath(window, null)
}

/** Which of the three canvas-loading File items runs what. Keyed by the id the menu carries, so an item and
 *  the thing it does cannot drift apart. */
const openCanvasLoad: Record<CanvasLoadingItemId, (window: BrowserWindow) => Promise<void>> = {
  'open-circuit': openCircuit,
  'import-netlist': importNetlist,
  'read-fpga-chip-file': openBitstream,
}

// Which chip-description files the user has already pointed at, per chip, so they are asked once and not on
// every open. Beside the personal parts + templates libraries, in the same ~/.chipblocks folder.
const chipDescriptionStorePath = () =>
  join(app.getPath('home'), '.chipblocks', 'fpga-chip-descriptions.json')

async function readChipDescriptionStore(): Promise<Record<string, string[]>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(chipDescriptionStorePath(), 'utf8'))
    if (parsed === null || typeof parsed !== 'object') return {}
    const store: Record<string, string[]> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>))
      if (Array.isArray(value) && value.every((p) => typeof p === 'string'))
        store[key] = value as string[]
    return store
  } catch {
    return {} // never pointed at any yet, or the file is unreadable → ask
  }
}

/** Read every path as text, or null if ANY of them cannot be read — a half-read chip description is useless. */
async function readAllAsText(
  paths: readonly string[],
): Promise<{ name: string; text: string }[] | null> {
  if (paths.length === 0) return null
  const files: { name: string; text: string }[] = []
  for (const path of paths) {
    try {
      files.push({ name: basename(path), text: await readFile(path, 'utf8') })
    } catch {
      return null
    }
  }
  return files
}

function registerChipDescriptionHandler(window: BrowserWindow): void {
  // The renderer knows which chip the file is for and what to say about it; this just remembers where the
  // description files are and hands their text back. `ask: false` is the silent first try on open — it answers
  // from what was remembered and never pops a dialog, so opening a chip file twice only ever asks once.
  ipcMain.removeHandler('fpga:chip-description')
  ipcMain.handle(
    'fpga:chip-description',
    async (
      _event,
      request: { family: string; device: string; ask: boolean },
    ): Promise<{ ok: boolean; files?: { name: string; text: string }[] }> => {
      const store = await readChipDescriptionStore()
      const key = `${request.family}/${request.device}`
      const plan = planChipDescriptionRequest(request.ask, store[key] ?? [])
      if (!plan.ask) {
        const remembered = await readAllAsText(plan.use)
        return remembered === null ? { ok: false } : { ok: true, files: remembered }
      }

      const picked = await dialog.showOpenDialog(window, {
        title: `Choose the description of the ${request.device} chip`,
        filters: CHIP_DESCRIPTION_FILTERS,
        properties: ['openFile', 'multiSelections'],
        // start where they looked last time, which is usually the right folder even when the pick was wrong
        ...(plan.startIn === null ? {} : { defaultPath: plan.startIn }),
      })
      if (picked.canceled || picked.filePaths.length === 0) return { ok: false }
      const files = await readAllAsText(picked.filePaths)
      if (files === null) {
        dialog.showErrorBox(
          'Could not read the chip description',
          'One of the files you chose could not be read. Nothing has been changed.',
        )
        return { ok: false }
      }
      store[key] = [...picked.filePaths]
      const path = chipDescriptionStorePath()
      try {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, JSON.stringify(store, null, 2), 'utf8')
      } catch {
        // Remembering is a convenience; failing to remember must not fail the open the user asked for.
      }
      return { ok: true, files }
    },
  )
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

function registerVerilogExportHandler(window: BrowserWindow): void {
  // The renderer answers an export request with the structural Verilog text; we pick a file and write it.
  ipcMain.removeHandler('file:save-verilog')
  ipcMain.handle('file:save-verilog', async (_event, text: string) => {
    const picked = await dialog.showSaveDialog(window, {
      filters: VERILOG_FILTERS,
      defaultPath: 'design.v',
    })
    if (picked.canceled || picked.filePath === undefined) return { ok: false }
    try {
      await writeFile(picked.filePath, text, 'utf8')
    } catch (error) {
      dialog.showErrorBox('Could not export Verilog', `Writing the file failed: ${String(error)}`)
      return { ok: false }
    }
    return { ok: true, path: picked.filePath }
  })
}

function registerFabZipExportHandler(window: BrowserWindow): void {
  // The renderer sends the finished manufacturing ZIP's bytes (built by the deterministic engine —
  // Gerbers, drill, BOM, placement, validation report); we pick a file and write them verbatim.
  ipcMain.removeHandler('file:save-fab-zip')
  ipcMain.handle('file:save-fab-zip', async (_event, data: Uint8Array) => {
    const picked = await dialog.showSaveDialog(window, {
      filters: [{ name: 'Manufacturing ZIP', extensions: ['zip'] }],
      defaultPath: 'manufacturing.zip',
    })
    if (picked.canceled || picked.filePath === undefined) return { ok: false }
    try {
      await writeFile(picked.filePath, Buffer.from(data))
    } catch (error) {
      dialog.showErrorBox(
        'Could not export manufacturing ZIP',
        `Writing the file failed: ${String(error)}`,
      )
      return { ok: false }
    }
    return { ok: true, path: picked.filePath }
  })
}

function registerGdsExportHandler(window: BrowserWindow): void {
  // The renderer sends the placed chip floorplan's GDSII bytes (built by the deterministic gds.ts writer);
  // we pick a file and write them verbatim. Binary, like the fab-ZIP path — never re-encoded.
  ipcMain.removeHandler('file:save-gds')
  ipcMain.handle('file:save-gds', async (_event, data: Uint8Array) => {
    const picked = await dialog.showSaveDialog(window, {
      filters: GDS_FILTERS,
      defaultPath: 'layout.gds',
    })
    if (picked.canceled || picked.filePath === undefined) return { ok: false }
    try {
      await writeFile(picked.filePath, Buffer.from(data))
    } catch (error) {
      dialog.showErrorBox('Could not export GDSII', `Writing the file failed: ${String(error)}`)
      return { ok: false }
    }
    return { ok: true, path: picked.filePath }
  })
}

function registerOasisExportHandler(window: BrowserWindow): void {
  // The renderer sends the placed floorplan's OASIS bytes (oasis.ts); we pick a file and write them
  // verbatim — binary, like the GDS path.
  ipcMain.removeHandler('file:save-oasis')
  ipcMain.handle('file:save-oasis', async (_event, data: Uint8Array) => {
    const picked = await dialog.showSaveDialog(window, {
      filters: OASIS_FILTERS,
      defaultPath: 'layout.oas',
    })
    if (picked.canceled || picked.filePath === undefined) return { ok: false }
    try {
      await writeFile(picked.filePath, Buffer.from(data))
    } catch (error) {
      dialog.showErrorBox('Could not export OASIS', `Writing the file failed: ${String(error)}`)
      return { ok: false }
    }
    return { ok: true, path: picked.filePath }
  })
}

function registerLefDefExportHandlers(window: BrowserWindow): void {
  // The renderer builds the LEF library / DEF placed-design TEXT (lef.ts / def.ts, for OpenROAD); we pick a
  // file and write it. Text, like the Verilog export.
  const textExport = (
    channel: string,
    filters: typeof LEF_FILTERS,
    defaultPath: string,
    label: string,
  ) => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (_event, text: string) => {
      const picked = await dialog.showSaveDialog(window, { filters, defaultPath })
      if (picked.canceled || picked.filePath === undefined) return { ok: false }
      try {
        await writeFile(picked.filePath, text, 'utf8')
      } catch (error) {
        dialog.showErrorBox(
          `Could not export ${label}`,
          `Writing the file failed: ${String(error)}`,
        )
        return { ok: false }
      }
      return { ok: true, path: picked.filePath }
    })
  }
  textExport('file:save-lef', LEF_FILTERS, 'design.lef', 'LEF')
  textExport('file:save-def', DEF_FILTERS, 'design.def', 'DEF')
  textExport('file:save-lib', LIB_FILTERS, 'design.lib', 'Liberty')
}

/** Read + validate a .chipblocks file at `path` (shared by the open-into-a-new-tab handlers below,
 *  which RETURN content to the renderer instead of pushing it onto the one canvas like the menu does).
 *  Same decision as the menu's, from the same function — a project too big to draw is refused before a
 *  tab is opened for it, and its `kind` tells the launcher to keep the entry rather than prune it. */
async function readCircuitAt(path: string): Promise<CircuitOpenDecision> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    return { ok: false, kind: 'unreadable', reason: `Reading the file failed: ${String(error)}` }
  }
  return decideCircuitOpen(text)
}

/**
 * Auto-discover saved .chipblocks projects for the "My Projects" list — the user shouldn't have to
 * remember where they saved. Walks the usual save spots (Documents / Desktop / Downloads deep, home
 * shallow), bounded hard (skip system/build dirs, a depth + total-dir cap) so it stays fast and never
 * wanders the whole disk. Returns each file's path + name + modified time.
 */
async function scanForCircuits(): Promise<{ path: string; name: string; savedAt: number }[]> {
  const found: { path: string; name: string; savedAt: number }[] = []
  const seen = new Set<string>()
  const skip = new Set([
    'node_modules',
    'AppData',
    'Library',
    'System Volume Information',
    '$RECYCLE.BIN',
    '.git',
    '.cache',
    'out',
    'dist',
  ])
  let dirs = 0
  const MAX_DIRS = 4000
  async function walk(dir: string, depth: number, maxDepth: number): Promise<void> {
    if (depth > maxDepth || dirs > MAX_DIRS || seen.has(dir)) return
    seen.add(dir)
    dirs++
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => null)
    if (entries === null) return
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || skip.has(e.name)) continue
        await walk(full, depth + 1, maxDepth)
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.chipblocks')) {
        try {
          const st = await stat(full)
          found.push({ path: full, name: basename(e.name, '.chipblocks'), savedAt: st.mtimeMs })
        } catch {
          // unreadable file — skip it
        }
      }
    }
  }
  const dir = (id: Parameters<typeof app.getPath>[0]) => {
    try {
      return app.getPath(id)
    } catch {
      return ''
    }
  }
  // the likely save spots, deep; then home shallow (the `seen` set stops re-walking the deep roots)
  for (const root of [dir('documents'), dir('desktop'), dir('downloads')]) {
    if (root) await walk(root, 0, 6)
  }
  const home = dir('home')
  if (home) await walk(home, 0, 2)
  return found
}

function registerCircuitOpenHandlers(window: BrowserWindow): void {
  // Auto-find saved projects across the usual folders (the My Projects list merges these in).
  ipcMain.removeHandler('circuit:scan')
  ipcMain.handle('circuit:scan', () => scanForCircuits())
  // Open a .chipblocks file into a NEW TAB: show the dialog, validate, and RETURN the text + path so
  // the renderer can spin up a fresh tab (the menu's file:opened, by contrast, replaces the canvas).
  ipcMain.removeHandler('circuit:open-dialog')
  ipcMain.handle('circuit:open-dialog', async () => {
    const picked = await dialog.showOpenDialog(window, {
      filters: CIRCUIT_FILTERS,
      properties: ['openFile'],
    })
    const path = picked.filePaths[0]
    if (picked.canceled || path === undefined) return { ok: false }
    const read = await readCircuitAt(path)
    if (!read.ok) {
      dialog.showErrorBox('Could not open project', read.reason)
      return { ok: false }
    }
    return { ok: true, path, text: read.text }
  })
  // A file this window opened but whose design never landed on the canvas — the user pressed Stop
  // while it was still being drawn, and the canvas went back to what it was before.
  //
  // `openCircuit` sets the path at the moment it hands the text over, because that is what makes the
  // window's Save write to the file the user opened. If the draw is then stopped, the canvas is the
  // OLD design and the path is the NEW file, and a plain Ctrl+S would write one over the other with
  // no dialog. So the renderer says the draw was abandoned and the window forgets the file, exactly
  // as if it had never been opened. This project has already destroyed a project file by writing a
  // canvas over it; a Stop must not be able to do the same.
  ipcMain.removeHandler('circuit:forget-path')
  ipcMain.handle('circuit:forget-path', () => {
    setCircuitPath(window, null)
    return { ok: true }
  })
  // Reopen a recent project by its known path (from the My Projects list). A missing/moved file
  // returns ok:false with a reason so the launcher can prune the stale entry.
  ipcMain.removeHandler('circuit:read')
  ipcMain.handle('circuit:read', async (_event, path: string) => {
    const read = await readCircuitAt(path)
    return read.ok
      ? { ok: true, path, text: read.text }
      : { ok: false, kind: read.kind, reason: read.reason }
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

// The personal parts library (user-made parts, slice 3b): the parts you author live in
// ~/.chipblocks/user-parts.json so they follow you into every project. `~` is the OS home dir (the
// four-origin `user_local` location). Main does raw text I/O; the renderer (user-library.ts) owns the
// format + validation. Read returns the text (or null when there's no library yet).
const userLibraryPath = () => join(app.getPath('home'), '.chipblocks', 'user-parts.json')

function registerUserLibraryHandlers(): void {
  ipcMain.removeHandler('user-library:read')
  ipcMain.removeHandler('user-library:write')
  ipcMain.handle('user-library:read', async (): Promise<string | null> => {
    try {
      return await readFile(userLibraryPath(), 'utf8')
    } catch (error) {
      // Missing file → start empty. Any other failure must reject: treating it as empty makes the
      // next authoring save overwrite a library this process could not read.
      if (isMissingFile(error)) return null
      throw error
    }
  })
  ipcMain.handle(
    'user-library:write',
    async (_event, text: string): Promise<{ ok: boolean; path?: string }> => {
      const path = userLibraryPath()
      try {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, text, 'utf8')
        return { ok: true, path }
      } catch (error) {
        dialog.showErrorBox('Could not save your parts library', `Writing failed: ${String(error)}`)
        return { ok: false }
      }
    },
  )
}

// The personal TEMPLATES library — the same file-I/O shape as the parts library, at
// ~/.chipblocks/user-templates.json. The renderer (user-templates.ts) owns the format.
const userTemplatesPath = () => join(app.getPath('home'), '.chipblocks', 'user-templates.json')

function registerUserTemplatesHandlers(): void {
  ipcMain.removeHandler('user-templates:read')
  ipcMain.removeHandler('user-templates:write')
  ipcMain.handle('user-templates:read', async (): Promise<string | null> => {
    try {
      return await readFile(userTemplatesPath(), 'utf8')
    } catch (error) {
      if (isMissingFile(error)) return null
      throw error
    }
  })
  ipcMain.handle(
    'user-templates:write',
    async (_event, text: string): Promise<{ ok: boolean; path?: string }> => {
      const path = userTemplatesPath()
      try {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, text, 'utf8')
        return { ok: true, path }
      } catch (error) {
        dialog.showErrorBox(
          'Could not save your templates library',
          `Writing failed: ${String(error)}`,
        )
        return { ok: false }
      }
    },
  )
}

// Plugin & Content Manager: community packs under ~/.chipblocks/libraries/<id>/pack.json
// plus index.json. Main does raw I/O + the local-file picker; the renderer owns format,
// license gate, enable/disable, and refuses remote installs.
const contentLibrariesDir = () => join(app.getPath('home'), '.chipblocks', 'libraries')
const contentIndexPath = () => join(contentLibrariesDir(), 'index.json')
const contentPackPath = (id: string) => join(contentLibrariesDir(), id, 'pack.json')

const PACK_ID_RE = /^[a-z][a-z0-9_]*$/

function registerContentManagerHandlers(window: BrowserWindow): void {
  ipcMain.removeHandler('content:index-read')
  ipcMain.removeHandler('content:index-write')
  ipcMain.removeHandler('content:pack-read')
  ipcMain.removeHandler('content:pack-write')
  ipcMain.removeHandler('content:pack-remove')
  ipcMain.removeHandler('content:pick-local')

  ipcMain.handle('content:index-read', async (): Promise<string | null> => {
    try {
      return await readFile(contentIndexPath(), 'utf8')
    } catch (error) {
      // A missing index is a first install. A locked or unreadable index must not look missing,
      // or the next install would write a new index over it.
      if (isMissingFile(error)) return null
      throw error
    }
  })

  ipcMain.handle(
    'content:index-write',
    async (_event, text: string): Promise<{ ok: boolean; path?: string }> => {
      const path = contentIndexPath()
      try {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, text, 'utf8')
        return { ok: true, path }
      } catch (error) {
        dialog.showErrorBox(
          'Could not save content-manager index',
          `Writing failed: ${String(error)}`,
        )
        return { ok: false }
      }
    },
  )

  ipcMain.handle('content:pack-read', async (_event, id: string): Promise<string | null> => {
    if (typeof id !== 'string' || !PACK_ID_RE.test(id)) return null
    try {
      return await readFile(contentPackPath(id), 'utf8')
    } catch {
      return null
    }
  })

  ipcMain.handle(
    'content:pack-write',
    async (
      _event,
      id: string,
      text: string,
    ): Promise<{ ok: boolean; path?: string; reason?: string }> => {
      if (typeof id !== 'string' || !PACK_ID_RE.test(id)) {
        return { ok: false, reason: 'Invalid pack id.' }
      }
      if (typeof text !== 'string') return { ok: false, reason: 'Pack text must be a string.' }
      const path = contentPackPath(id)
      try {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, text, 'utf8')
        return { ok: true, path }
      } catch (error) {
        return { ok: false, reason: `Writing pack failed: ${String(error)}` }
      }
    },
  )

  ipcMain.handle(
    'content:pack-remove',
    async (_event, id: string): Promise<{ ok: boolean; reason?: string }> => {
      if (typeof id !== 'string' || !PACK_ID_RE.test(id)) {
        return { ok: false, reason: 'Invalid pack id.' }
      }
      const dir = join(contentLibrariesDir(), id)
      // Only delete under ~/.chipblocks/libraries/<id> - never a path the renderer invents.
      try {
        await rm(dir, { recursive: true, force: true })
        return { ok: true }
      } catch (error) {
        return { ok: false, reason: `Removing pack failed: ${String(error)}` }
      }
    },
  )

  ipcMain.handle(
    'content:pick-local',
    async (): Promise<{ ok: boolean; text?: string; reason?: string }> => {
      const picked = await dialog.showOpenDialog(window, {
        title: 'Install ChipBlocks content pack',
        filters: [
          { name: 'ChipBlocks content pack', extensions: ['json'] },
          { name: 'All files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      })
      if (picked.canceled || picked.filePaths[0] === undefined) {
        return { ok: false, reason: 'Install cancelled.' }
      }
      try {
        const text = await readFile(picked.filePaths[0], 'utf8')
        return { ok: true, text }
      } catch (error) {
        return { ok: false, reason: `Could not read pack file: ${String(error)}` }
      }
    },
  )
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
        ...canvasLoadingItems(circuitCanvasOpen).map((item) => ({
          ...item,
          ...(item.id === 'open-circuit' ? { accelerator: keybinds.openCircuit } : {}),
          click: () => void openCanvasLoad[item.id](window),
        })),
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
          label: 'Save as Template…',
          click: () => window.webContents.send('file:save-template-request'),
        },
        {
          label: 'Export Netlist…',
          click: () => window.webContents.send('file:export-netlist-request'),
        },
        {
          label: 'Export Verilog…',
          click: () => window.webContents.send('file:export-verilog-request'),
        },
        {
          label: 'Export GDS…',
          click: () => window.webContents.send('file:export-gds-request'),
        },
        {
          label: 'Export OASIS…',
          click: () => window.webContents.send('file:export-oasis-request'),
        },
        {
          label: 'Export LEF…',
          click: () => window.webContents.send('file:export-lef-request'),
        },
        {
          label: 'Export DEF…',
          click: () => window.webContents.send('file:export-def-request'),
        },
        {
          label: 'Export Liberty…',
          click: () => window.webContents.send('file:export-lib-request'),
        },
        {
          // Report only. The renderer reuses fpga:chip-description and does not ask main to save a .bin.
          label: 'Compile to iCE40…',
          click: () => window.webContents.send('file:compile-ice40-request'),
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
      label: 'Tools',
      submenu: [
        {
          label: 'Plugin & Content Manager.',
          click: () => window.webContents.send('content-manager:open'),
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
  ipcMain.removeAllListeners('window:circuit-canvas-open')
  ipcMain.on('window:circuit-canvas-open', (_event, open: unknown) =>
    setCircuitCanvasOpen(open === true),
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
    // The ChipBlocks mark — the window frame + (with setAppUserModelId below) the Windows taskbar button.
    // resources/ lives beside package.json, which is app.getAppPath() in dev; a packaged build would ship it
    // via extraResources (no packager configured yet).
    icon: join(app.getAppPath(), 'resources', 'icon.ico'),
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
      // Dev-only, with the CDP endpoint: keep rendering + ResizeObserver alive while the window is
      // minimized/occluded, so CDP verification can drive it. A hidden throttled window never delivers
      // ResizeObserver ticks → React Flow never measures new nodes → they stay visibility:hidden and
      // unclickable. Production keeps Electron's default throttling (the env var is never set there).
      backgroundThrottling: !process.env.CHIP_DEBUG_PORT,
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
  registerVerilogExportHandler(window)
  registerFabZipExportHandler(window)
  registerGdsExportHandler(window)
  registerOasisExportHandler(window)
  registerLefDefExportHandlers(window)
  registerCircuitOpenHandlers(window)
  registerChipDescriptionHandler(window)
  registerKeybindHandlers(window)
  registerUserLibraryHandlers()
  registerUserTemplatesHandlers()
  registerContentManagerHandlers(window)
}

app.whenReady().then(async () => {
  // Give Windows an explicit app id so the taskbar button + Task Manager identify this as ChipBlocks
  // (its own icon + name) rather than grouping it under the generic Electron process. No-op off Windows.
  app.setAppUserModelId('com.chipblocks.app')
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

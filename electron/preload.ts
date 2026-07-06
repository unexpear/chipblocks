// Preload script. Bridges the native Settings menu (electron/main.ts) to the
// renderer: the menu sends appearance events over IPC, the renderer subscribes.
// removeAllListeners-before-on keeps exactly one handler per channel, so a React
// re-subscribe (or StrictMode double-mount) can't stack duplicate listeners.
import { contextBridge, ipcRenderer } from 'electron'

function subscribe<T>(channel: string, callback: (value: T) => void): void {
  ipcRenderer.removeAllListeners(channel)
  ipcRenderer.on(channel, (_event, value: T) => callback(value))
}

contextBridge.exposeInMainWorld('chipblocks', {
  onTheme: (callback: (theme: string) => void) => subscribe('settings:theme', callback),
  // Symbol-style switcher: the native Settings ▸ Symbol Style menu sends 'ieee' / 'iec'.
  onSymbolStyle: (callback: (style: string) => void) =>
    subscribe('settings:symbol-style', callback),
  // Theme switcher: the renderer registers the theme list (from theme.ts) so the native
  // Settings ▸ Theme menu builds itself, and the menu sends back the chosen theme id.
  registerThemes: (themes: { id: string; label: string }[], active: string) =>
    ipcRenderer.send('settings:register-themes', { themes, active }),
  onGridColor: (callback: (color: string) => void) => subscribe('settings:grid-color', callback),
  onGridColorCustom: (callback: () => void) => subscribe('settings:grid-color-custom', callback),
  // Save / Load (S19-v3-52): the File menu asks for the circuit, the renderer
  // answers with the serialized text; an opened file's (main-validated) text
  // arrives ready to load.
  onSaveRequest: (callback: () => void) => subscribe('file:save-request', callback),
  saveCircuitData: (text: string): Promise<{ ok: boolean; path?: string }> =>
    ipcRenderer.invoke('file:save-data', text),
  onCircuitOpened: (callback: (text: string) => void) => subscribe('file:opened', callback),
  // Open a .chipblocks project into a NEW TAB (tabbed shell): a request/response round-trip that
  // returns the file's text + path, so the launcher can spin up a tab instead of replacing a canvas.
  openCircuitDialog: (): Promise<{ ok: boolean; path?: string; text?: string }> =>
    ipcRenderer.invoke('circuit:open-dialog'),
  // Reopen a recent project by its known path (the My Projects list); ok:false + reason if it moved.
  readCircuitFile: (
    path: string,
  ): Promise<{ ok: boolean; path?: string; text?: string; reason?: string }> =>
    ipcRenderer.invoke('circuit:read', path),
  // Auto-discover saved .chipblocks projects in the usual folders (so My Projects finds them itself).
  scanProjects: (): Promise<{ path: string; name: string; savedAt: number }[]> =>
    ipcRenderer.invoke('circuit:scan'),
  // Import Netlist (rung 1b): a netlist file's raw text arrives; the renderer parses it.
  onNetlistOpened: (callback: (text: string) => void) => subscribe('file:netlist-opened', callback),
  // Export Netlist (rung 2): the File menu asks; the renderer answers with the SPICE text.
  onExportNetlistRequest: (callback: () => void) =>
    subscribe('file:export-netlist-request', callback),
  saveNetlistData: (text: string): Promise<{ ok: boolean; path?: string }> =>
    ipcRenderer.invoke('file:save-netlist', text),
  // Manufacturing ZIP (board road): the renderer builds the engine-owned archive bytes;
  // the main process picks a destination and writes them verbatim.
  saveFabZip: (data: Uint8Array): Promise<{ ok: boolean; path?: string }> =>
    ipcRenderer.invoke('file:save-fab-zip', data),
  // Personal parts library (user-made parts, slice 3b): the parts you author persist to
  // ~/.chipblocks/user-parts.json so they follow you across projects. Main does the raw file I/O;
  // the renderer owns the format. Read returns the file text (or null when there's no library yet).
  readUserLibrary: (): Promise<string | null> => ipcRenderer.invoke('user-library:read'),
  writeUserLibrary: (text: string): Promise<{ ok: boolean; path?: string }> =>
    ipcRenderer.invoke('user-library:write', text),
  // Shortcuts (S19-v3-62): the renderer panel reads + edits the keybinds the
  // main process persists; the Shortcuts menu opens the panel over IPC.
  getKeybinds: (): Promise<Record<string, string>> => ipcRenderer.invoke('keybinds:get'),
  setKeybinds: (binds: Record<string, string>): Promise<Record<string, string>> =>
    ipcRenderer.invoke('keybinds:set', binds),
  onShortcutsOpen: (callback: () => void) => subscribe('shortcuts:open', callback),
  // Clipboard (S19-v3-69): the Edit menu's Cut/Copy/Paste Parts items — the
  // renderer owns the clipboard, the menu just asks.
  onEditCopy: (callback: () => void) => subscribe('edit:copy', callback),
  onEditCut: (callback: () => void) => subscribe('edit:cut', callback),
  onEditPaste: (callback: () => void) => subscribe('edit:paste', callback),
  // Undo / redo (S19-v3-73): same shape — the renderer owns the history.
  onEditUndo: (callback: () => void) => subscribe('edit:undo', callback),
  onEditRedo: (callback: () => void) => subscribe('edit:redo', callback),
  onEditSelectAll: (callback: () => void) => subscribe('edit:select-all', callback),
})

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
  // Import Netlist (rung 1b): a netlist file's raw text arrives; the renderer parses it.
  onNetlistOpened: (callback: (text: string) => void) => subscribe('file:netlist-opened', callback),
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

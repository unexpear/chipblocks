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
  // Export Verilog: the File menu asks; the renderer answers with the structural Verilog text.
  onExportVerilogRequest: (callback: () => void) =>
    subscribe('file:export-verilog-request', callback),
  saveVerilogData: (text: string): Promise<{ ok: boolean; path?: string }> =>
    ipcRenderer.invoke('file:save-verilog', text),
  // Manufacturing ZIP (board road): the renderer builds the engine-owned archive bytes;
  // the main process picks a destination and writes them verbatim.
  saveFabZip: (data: Uint8Array): Promise<{ ok: boolean; path?: string }> =>
    ipcRenderer.invoke('file:save-fab-zip', data),
  // Export GDS (chip-physical chapter): the File menu asks; the renderer builds the placed
  // floorplan's GDSII bytes (gds.ts) and hands them over; main picks a file and writes them verbatim.
  onExportGdsRequest: (callback: () => void) => subscribe('file:export-gds-request', callback),
  saveGdsData: (data: Uint8Array): Promise<{ ok: boolean; path?: string }> =>
    ipcRenderer.invoke('file:save-gds', data),
  // Export OASIS (compact binary layout): the renderer builds the bytes; main writes them verbatim.
  onExportOasisRequest: (callback: () => void) => subscribe('file:export-oasis-request', callback),
  saveOasisData: (data: Uint8Array): Promise<{ ok: boolean; path?: string }> =>
    ipcRenderer.invoke('file:save-oasis', data),
  // Export LEF/DEF (OpenROAD interop): the File menu asks; the renderer builds the text and hands it over.
  onExportLefRequest: (callback: () => void) => subscribe('file:export-lef-request', callback),
  saveLefData: (text: string): Promise<{ ok: boolean; path?: string }> =>
    ipcRenderer.invoke('file:save-lef', text),
  onExportDefRequest: (callback: () => void) => subscribe('file:export-def-request', callback),
  saveDefData: (text: string): Promise<{ ok: boolean; path?: string }> =>
    ipcRenderer.invoke('file:save-def', text),
  // Export Liberty (the .lib timing library that completes the OpenROAD signoff round-trip).
  onExportLibRequest: (callback: () => void) => subscribe('file:export-lib-request', callback),
  saveLibData: (text: string): Promise<{ ok: boolean; path?: string }> =>
    ipcRenderer.invoke('file:save-lib', text),
  // Personal parts library (user-made parts, slice 3b): the parts you author persist to
  // ~/.chipblocks/user-parts.json so they follow you across projects. Main does the raw file I/O;
  // the renderer owns the format. Read returns the file text (or null when there's no library yet).
  readUserLibrary: (): Promise<string | null> => ipcRenderer.invoke('user-library:read'),
  writeUserLibrary: (text: string): Promise<{ ok: boolean; path?: string }> =>
    ipcRenderer.invoke('user-library:write', text),
  // Personal TEMPLATES library (user-made starter circuits): the circuits you "Save as Template" persist
  // to ~/.chipblocks/user-templates.json so they follow you across projects, right beside your parts.
  readUserTemplates: (): Promise<string | null> => ipcRenderer.invoke('user-templates:read'),
  writeUserTemplates: (text: string): Promise<{ ok: boolean; path?: string }> =>
    ipcRenderer.invoke('user-templates:write', text),
  onSaveTemplateRequest: (callback: () => void) =>
    subscribe('file:save-template-request', callback),
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

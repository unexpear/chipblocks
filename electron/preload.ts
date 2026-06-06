// Preload script. Minimal for the Sprint 18 MVP — no privileged bridge yet.
// When the canvas needs main-process services (file dialogs, exporting the
// manufacturing ZIP, etc.), expose them here via contextBridge.
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('chipblocks', {
  // Sprint 18 MVP: the renderer bundles the catalog fixtures directly (Vite
  // import), so no IPC is needed yet. Placeholder surface for later.
  version: '0.0.0',
})

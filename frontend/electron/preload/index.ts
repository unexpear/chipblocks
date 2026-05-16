// ChipBlocks v2 preload script.
//
// Minimal. No IPC bridges exposed yet — the new direction's IPC surface
// will be defined as Sprint 2+ work needs it. Deliberately narrow per
// the project's security rule: never expose a generic ipcRenderer
// bridge; expose only the specific functions the renderer actually
// needs.
//
// See RESET-PLAN.md for the broader context.

import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('chipblocks', {
  version: 'v2-ground-up-restart',
})

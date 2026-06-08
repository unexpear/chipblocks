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
  version: '0.0.0',
  onTheme: (callback: (theme: 'light' | 'dark') => void) => subscribe('settings:theme', callback),
  onGridColor: (callback: (color: string) => void) => subscribe('settings:grid-color', callback),
  onGridColorCustom: (callback: () => void) => subscribe('settings:grid-color-custom', callback),
})

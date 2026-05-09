import { ipcRenderer, contextBridge } from 'electron'

// Note: we deliberately do NOT expose a generic `window.ipcRenderer`
// bridge. The boilerplate from the electron-vite-react template did,
// which would let any compromised renderer (XSS in any dep) call any
// ipcMain.handle channel — including ai:save-key with an attacker-
// supplied value. The two narrow bridges below (chipblocks, ai) are
// the only IPC surface the renderer actually uses; keep it that way.

// ChipBlocks synth API. The renderer calls window.chipblocks.synth(graph)
// and the main process spawns wsl.exe + python3 to run the simulation.
// cancel() kills any in-flight synth.
contextBridge.exposeInMainWorld('chipblocks', {
  synth: (graph: unknown) => ipcRenderer.invoke('synth:run', graph),
  cancel: () => ipcRenderer.invoke('synth:cancel') as Promise<boolean>,
  build: (graph: unknown, target: 'icestick' | 'tinyfpga-bx' | 'tt') =>
    ipcRenderer.invoke('build:run', { graph, target }) as Promise<{
      ok: boolean
      zipData?: ArrayBuffer
      error?: string
      errorType?: 'backend_deps_missing' | 'wsl_missing' | 'oss_cad_suite_missing'
    }>,
  cancelBuild: () => ipcRenderer.invoke('build:cancel') as Promise<boolean>,
})

// AI consultant API. The API key is stored encrypted in the main process
// (Electron safeStorage) and never crosses the IPC boundary into the
// renderer. Streaming responses are pushed back via ai:chunk events.
contextBridge.exposeInMainWorld('ai', {
  saveKey: (key: string) => ipcRenderer.invoke('ai:save-key', key) as Promise<boolean>,
  hasKey: () => ipcRenderer.invoke('ai:has-key') as Promise<boolean>,
  clearKey: () => ipcRenderer.invoke('ai:clear-key') as Promise<boolean>,
  chat: (req: { id: string; model?: string; messages: unknown[]; system: unknown; tools?: unknown[] }) =>
    ipcRenderer.invoke('ai:chat', req) as Promise<boolean>,
  cancel: (id: string) => ipcRenderer.invoke('ai:cancel', id) as Promise<boolean>,
  onChunk: (cb: (data: { id: string; text: string }) => void) => {
    const h = (_e: unknown, d: { id: string; text: string }) => cb(d)
    ipcRenderer.on('ai:chunk', h)
    return () => ipcRenderer.removeListener('ai:chunk', h)
  },
  onDone: (cb: (data: { id: string; usage: { input: number; output: number } }) => void) => {
    const h = (_e: unknown, d: { id: string; usage: { input: number; output: number } }) => cb(d)
    ipcRenderer.on('ai:done', h)
    return () => ipcRenderer.removeListener('ai:done', h)
  },
  onError: (cb: (data: { id: string; message: string }) => void) => {
    const h = (_e: unknown, d: { id: string; message: string }) => cb(d)
    ipcRenderer.on('ai:error', h)
    return () => ipcRenderer.removeListener('ai:error', h)
  },
})

// --------- Preload scripts loading ---------
function domReady(condition: DocumentReadyState[] = ['complete', 'interactive']) {
  return new Promise(resolve => {
    if (condition.includes(document.readyState)) {
      resolve(true)
    } else {
      document.addEventListener('readystatechange', () => {
        if (condition.includes(document.readyState)) {
          resolve(true)
        }
      })
    }
  })
}

const safeDOM = {
  append(parent: HTMLElement, child: HTMLElement) {
    if (!Array.from(parent.children).find(e => e === child)) {
      return parent.appendChild(child)
    }
  },
  remove(parent: HTMLElement, child: HTMLElement) {
    if (Array.from(parent.children).find(e => e === child)) {
      return parent.removeChild(child)
    }
  },
}

/**
 * https://tobiasahlin.com/spinkit
 * https://connoratherton.com/loaders
 * https://projects.lukehaas.me/css-loaders
 * https://matejkustec.github.io/SpinThatShit
 */
function useLoading() {
  const className = `loaders-css__square-spin`
  const styleContent = `
@keyframes square-spin {
  25% { transform: perspective(100px) rotateX(180deg) rotateY(0); }
  50% { transform: perspective(100px) rotateX(180deg) rotateY(180deg); }
  75% { transform: perspective(100px) rotateX(0) rotateY(180deg); }
  100% { transform: perspective(100px) rotateX(0) rotateY(0); }
}
.${className} > div {
  animation-fill-mode: both;
  width: 50px;
  height: 50px;
  background: #fff;
  animation: square-spin 3s 0s cubic-bezier(0.09, 0.57, 0.49, 0.9) infinite;
}
.app-loading-wrap {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #282c34;
  z-index: 9;
}
    `
  const oStyle = document.createElement('style')
  const oDiv = document.createElement('div')

  oStyle.id = 'app-loading-style'
  oStyle.innerHTML = styleContent
  oDiv.className = 'app-loading-wrap'
  oDiv.innerHTML = `<div class="${className}"><div></div></div>`

  return {
    appendLoading() {
      safeDOM.append(document.head, oStyle)
      safeDOM.append(document.body, oDiv)
    },
    removeLoading() {
      safeDOM.remove(document.head, oStyle)
      safeDOM.remove(document.body, oDiv)
    },
  }
}

// ----------------------------------------------------------------------

const { appendLoading, removeLoading } = useLoading()
domReady().then(appendLoading)

window.onmessage = (ev) => {
  ev.data.payload === 'removeLoading' && removeLoading()
}

setTimeout(removeLoading, 4999)
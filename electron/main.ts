import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron'

// Reconstruct __dirname under ESM output (package.json is type: module).
const moduleDir = dirname(fileURLToPath(import.meta.url))

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
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

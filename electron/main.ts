import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'

// Reconstruct __dirname under ESM output (package.json is type: module).
const moduleDir = dirname(fileURLToPath(import.meta.url))

// Custom application menu — replaces Electron's default. Top level: File, Edit,
// View (with the old Window items folded in), Settings. Every label says what the
// item actually does. Settings drives the renderer over IPC: a Light-mode toggle,
// grid-color presets, and a Custom… item that opens the in-canvas color picker.
function installMenu(window: BrowserWindow): void {
  const sendGrid = (color: string) => window.webContents.send('settings:grid-color', color)
  const template: MenuItemConstructorOptions[] = [
    { label: 'File', submenu: [{ role: 'quit', label: 'Exit' }] },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
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
            { label: 'Custom…', click: () => window.webContents.send('settings:grid-color-custom') },
          ],
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

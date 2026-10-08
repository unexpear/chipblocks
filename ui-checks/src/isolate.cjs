// Preloaded into the Electron main process by `--target electron` (electron -r isolate.cjs .), before
// electron/main.ts runs. Points every folder the app reads or writes (home → ~/.chipblocks, userData →
// keybinds.json + localStorage, Documents/Desktop/Downloads → the My Projects scan) at a throwaway
// sandbox, so a run never touches the real user's files. Test-only: nothing in the app changes, and
// it refuses to start without a sandbox rather than fall back to the real folders.
const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')

const root = process.env.CHIPBLOCKS_UIC_SANDBOX
if (!root || !path.isAbsolute(root) || !fs.existsSync(root)) {
  throw new Error(
    'ui-checks isolate.cjs: CHIPBLOCKS_UIC_SANDBOX is not an existing absolute folder',
  )
}
const home = path.join(root, 'home')
const dirs = {
  home,
  appData: path.join(root, 'appData'),
  userData: path.join(root, 'userData'),
  documents: path.join(home, 'Documents'),
  desktop: path.join(home, 'Desktop'),
  downloads: path.join(home, 'Downloads'),
}
for (const [name, dir] of Object.entries(dirs)) {
  fs.mkdirSync(dir, { recursive: true })
  app.setPath(name, dir) // userData must be set before 'ready'; the -r preload runs before main.ts
}

// Before/after guard for the REAL ~/.chipblocks of the person running the checks. Read-only: it lists
// names, sizes and mtimes and never opens, writes or deletes anything. Electron workflows run against a
// sandbox home; this proves the real one was left exactly as it was.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** This process's own ~/.chipblocks (the runner's real home, never the sandbox handed to Electron). */
export const realChipblocksRoot = () => path.join(os.homedir(), '.chipblocks')

/** Every file and folder under `root`, sorted, with size + mtime. ['absent'] when it does not exist. */
export function chipblocksSnapshot(root = realChipblocksRoot()) {
  if (!fs.existsSync(root)) return { root, lines: ['absent'] }
  const lines = []
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name)
      const st = fs.statSync(full)
      const rel = path.relative(root, full).split(path.sep).join('/')
      if (st.isDirectory()) {
        lines.push(`${rel}/`)
        walk(full)
      } else lines.push(`${rel}  ${st.size}  ${Math.round(st.mtimeMs)}`)
    }
  }
  walk(root)
  return { root, lines }
}

/** What changed between two snapshots: lines that went away and lines that appeared. */
export function snapshotDiff(before, after) {
  const now = new Set(after.lines)
  const was = new Set(before.lines)
  return {
    gone: before.lines.filter((l) => !now.has(l)),
    added: after.lines.filter((l) => !was.has(l)),
  }
}

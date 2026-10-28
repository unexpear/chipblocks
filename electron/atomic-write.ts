/**
 * Replace a file in one step: write a temp file beside it, flush it to disk, then rename it over
 * the target and flush the folder entry. A crash, a power cut, a full disk, or a failed write
 * leaves the old file whole (or no file), never a truncated or empty one, and the temp file is
 * removed when the write fails.
 *
 * Why both flushes: without the file fsync, a power cut after the rename can leave the new name
 * pointing at data that never reached the disk (an empty or zero-filled file on ext4/NTFS). The
 * folder fsync makes the rename itself durable on POSIX. Windows cannot open a folder for flushing
 * (EPERM/EISDIR); NTFS journals the rename, so that refusal is expected and ignored.
 */
import { randomBytes } from 'node:crypto'
import { open, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

export type AtomicWriteFs = {
  /** Write `text` to `path` and flush it to disk (fsync) before resolving. */
  writeFile: (path: string, text: string) => Promise<void>
  rename: (from: string, to: string) => Promise<void>
  rm: (path: string) => Promise<void>
  sleep: (ms: number) => Promise<void>
  /** Flush a folder entry (fsync on the folder). Rejects where the platform cannot. */
  syncDir: (dir: string) => Promise<void>
}

/** The part of a FileHandle the synced write needs, named so a test can stand in for it. */
export type SyncHandle = {
  writeFile: (text: string, encoding: 'utf8') => Promise<void>
  sync: () => Promise<void>
  close: () => Promise<void>
}
export type OpenForSync = (path: string, flags: 'w' | 'r') => Promise<SyncHandle>

const openReal: OpenForSync = (path, flags) => open(path, flags)

/** Write, fsync, close. The handle is closed even when the write or the fsync fails. */
export async function writeFileSynced(
  path: string,
  text: string,
  openImpl: OpenForSync = openReal,
): Promise<void> {
  const handle = await openImpl(path, 'w')
  try {
    await handle.writeFile(text, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export async function syncDirectory(dir: string, openImpl: OpenForSync = openReal): Promise<void> {
  const handle = await openImpl(dir, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

const realFs: AtomicWriteFs = {
  writeFile: (path, text) => writeFileSynced(path, text),
  rename: (from, to) => rename(from, to),
  rm: (path) => rm(path, { force: true }),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  syncDir: (dir) => syncDirectory(dir),
}

// Windows refuses a rename for a moment while a virus scanner or indexer has the target open.
const RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const RENAME_ATTEMPTS = 5

export function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code = (error as { code: unknown }).code
  return typeof code === 'string' ? code : undefined
}

export async function writeFileAtomic(
  path: string,
  text: string,
  fs: Partial<AtomicWriteFs> = {},
): Promise<void> {
  const io: AtomicWriteFs = { ...realFs, ...fs }
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await io.writeFile(tmp, text)
    for (let attempt = 1; ; attempt++) {
      try {
        await io.rename(tmp, path)
        break
      } catch (error) {
        const code = errorCode(error)
        if (attempt >= RENAME_ATTEMPTS || code === undefined || !RETRY_CODES.has(code)) {
          throw error
        }
        await io.sleep(25 * attempt)
      }
    }
  } catch (error) {
    await io.rm(tmp).catch(() => undefined)
    throw error
  }
  // The new file is in place, so nothing below may report the write as failed (callers would roll
  // back a write that happened). Windows refuses to open a folder (EPERM); that is expected there.
  // Any other folder-flush error only means the rename may not survive a power cut.
  await io.syncDir(dirname(path)).catch(() => undefined)
}

/**
 * Replace a file in one step: write a temp file beside it, then rename it over the target.
 * A crash, a full disk, or a failed write leaves the old file whole (or no file), never a
 * truncated one, and the temp file is removed when the write fails.
 */
import { randomBytes } from 'node:crypto'
import { rename, rm, writeFile } from 'node:fs/promises'

export type AtomicWriteFs = {
  writeFile: (path: string, text: string) => Promise<void>
  rename: (from: string, to: string) => Promise<void>
  rm: (path: string) => Promise<void>
  sleep: (ms: number) => Promise<void>
}

const realFs: AtomicWriteFs = {
  writeFile: (path, text) => writeFile(path, text, 'utf8'),
  rename: (from, to) => rename(from, to),
  rm: (path) => rm(path, { force: true }),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

// Windows refuses a rename for a moment while a virus scanner or indexer has the target open.
const RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const RENAME_ATTEMPTS = 5

function errorCode(error: unknown): string | undefined {
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
        return
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
}

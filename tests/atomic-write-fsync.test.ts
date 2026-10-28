/**
 * Item 4: atomic writes flush the temp file (fsync) before the rename, then flush the folder where
 * the platform allows it. Windows refuses to open a folder; that must not fail the write.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import {
  type OpenForSync,
  syncDirectory,
  writeFileAtomic,
  writeFileSynced,
} from '../electron/atomic-write.ts'

const dir = mkdtempSync(join(tmpdir(), 'chipblocks-fsync-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function recordingOpen(log: string[], fail: { sync?: string; open?: string } = {}): OpenForSync {
  return async (path, flags) => {
    log.push(`open ${flags} ${path}`)
    if (fail.open !== undefined) throw Object.assign(new Error(fail.open), { code: fail.open })
    return {
      writeFile: async (text) => {
        log.push(`write ${text}`)
      },
      sync: async () => {
        log.push('sync')
        if (fail.sync !== undefined) throw Object.assign(new Error(fail.sync), { code: fail.sync })
      },
      close: async () => {
        log.push('close')
      },
    }
  }
}

describe('writeFileSynced', () => {
  test('writes, fsyncs, then closes', async () => {
    const log: string[] = []
    await writeFileSynced('f.tmp', 'DATA', recordingOpen(log))
    expect(log).toEqual(['open w f.tmp', 'write DATA', 'sync', 'close'])
  })

  test('a failed fsync rejects and still closes the handle', async () => {
    const log: string[] = []
    await expect(
      writeFileSynced('f.tmp', 'DATA', recordingOpen(log, { sync: 'EIO' })),
    ).rejects.toThrow('EIO')
    expect(log.at(-1)).toBe('close')
  })

  test('syncDirectory opens the folder read-only and fsyncs it', async () => {
    const log: string[] = []
    await syncDirectory('/some/dir', recordingOpen(log))
    expect(log).toEqual(['open r /some/dir', 'sync', 'close'])
  })
})

describe('writeFileAtomic ordering', () => {
  test('temp file write+fsync, then rename, then folder fsync', async () => {
    const log: string[] = []
    const target = join(dir, 'ordered.json')
    await writeFileAtomic(target, 'X', {
      writeFile: async (path, text) => {
        log.push(`synced-write ${path.endsWith('.tmp')} ${text}`)
      },
      rename: async (_from, to) => {
        log.push(`rename -> ${to === target}`)
      },
      syncDir: async (d) => {
        log.push(`syncDir ${d === dirname(target)}`)
      },
    })
    expect(log).toEqual(['synced-write true X', 'rename -> true', 'syncDir true'])
  })

  test('a folder that cannot be flushed (Windows EPERM) does not fail the write', async () => {
    const target = join(dir, 'win.json')
    await writeFileAtomic(target, 'WIN', {
      syncDir: async () => {
        throw Object.assign(new Error('EPERM: operation not permitted, open'), { code: 'EPERM' })
      },
    })
    expect(readFileSync(target, 'utf8')).toBe('WIN')
  })

  test('a failed fsync of the temp file leaves the old file whole and no temp file', async () => {
    const target = join(dir, 'kept.json')
    writeFileSync(target, 'OLD')
    await expect(
      writeFileAtomic(target, 'NEW', {
        writeFile: async (path, text) => {
          writeFileSync(path, text)
          throw Object.assign(new Error('EIO: i/o error, fsync'), { code: 'EIO' })
        },
      }),
    ).rejects.toThrow('EIO')
    expect(readFileSync(target, 'utf8')).toBe('OLD')
    expect(readdirSync(dir).filter((n) => n.startsWith('kept.json.'))).toEqual([])
  })

  test('on the real file system the write lands and the folder fsync is attempted', async () => {
    const target = join(dir, 'real.json')
    let dirSyncs = 0
    await writeFileAtomic(target, 'REAL', {
      syncDir: async (d) => {
        dirSyncs++
        await syncDirectory(d).catch(() => undefined) // EPERM on Windows, fine on POSIX
      },
    })
    expect(readFileSync(target, 'utf8')).toBe('REAL')
    expect(dirSyncs).toBe(1)
    // And with the default file system as shipped (real fsync of the file, real folder attempt).
    await writeFileAtomic(target, 'REAL2')
    expect(readFileSync(target, 'utf8')).toBe('REAL2')
    expect(readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })
})

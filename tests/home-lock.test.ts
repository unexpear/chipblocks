/**
 * Item 1: two ChipBlocks windows are two processes (one window per process; tabs share one
 * renderer, already queued), both writing ~/.chipblocks. The content lock lets one of them change
 * packs or pins at a time, and recovers a lock left by a crashed or hung process.
 */
import { spawn } from 'node:child_process'
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { acquireFileLock, ContentLock, processIsAlive } from '../electron/home-lock.ts'

const dir = mkdtempSync(join(tmpdir(), 'chipblocks-lock-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
let n = 0
const lockPath = () => join(dir, `content-${++n}.lock`)

// A pid nobody is using: a child that has already exited.
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  const pid = child.pid as number
  await new Promise((r) => child.on('exit', r))
  return pid
}

const owner = (pid: number, host = hostname()) =>
  JSON.stringify({ pid, host, token: 'old', acquiredAt: Date.now() })

describe('cross-process read-modify-write under the lock', () => {
  test('two processes each add 40 to one counter file: no update is lost', async () => {
    const lock = join(dir, 'race.lock')
    const counter = join(dir, 'counter.json')
    writeFileSync(counter, '0')
    const child = join(dir, 'child.mjs')
    const moduleUrl = pathToFileURL(resolve('electron/home-lock.ts')).href
    writeFileSync(
      child,
      `import { readFileSync, writeFileSync } from 'node:fs'
import { acquireFileLock } from ${JSON.stringify(moduleUrl)}
const [lock, counter, times] = process.argv.slice(2)
for (let i = 0; i < Number(times); i++) {
  const got = await acquireFileLock(lock, { timeoutMs: 30000, retryMs: 1 })
  if (!got.ok) { console.error(got.reason); process.exit(2) }
  const value = Number(readFileSync(counter, 'utf8'))
  await new Promise((r) => setTimeout(r, Math.random() * 3))
  writeFileSync(counter, String(value + 1))
  await got.lock.release()
}
`,
    )
    const run = () =>
      new Promise<number>((resolveExit, reject) => {
        const p = spawn(
          process.execPath,
          ['--experimental-strip-types', '--no-warnings', child, lock, counter, '40'],
          { stdio: ['ignore', 'ignore', 'pipe'] },
        )
        let err = ''
        p.stderr.on('data', (d) => {
          err += String(d)
        })
        p.on('error', reject)
        p.on('exit', (code) =>
          code === 0 ? resolveExit(0) : reject(new Error(`exit ${code}: ${err}`)),
        )
      })
    await Promise.all([run(), run()])
    expect(Number(readFileSync(counter, 'utf8'))).toBe(80)
    expect(readdirSync(dir).filter((f) => f === 'race.lock')).toEqual([])
  }, 60_000)
})

describe('acquireFileLock', () => {
  test('a lock held by a live process on this host is waited for, then refused with a reason', async () => {
    const path = lockPath()
    writeFileSync(path, owner(process.ppid > 0 ? process.ppid : process.pid))
    const got = await acquireFileLock(path, { timeoutMs: 150, retryMs: 10, pid: 1 })
    expect(got.ok).toBe(false)
    if (!got.ok) {
      expect(got.reason).toMatch(
        /^Another ChipBlocks window \(process \d+\) is changing installed packs or publisher pins right now\. Nothing was written\. Try again in a moment\.$/,
      )
    }
    expect(readFileSync(path, 'utf8')).toContain('"token":"old"') // left alone
  })

  test('a lock whose owner process is gone is taken over', async () => {
    const path = lockPath()
    writeFileSync(path, owner(await deadPid()))
    const got = await acquireFileLock(path, { timeoutMs: 1000 })
    expect(got.ok).toBe(true)
    if (got.ok) {
      expect(JSON.parse(readFileSync(path, 'utf8')).pid).toBe(process.pid)
      await got.lock.release()
    }
    expect(() => statSync(path)).toThrow()
  })

  test('a lock not refreshed for staleMs is taken over even if its pid is alive (hung, or pid reused)', async () => {
    const path = lockPath()
    writeFileSync(path, owner(process.ppid))
    const old = new Date(Date.now() - 120_000)
    utimesSync(path, old, old)
    const got = await acquireFileLock(path, { timeoutMs: 1000, staleMs: 30_000, pid: 1 })
    expect(got.ok).toBe(true)
    if (got.ok) await got.lock.release()
  })

  test('a lock from another host is judged by age only', async () => {
    const path = lockPath()
    writeFileSync(path, owner(await deadPid(), 'some-other-host'))
    const fresh = await acquireFileLock(path, { timeoutMs: 100, retryMs: 10 })
    expect(fresh.ok).toBe(false)
    if (!fresh.ok) expect(fresh.reason).toContain('on some-other-host')
  })

  test('a leftover lock with our own pid is stale (the in-process queue never asks while holding)', async () => {
    const path = lockPath()
    writeFileSync(path, owner(process.pid))
    const got = await acquireFileLock(path, { timeoutMs: 500 })
    expect(got.ok).toBe(true)
    if (got.ok) await got.lock.release()
  })

  test('release removes only our own lock, never one that was taken over', async () => {
    const path = lockPath()
    const got = await acquireFileLock(path)
    expect(got.ok).toBe(true)
    if (!got.ok) return
    writeFileSync(path, owner(process.ppid)) // someone else's now
    await got.lock.release()
    expect(readFileSync(path, 'utf8')).toContain('"token":"old"')
  })

  test('processIsAlive', async () => {
    expect(processIsAlive(process.pid)).toBe(true)
    expect(processIsAlive(await deadPid())).toBe(false)
    expect(processIsAlive(0)).toBe(false)
  })
})

describe('ContentLock (one process)', () => {
  test('one holder at a time; the next waits for the release', async () => {
    const lock = new ContentLock(lockPath)
    const path = join(dir, 'queue.lock')
    const q = new ContentLock(() => path)
    const order: string[] = []
    const a = await q.acquire()
    expect(a.ok).toBe(true)
    const bPending = q.acquire().then((b) => {
      order.push('b')
      return b
    })
    await new Promise((r) => setTimeout(r, 30))
    order.push('a-release')
    if (a.ok) await q.release(a.token)
    const b = await bPending
    expect(order).toEqual(['a-release', 'b'])
    if (b.ok) await q.release(b.token)
    expect(lock.isHeld).toBe(false)
  })

  test('a holder that never releases loses the lock after its lease', async () => {
    const path = join(dir, 'lease.lock')
    const q = new ContentLock(() => path, { leaseMs: 50 })
    const a = await q.acquire()
    expect(a.ok).toBe(true)
    const b = await q.acquire() // waits for the lease to run out
    expect(b.ok).toBe(true)
    if (a.ok) expect(await q.release(a.token)).toBe(false) // too late, it is not a's any more
    if (b.ok) await q.release(b.token)
  })

  test('guard runs a write inside a held change as is, and takes the lock for a lone write', async () => {
    const path = join(dir, 'guard.lock')
    const q = new ContentLock(() => path)
    const lone = await q.guard(async () => {
      expect(q.isHeld).toBe(true)
      return 1
    })
    expect(lone).toEqual({ ok: true, value: 1 })
    expect(q.isHeld).toBe(false)
    const held = await q.acquire()
    const inner = await q.guard(async () => 2)
    expect(inner).toEqual({ ok: true, value: 2 })
    if (held.ok) await q.release(held.token)
  })

  test('guard refuses when another process holds the lock', async () => {
    const path = join(dir, 'busy.lock')
    writeFileSync(path, owner(process.ppid))
    const q = new ContentLock(() => path, { timeoutMs: 100, retryMs: 10, pid: 1 })
    let ran = false
    const result = await q.guard(async () => {
      ran = true
    })
    expect(result.ok).toBe(false)
    expect(ran).toBe(false)
  })
})

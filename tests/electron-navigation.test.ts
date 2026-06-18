/**
 * Tests for the will-navigate guard (electron/main.ts → hardenNavigation). The
 * decision is a pure function so the security-critical part is unit-pinned: the
 * naive navigationUrl.startsWith(...) it replaced had real bypasses (the userinfo
 * @ trick, a UNC file path), and these lock them shut.
 */

import { describe, expect, test } from 'vitest'
import { isInternalNavigation } from '../electron/navigation.ts'

const DEV = 'http://localhost:5173'

describe('isInternalNavigation — dev (same-origin only)', () => {
  test('same-origin navigations are internal', () => {
    expect(isInternalNavigation('http://localhost:5173/', DEV)).toBe(true)
    expect(isInternalNavigation('http://localhost:5173/index.html', DEV)).toBe(true)
    expect(isInternalNavigation('http://localhost:5173/@vite/client', DEV)).toBe(true)
  })

  test('the userinfo @ trick is NOT internal — its real origin is evil.com', () => {
    // startsWith(DEV) would have waved both of these through.
    expect(isInternalNavigation('http://localhost:5173@evil.com', DEV)).toBe(false)
    expect(isInternalNavigation('http://localhost:5173@evil.com/payload', DEV)).toBe(false)
  })

  test('a longer port, a different host, or a different scheme is not internal', () => {
    expect(isInternalNavigation('http://localhost:51730/', DEV)).toBe(false) // prefix, not origin
    expect(isInternalNavigation('http://evil.com/', DEV)).toBe(false)
    expect(isInternalNavigation('https://localhost:5173/', DEV)).toBe(false) // scheme differs
  })
})

describe('isInternalNavigation — packaged (local file only)', () => {
  test('a local file URL (no host) is internal', () => {
    expect(isInternalNavigation('file:///C:/app/renderer/index.html', undefined)).toBe(true)
    expect(isInternalNavigation('file:///home/u/app/index.html', undefined)).toBe(true)
  })

  test('a UNC path (file://host/share) is NOT internal — Windows resolves it over SMB', () => {
    // startsWith('file://') would have waved this remote path through.
    expect(isInternalNavigation('file://evil.com/share/payload.html', undefined)).toBe(false)
  })

  test('a non-file scheme is not internal when packaged', () => {
    expect(isInternalNavigation('http://evil.com/', undefined)).toBe(false)
  })
})

describe('isInternalNavigation — degenerate inputs', () => {
  test('an unparseable or empty navigation is blocked', () => {
    expect(isInternalNavigation('not a url', DEV)).toBe(false)
    expect(isInternalNavigation('', undefined)).toBe(false)
  })

  test('a malformed devUrl matches nothing (blocks rather than throws)', () => {
    expect(isInternalNavigation('http://localhost:5173/', 'not a url')).toBe(false)
  })
})

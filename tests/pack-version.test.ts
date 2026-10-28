/**
 * Item 3: SemVer 2.0.0 precedence for the downgrade guard, the update list, and the rollback floor.
 */
import { describe, expect, test } from 'vitest'
import { emptyContentIndex, installLocalPackVerified } from '../src/renderer/content-manager.ts'
import { CONTENT_PACK_FORMAT, CONTENT_PACK_VERSION } from '../src/renderer/content-pack.ts'
import { isNewerRegistryVersion, registryUpdates } from '../src/renderer/content-registry.ts'
import {
  comparePackVersions,
  isPreRelease,
  parsePackVersion,
} from '../src/renderer/pack-version.ts'
import { downgradeRefusal } from '../src/renderer/trust-seal-view.ts'

describe('comparePackVersions (SemVer 2.0.0 precedence)', () => {
  test('the spec example order holds pairwise and sorts', () => {
    const order = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
      '1.0.1',
      '1.1.0',
      '2.0.0',
    ]
    for (let i = 0; i < order.length; i++) {
      for (let j = 0; j < order.length; j++) {
        const expected = i < j ? -1 : i > j ? 1 : 0
        expect(comparePackVersions(order[i] as string, order[j] as string)).toBe(expected)
      }
    }
    const shuffled = [...order].reverse()
    shuffled.sort((a, b) => comparePackVersions(a, b) ?? 0)
    expect(shuffled).toEqual(order)
  })

  test('a pre-release comes before its release', () => {
    expect(comparePackVersions('1.2.0-beta.1', '1.2.0')).toBe(-1)
    expect(comparePackVersions('1.2.0', '1.2.0-beta.1')).toBe(1)
    expect(comparePackVersions('1.2.0-beta.1', '1.1.9')).toBe(1)
  })

  test('numeric identifiers compare as numbers, and before alphanumeric ones', () => {
    expect(comparePackVersions('1.0.0-beta.2', '1.0.0-beta.11')).toBe(-1) // not string order
    expect(comparePackVersions('1.0.0-1', '1.0.0-alpha')).toBe(-1)
    expect(comparePackVersions('1.0.0-alpha', '1.0.0-1')).toBe(1)
    expect(comparePackVersions('1.0.0-alpha.1', '1.0.0-alpha.a')).toBe(-1)
    expect(comparePackVersions('1.0.0-Beta', '1.0.0-beta')).toBe(-1) // ASCII: uppercase first
    expect(comparePackVersions('1.0.0-a-b', '1.0.0-a')).toBe(1)
  })

  test('a longer pre-release list wins when every earlier identifier is equal', () => {
    expect(comparePackVersions('1.0.0-alpha', '1.0.0-alpha.0')).toBe(-1)
    expect(comparePackVersions('1.0.0-alpha.1.1', '1.0.0-alpha.1')).toBe(1)
  })

  test('build metadata is ignored', () => {
    expect(comparePackVersions('1.0.0+build.1', '1.0.0+build.2')).toBe(0)
    expect(comparePackVersions('1.0.0-rc.1+exp.sha.5114f85', '1.0.0-rc.1')).toBe(0)
    expect(comparePackVersions('1.0.0+20130313144700', '1.0.1')).toBe(-1)
  })

  test('core numbers compare numerically, and 1 / 1.2 read as 1.0.0 / 1.2.0', () => {
    expect(comparePackVersions('1.10.0', '1.9.0')).toBe(1)
    expect(comparePackVersions('1.2', '1.2.0')).toBe(0)
    expect(comparePackVersions('2', '1.9.9')).toBe(1)
  })

  test('anything else has no order (null), never a guess', () => {
    for (const bad of [
      '',
      'v1.0.0',
      '1.0.0.0',
      '01.0.0',
      '1.0.0-',
      '1.0.0-01',
      '1.0.0+',
      'latest',
      '1.0.0-al$pha',
    ]) {
      expect(parsePackVersion(bad)).toBeNull()
      expect(comparePackVersions(bad, '1.0.0')).toBeNull()
    }
    expect(isPreRelease('1.0.0-rc.1')).toBe(true)
    expect(isPreRelease('1.0.0+build')).toBe(false)
  })
})

describe('the downgrade guard and the update list use it', () => {
  test('isNewerRegistryVersion follows precedence', () => {
    expect(isNewerRegistryVersion('1.2.0-beta.1', '1.2.0')).toBe(true)
    expect(isNewerRegistryVersion('1.2.0', '1.2.0-beta.1')).toBe(false)
    expect(isNewerRegistryVersion('1.2.0-beta.2', '1.2.0-beta.11')).toBe(true)
    expect(isNewerRegistryVersion('1.2.0+a', '1.2.0+b')).toBe(false)
  })

  test('a pre-release is offered as an update only to someone already on a pre-release', () => {
    const offered = (version: string) => ({
      id: 'p',
      version,
      downloadUrl: 'https://example.invalid/p.json',
      size: 1,
      sha256: '0'.repeat(64),
      signature: { alg: 'ed25519' as const, publicKey: '0'.repeat(64), sig: '0'.repeat(128) },
    })
    const on = (packVersion: string) => [{ id: 'p', name: 'P', packVersion }]
    expect(registryUpdates(on('1.1.0'), [offered('1.2.0-beta.1')])).toEqual([])
    expect(registryUpdates(on('1.2.0-beta.1'), [offered('1.2.0-beta.2')])).toHaveLength(1)
    expect(registryUpdates(on('1.2.0-beta.1'), [offered('1.2.0')])).toHaveLength(1)
    expect(registryUpdates(on('1.1.0'), [offered('1.2.0')])).toHaveLength(1)
  })

  test('downgradeRefusal compares with the installed row and with the floor', () => {
    expect(downgradeRefusal('p', '1.2.0-beta.1', '1.2.0', null)).toMatch(
      /^"p" 1\.2\.0 is installed, and this file is the older 1\.2\.0-beta\.1\. .*Uninstall first if you mean to go back\.$/,
    )
    expect(downgradeRefusal('p', '1.2.0', '1.2.0-beta.1', null)).toBeNull()
    expect(downgradeRefusal('p', '1.0.0', undefined, { p: '1.1.0' })).toMatch(
      /"p" 1\.1\.0 is installed/,
    )
    expect(downgradeRefusal('p', '1.0.0+b', '1.0.0+a', null)).toBeNull()
    expect(downgradeRefusal('p', 'odd', '1.0.0', null)).toBeNull()
  })

  test('a local install of an older pre-release over its release is refused before any check', async () => {
    const pack = (packVersion: string) =>
      JSON.stringify({
        format: CONTENT_PACK_FORMAT,
        version: CONTENT_PACK_VERSION,
        id: 'semver_pack',
        name: 'Semver',
        packVersion,
        license: 'MIT',
        parts: [],
      })
    const first = await installLocalPackVerified(emptyContentIndex(), pack('1.2.0'))
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const older = await installLocalPackVerified(first.index, pack('1.2.0-beta.1'))
    expect(older.ok).toBe(false)
    if (!older.ok)
      expect(older.reason).toMatch(
        /older 1\.2\.0-beta\.1\. ChipBlocks does not install an older version/,
      )
    const newer = await installLocalPackVerified(first.index, pack('1.2.1-rc.1'))
    expect(newer.ok).toBe(true)
    const floored = await installLocalPackVerified(
      emptyContentIndex(),
      pack('1.1.0'),
      1,
      undefined,
      {
        semver_pack: '1.2.0',
      },
    )
    expect(floored.ok).toBe(false)
  })
})

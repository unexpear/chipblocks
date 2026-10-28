/**
 * Pack version order, for the downgrade guard, the update list, and the rollback floor.
 *
 * Semantic Versioning 2.0.0 precedence: major.minor.patch compare as numbers; a pre-release
 * (`1.2.0-beta.1`) comes before its release (`1.2.0`); pre-release identifiers compare one by one,
 * numeric ones as numbers, numeric before alphanumeric, alphanumeric by ASCII order, and a longer
 * list wins when every earlier identifier is equal; build metadata (`+build.5`) is ignored.
 * `1` and `1.2` are read as `1.0.0` and `1.2.0`, as before. A version that is not of this shape
 * has no order (`null`), so callers never guess.
 */

export type ParsedVersion = {
  core: [number, number, number]
  pre: (number | string)[]
}

const VERSION_RE =
  /^(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:\.(0|[1-9]\d*))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export function parsePackVersion(value: string): ParsedVersion | null {
  const match = VERSION_RE.exec(value.trim())
  if (match === null) return null
  const core: [number, number, number] = [
    Number(match[1]),
    Number(match[2] ?? 0),
    Number(match[3] ?? 0),
  ]
  if (!core.every(Number.isSafeInteger)) return null
  const pre: (number | string)[] = []
  if (match[4] !== undefined) {
    for (const part of match[4].split('.')) {
      if (/^\d+$/.test(part)) {
        // A numeric identifier must not have a leading zero (SemVer 9).
        if (part.length > 1 && part.startsWith('0')) return null
        const n = Number(part)
        if (!Number.isSafeInteger(n)) return null
        pre.push(n)
      } else {
        pre.push(part)
      }
    }
  }
  return { core, pre }
}

function compareIdentifiers(a: number | string, b: number | string): -1 | 0 | 1 {
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0
  if (typeof a === 'number') return -1
  if (typeof b === 'number') return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** -1 when `a` comes before `b`, 1 when after, 0 when equal in precedence, null when either has no order. */
export function comparePackVersions(a: string, b: string): -1 | 0 | 1 | null {
  const left = parsePackVersion(a)
  const right = parsePackVersion(b)
  if (left === null || right === null) return null
  for (let i = 0; i < 3; i++) {
    const l = left.core[i] ?? 0
    const r = right.core[i] ?? 0
    if (l !== r) return l < r ? -1 : 1
  }
  if (left.pre.length === 0 && right.pre.length === 0) return 0
  if (left.pre.length === 0) return 1
  if (right.pre.length === 0) return -1
  const n = Math.min(left.pre.length, right.pre.length)
  for (let i = 0; i < n; i++) {
    const c = compareIdentifiers(left.pre[i] as number | string, right.pre[i] as number | string)
    if (c !== 0) return c
  }
  return left.pre.length === right.pre.length ? 0 : left.pre.length < right.pre.length ? -1 : 1
}

export function isPreRelease(value: string): boolean {
  const parsed = parsePackVersion(value)
  return parsed !== null && parsed.pre.length > 0
}

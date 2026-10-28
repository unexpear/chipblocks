/**
 * Key rotation state kept in the sealed trust-seal.json payload: the publisher keys you rotated
 * away from (a rotation back to one is refused) and, per old key, the highest rotation sequence
 * you accepted (an older or reused rotation from that key is refused). Plain data, shared by the
 * main process (seal) and the renderer (verification).
 */
export type RotationState = {
  retired: string[]
  sequences: Record<string, number>
}

const HEX32 = /^[0-9a-f]{64}$/

export const emptyRotationState = (): RotationState => ({ retired: [], sequences: {} })

export function isRotationState(raw: unknown): raw is RotationState {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false
  const r = raw as Record<string, unknown>
  return (
    Array.isArray(r.retired) &&
    r.retired.every((k) => typeof k === 'string' && HEX32.test(k)) &&
    typeof r.sequences === 'object' &&
    r.sequences !== null &&
    !Array.isArray(r.sequences) &&
    Object.entries(r.sequences).every(
      ([k, v]) => HEX32.test(k) && typeof v === 'number' && Number.isSafeInteger(v) && v >= 1,
    )
  )
}

/** Only ever adds: a retired key stays retired, a sequence never goes down. */
export function mergeRotationState(
  a: RotationState | null,
  b: RotationState | null,
): RotationState {
  const retired = [...new Set([...(a?.retired ?? []), ...(b?.retired ?? [])])].sort()
  const sequences: Record<string, number> = { ...(a?.sequences ?? {}) }
  for (const [key, seq] of Object.entries(b?.sequences ?? {})) {
    sequences[key] = Math.max(sequences[key] ?? 0, seq)
  }
  return { retired, sequences }
}

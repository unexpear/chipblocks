/**
 * One engineering-notation formatter for every electrical quantity (Sprint 19
 * S19-v3-35). Scales a value to the right SI prefix in ×1000 ("engineering")
 * steps — the way electronics is read — and shows ~3 significant figures.
 * Replaces the per-quantity formatters (current / voltage / resistance / power,
 * including the redundant pairs that did the same unit at different scales).
 *
 * Prefix ladder T … f (the electronics-relevant span; SI has 24 prefixes total,
 * but circuits only use the ×1000 steps): T G M k (base) m µ n p f.
 */

type EngOptions = {
  /** Significant figures to show (default 3). */
  sigFigs?: number
  /** Keep the sign (default false → magnitude). Used for node potentials. */
  signed?: boolean
}

const PREFIXES: { factor: number; symbol: string }[] = [
  { factor: 1e12, symbol: 'T' },
  { factor: 1e9, symbol: 'G' },
  { factor: 1e6, symbol: 'M' },
  { factor: 1e3, symbol: 'k' },
  { factor: 1, symbol: '' },
  { factor: 1e-3, symbol: 'm' },
  { factor: 1e-6, symbol: 'µ' },
  { factor: 1e-9, symbol: 'n' },
  { factor: 1e-12, symbol: 'p' },
  { factor: 1e-15, symbol: 'f' },
]

/**
 * Format a value with the right engineering prefix + unit, e.g.
 * formatEng(0.0149, 'A') → "14.9 mA", formatEng(4700, 'Ω') → "4.70 kΩ".
 * Below the smallest prefix (or exactly 0) it returns "0 <unit>".
 */
export function formatEng(value: number, unit: string, options?: EngOptions): string {
  const sigFigs = options?.sigFigs ?? 3
  const magnitude = Math.abs(value)

  const smallest = PREFIXES[PREFIXES.length - 1]
  if (magnitude === 0 || smallest === undefined || magnitude < smallest.factor) {
    return `0 ${unit}`
  }

  const prefix = PREFIXES.find((p) => magnitude >= p.factor) ?? smallest
  const mantissa = magnitude / prefix.factor
  const decimals = Math.max(0, sigFigs - 1 - Math.floor(Math.log10(mantissa)))
  const sign = options?.signed && value < 0 ? '-' : ''
  return `${sign}${mantissa.toFixed(decimals)} ${prefix.symbol}${unit}`
}

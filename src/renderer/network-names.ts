export function networkName(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/[\r\n\t]/g, ' ')
    .trim()
    .slice(0, 120)
}

export function networkNames(values: unknown[]): string[] {
  return [...new Set(values.map(networkName).filter(Boolean))].sort()
}

/**
 * The two bits of English every count-carrying message needs, in one place.
 *
 * Sentences built by hand out of numbers go wrong the same two ways every time: "the 1 kinds of tile" (a
 * count glued to a plural), and "1 pin area and 2 memory areas and 1 arithmetic area" (a list joined with
 * "and" between every pair). Both shipped. Both are one-liners once, and a bug in every message that does it
 * by hand.
 */

/** A count with the right noun after it: `plural(1, 'part', 'parts')` → "1 part". */
export const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`

/** Items as a person would say them: "a", "a and b", "a, b and c". Empty gives an empty string. */
export function listPhrase(items: readonly string[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0] as string
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] as string}`
}

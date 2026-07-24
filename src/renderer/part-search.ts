/**
 * Fuzzy search + ranking for the part picker. The old picker did a plain case-insensitive substring
 * test, so "hadd" found nothing and "np" found everything with an n-then-p. This is the small,
 * well-trodden algorithm every command palette (fzf, VS Code, Sublime) uses: a query matches a target
 * if its characters appear IN ORDER (a subsequence), and matches are RANKED — an exact hit beats a
 * prefix beats a word-initial ("np" → NPN) beats a contiguous run beats scattered characters, with the
 * earliest match winning ties. It also returns the matched character positions so the UI can bold them.
 *
 * Deliberately NOT a trigram index or a 50 KB fuzzy library: ~110 parts re-scored on each keystroke is
 * trivial, and a subsequence scorer needs no build step or dependency.
 */

/** A char is a "word start" if it begins the string or follows a separator or a lower→upper case change. */
function isWordStart(text: string, i: number): boolean {
  if (i === 0) return true
  const prev = text[i - 1] as string
  const ch = text[i] as string
  if (/[\s_\-/.]/.test(prev)) return true
  // camelCase / a digit after a letter (NMOS, 74HC): treat the boundary as a word start
  if (prev >= 'a' && prev <= 'z' && ch >= 'A' && ch <= 'Z') return true
  if (!/[0-9]/.test(prev) && /[0-9]/.test(ch)) return true
  return false
}

export type FuzzyMatch = { score: number; positions: number[] }

// Scoring weights, in fzf's spirit: a consecutive run and a word-start alignment are the strong
// signals; gaps are penalised. Tuned so word-boundary matches ("hadd" → Half Adder) win over an
// earlier scattered one ("h-a-...-dd" spanning "half ... adder").
const MATCH = 1
const WORD_START = 8
const FIRST_CHAR = 6
const CONSECUTIVE = 8
const GAP_START = -3
const GAP_EXTEND = -1

function charScore(text: string, j: number): number {
  return MATCH + (isWordStart(text, j) ? WORD_START : 0) + (j === 0 ? FIRST_CHAR : 0)
}

/**
 * Score `query` against `text` (case-insensitive), or null if `query` is not a subsequence of `text`.
 * Higher is better. A small dynamic program picks the highest-scoring alignment — so the matched
 * positions land on word starts and consecutive runs where it can ("Half **Add**er", not
 * "**H**alf **a**...**d**er") — the same idea fzf uses, sized for short part labels.
 */
export function fuzzyScore(query: string, text: string): FuzzyMatch | null {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  const m = q.length
  const n = t.length
  if (m === 0) return { score: 0, positions: [] }
  if (m > n) return null

  // dp[j] = best score matching q[0..i] with q[i] placed at t position j; back[i][j] = the t position
  // chosen for q[i-1] on that best path (or -1 for the first query char).
  const NEG = Number.NEGATIVE_INFINITY
  let prev = new Array<number>(n).fill(NEG)
  const back: number[][] = []
  for (let j = 0; j < n; j++) {
    if (t[j] === q[0]) prev[j] = charScore(t, j) - j * 0.5 // slight lead-in penalty breaks ties earlier
  }
  back.push(new Array<number>(n).fill(-1))

  for (let i = 1; i < m; i++) {
    const cur = new Array<number>(n).fill(NEG)
    const brow = new Array<number>(n).fill(-1)
    let bestPrevScore = NEG
    let bestPrevK = -1
    for (let j = i; j < n; j++) {
      // fold in prev[j-1] (a candidate k = j-1) before scoring position j, tracking the running best k<j
      const candidate = prev[j - 1] ?? NEG
      if (candidate > NEG && candidate > bestPrevScore) {
        bestPrevScore = candidate
        bestPrevK = j - 1
      }
      if (t[j] !== q[i] || bestPrevK < 0) continue
      // gap-aware: consecutive (k == j-1) gets the run bonus, else a gap penalty by distance
      const gap = j - bestPrevK - 1
      const link = gap === 0 ? CONSECUTIVE : GAP_START + GAP_EXTEND * gap
      cur[j] = charScore(t, j) + bestPrevScore + link
      brow[j] = bestPrevK
    }
    prev = cur
    back.push(brow)
  }

  // Best endpoint for the last query char.
  let endJ = -1
  let best = NEG
  for (let j = m - 1; j < n; j++) {
    const s = prev[j] ?? NEG
    if (s > best) {
      best = s
      endJ = j
    }
  }
  if (endJ < 0) return null

  // Backtrace the positions.
  const positions: number[] = []
  let j = endJ
  for (let i = m - 1; i >= 0; i--) {
    positions.unshift(j)
    j = back[i]?.[j] ?? -1
    if (j < 0) break
  }

  let score = best
  if (t === q)
    score += 40 // exact
  else if (t.startsWith(q)) score += 16 // prefix
  score += Math.max(0, 6 - (n - m) * 0.1) // a tight match (little slack) ranks a touch higher

  return { score, positions }
}

/** What the picker searches over — the visible label plus the hidden text (id, keywords, category). */
export type SearchItem = {
  definition: string
  label: string
  /** Extra searchable text (definition id, synonyms, category label) — matched, but not highlighted. */
  haystack: string
}

export type SearchResult = {
  definition: string
  /** Match positions in the LABEL to bold, empty when the hit came only from the hidden haystack. */
  highlight: number[]
  score: number
}

/**
 * Rank items against a query. A hit on the visible LABEL is preferred (and highlighted); a hit only in
 * the hidden haystack (so "mosfet" finds "NMOS", "chip" finds the FPGA) still counts, at a discount and
 * with no highlight. Returns matches only, best first; ties keep the input order (a stable sort), so the
 * caller's category ordering survives.
 */
export function searchParts(query: string, items: readonly SearchItem[]): SearchResult[] {
  const q = query.trim()
  const scored: (SearchResult & { order: number })[] = []
  items.forEach((item, order) => {
    const onLabel = fuzzyScore(q, item.label)
    if (onLabel) {
      scored.push({
        definition: item.definition,
        highlight: onLabel.positions,
        score: onLabel.score + 20,
        order,
      })
      return
    }
    const onHay = fuzzyScore(q, item.haystack)
    if (onHay) {
      scored.push({ definition: item.definition, highlight: [], score: onHay.score, order })
    }
  })
  scored.sort((a, b) => b.score - a.score || a.order - b.order)
  return scored.map(({ order: _order, ...rest }) => rest)
}

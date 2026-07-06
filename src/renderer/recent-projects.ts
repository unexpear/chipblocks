/**
 * The "My Projects" list — a small most-recently-used record of the .chipblocks files the user has
 * saved or reopened, so the launcher can offer them again. Persisted in the renderer's localStorage
 * (the same store the theme uses). Each entry is only a name + path + timestamp, never the circuit
 * itself — reopening reads the file FRESH from disk (so an externally edited project opens current,
 * and a moved/deleted file can be pruned).
 */

export type RecentProject = { name: string; path: string; savedAt: number }

const KEY = 'chipblocks.projects'
const CAP = 24

/** The saved projects, most-recent first. Tolerant of a missing / corrupt store (returns []). */
export function listRecentProjects(): RecentProject[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (p): p is RecentProject =>
          typeof p === 'object' &&
          p !== null &&
          typeof (p as RecentProject).name === 'string' &&
          typeof (p as RecentProject).path === 'string' &&
          typeof (p as RecentProject).savedAt === 'number',
      )
      .sort((a, b) => b.savedAt - a.savedAt)
  } catch {
    return []
  }
}

/** Record (or move to the front) a project by path. Best-effort — localStorage may be unavailable. */
export function recordRecentProject(entry: RecentProject): void {
  try {
    const rest = listRecentProjects().filter((p) => p.path !== entry.path)
    localStorage.setItem(KEY, JSON.stringify([entry, ...rest].slice(0, CAP)))
  } catch {
    // localStorage unavailable — the MRU is a best-effort convenience, not load-bearing.
  }
}

/** Drop a project from the list (e.g. its file moved/was deleted). */
export function removeRecentProject(path: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(listRecentProjects().filter((p) => p.path !== path)))
  } catch {
    // best-effort
  }
}

/** The file name (without extension) of a path — a friendly fallback project name. */
export function projectNameFromPath(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path
  return base.replace(/\.chipblocks$/i, '')
}

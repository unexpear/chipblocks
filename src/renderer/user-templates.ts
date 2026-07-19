import { type CircuitFile, deserializeCircuit } from './circuit-file.ts'
import type { WorkspaceMode } from './workspace.ts'

/**
 * The personal TEMPLATES library (user-made starter circuits) — the sibling of the user-parts library
 * ([[user-library.ts]]). A template you save from a working canvas lives in a small JSON file at
 * ~/.chipblocks/user-templates.json so it follows you into every project: it shows up in the project
 * browser's "My templates" as a starting point you spin fresh projects from, right next to the built-in
 * starters. Because a saved circuit embeds the user-made parts it references (serializeCircuit), a custom
 * template made from your own blocks carries them along — it isn't silently broken elsewhere.
 *
 * The main process does the raw file I/O (it owns ~/.chipblocks); this module owns the FORMAT. A template
 * whose circuit this build can't validate is dropped on load (and pruned on the next save), so any
 * breaking change to the circuit shape rides CIRCUIT_FILE_VERSION; a change to the TEMPLATE wrapper shape
 * must bump USER_TEMPLATES_VERSION, or older builds would quietly discard the new-shaped templates.
 */

export const USER_TEMPLATES_FORMAT = 'chipblocks-user-templates'
export const USER_TEMPLATES_VERSION = 1

export type UserTemplate = {
  id: string
  name: string
  /** The level this template opens on (Circuit ▸ Board ▸ Chip) — a saved board starts on the board. */
  workspace: WorkspaceMode
  /** The saved wired circuit (with its referenced user parts embedded). */
  circuit: CircuitFile
  /** When it was saved (ms epoch) — newest first in the browser. */
  createdAt: number
}

export type UserTemplatesFile = {
  format: typeof USER_TEMPLATES_FORMAT
  version: typeof USER_TEMPLATES_VERSION
  templates: UserTemplate[]
}

/** The templates → the versioned file text written to ~/.chipblocks/user-templates.json. */
export function serializeUserTemplates(templates: readonly UserTemplate[]): string {
  const file: UserTemplatesFile = {
    format: USER_TEMPLATES_FORMAT,
    version: USER_TEMPLATES_VERSION,
    templates: [...templates],
  }
  return JSON.stringify(file, null, 2)
}

export type TemplatesResult =
  | { ok: true; templates: UserTemplate[] }
  | { ok: false; reason: string }

const WORKSPACES: readonly WorkspaceMode[] = ['schematic', 'board', 'chip']

/** One raw entry → a valid UserTemplate, or null (dropped). The circuit is validated with the same
 *  reader the project file uses, so a malformed / future-version circuit is rejected honestly. */
function validateTemplate(raw: unknown): UserTemplate | null {
  if (typeof raw !== 'object' || raw === null) return null
  const t = raw as Record<string, unknown>
  if (typeof t.id !== 'string' || typeof t.name !== 'string') return null
  const workspace: WorkspaceMode = WORKSPACES.includes(t.workspace as WorkspaceMode)
    ? (t.workspace as WorkspaceMode)
    : 'schematic'
  const parsed = deserializeCircuit(JSON.stringify(t.circuit))
  if (!parsed.ok) return null
  const createdAt = typeof t.createdAt === 'number' ? t.createdAt : 0
  return { id: t.id, name: t.name, workspace, circuit: parsed.file, createdAt }
}

/** Parse + validate the templates file. Honest rejections (not JSON / wrong format / future version); a
 *  template with an unreadable circuit is dropped, so a mostly-good library still loads its good ones. */
export function deserializeUserTemplates(text: string): TemplatesResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'The templates library is not valid JSON.' }
  }
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, reason: 'The templates library is not a JSON object.' }
  }
  const file = raw as Record<string, unknown>
  if (file.format !== USER_TEMPLATES_FORMAT) {
    return { ok: false, reason: 'Not a ChipBlocks templates library (wrong or missing format).' }
  }
  if (file.version !== USER_TEMPLATES_VERSION) {
    return {
      ok: false,
      reason: `Unsupported templates-library version ${String(file.version)} (this build reads ${USER_TEMPLATES_VERSION}).`,
    }
  }
  const list = Array.isArray(file.templates) ? file.templates : []
  const templates = list
    .map(validateTemplate)
    .filter((t): t is UserTemplate => t !== null)
    .sort((a, b) => b.createdAt - a.createdAt)
  return { ok: true, templates }
}

/** Add (or replace by id) a template in a list; newest wins its id, list stays newest-first. */
export function withTemplate(
  templates: readonly UserTemplate[],
  template: UserTemplate,
): UserTemplate[] {
  return [template, ...templates.filter((t) => t.id !== template.id)].sort(
    (a, b) => b.createdAt - a.createdAt,
  )
}

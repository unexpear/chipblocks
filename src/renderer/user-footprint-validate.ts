/**
 * Validation for an AUTHORED footprint — one rule set serving two callers: the editor (which shows the
 * problems while you draw) and the file loader (which refuses a malformed footprint rather than placing a
 * package that would mis-solder). `footprintProblems` is the rules; `validateUserFootprint` is the
 * load-time gate built on it, mirroring validateUserPart's shape.
 *
 * These are STRUCTURAL checks — the geometry has to be coherent (a hole inside its own pad, a courtyard
 * that actually contains the pads, pad ids that are unique so a pin can be mapped to one). The
 * MANUFACTURABILITY limits (minimum drill, annular ring, copper spacing) deliberately stay in pcb-drc.ts,
 * which already owns them for the whole board — duplicating them here would give the project two copies of
 * the same rule to drift apart.
 */

import type { Courtyard, Footprint, Pad, SilkLine } from './footprint.ts'
import { isBuiltinFootprintId } from './user-footprints.ts'

const SHAPES = new Set(['rect', 'roundrect', 'circle', 'oval'])
const PAD_TYPES = new Set(['smd', 'through_hole'])
const SOURCE_TYPES = new Set(['reference', 'standard', 'datasheet', 'measurement', 'derived'])
const CONFIDENCES = new Set(['high', 'medium', 'low', 'unknown'])
/** Geometry slack (mm) — floating-point noise from an editor drag, not a real tolerance. */
const EPS = 1e-6

const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isXY = (v: unknown): v is { x: number; y: number } => isRec(v) && finite(v.x) && finite(v.y)

function padProblems(raw: unknown, index: number): string[] {
  const where = `pad ${index + 1}`
  if (!isRec(raw)) return [`${where}: not an object`]
  const out: string[] = []
  if (!nonEmpty(raw.id)) out.push(`${where}: needs a name/number (the datasheet's pad label)`)
  if (!isXY(raw.center)) out.push(`${where}: centre must be an {x, y} in mm`)
  const size = raw.size
  if (!isRec(size) || !finite(size.w) || !finite(size.h) || size.w <= 0 || size.h <= 0) {
    out.push(
      `${where}: size must be a positive {w, h} in mm — a pad with no copper can't be soldered`,
    )
  }
  if (typeof raw.shape !== 'string' || !SHAPES.has(raw.shape)) {
    out.push(`${where}: shape must be rect, roundrect, circle or oval`)
  }
  if (typeof raw.type !== 'string' || !PAD_TYPES.has(raw.type)) {
    out.push(`${where}: type must be smd or through_hole`)
  }
  const hole = raw.holeDiameter
  if (raw.type === 'through_hole') {
    if (!finite(hole) || hole <= 0) {
      out.push(`${where}: a through-hole pad needs a drill diameter (mm)`)
    } else if (
      isRec(size) &&
      finite(size.w) &&
      finite(size.h) &&
      hole >= Math.min(size.w, size.h)
    ) {
      // not a tolerance question — a hole at least as wide as its pad leaves no ring of copper at all
      out.push(
        `${where}: the ${hole} mm drill is as wide as the pad (${size.w} × ${size.h} mm) — no copper ring would be left around it`,
      )
    }
  } else if (hole !== undefined) {
    out.push(`${where}: an SMD pad is a flat land — it can't have a drill`)
  }
  if (raw.castellated === true && raw.type !== 'through_hole') {
    out.push(`${where}: a castellated pad is a plated half-HOLE, so it must be through-hole`)
  }
  return out
}

function silkProblems(raw: unknown, index: number, layer: string): string[] {
  const where = `${layer} line ${index + 1}`
  if (!isRec(raw)) return [`${where}: not an object`]
  const out: string[] = []
  if (!isXY(raw.from) || !isXY(raw.to)) out.push(`${where}: needs {from, to} points in mm`)
  if (!finite(raw.width) || raw.width <= 0)
    out.push(`${where}: width must be a positive number of mm`)
  return out
}

function provenanceProblems(raw: unknown, what: string): string[] {
  if (!isRec(raw)) {
    return [`${what}: say where the numbers came from (source, title, citation)`]
  }
  const out: string[] = []
  if (typeof raw.source_type !== 'string' || !SOURCE_TYPES.has(raw.source_type)) {
    out.push(`${what}: source must be reference, standard, datasheet, measurement or derived`)
  }
  if (!nonEmpty(raw.title)) out.push(`${what}: needs a title (what the source is)`)
  if (!nonEmpty(raw.citation)) out.push(`${what}: needs a citation (where it says so)`)
  if (typeof raw.confidence !== 'string' || !CONFIDENCES.has(raw.confidence)) {
    out.push(`${what}: confidence must be high, medium, low or unknown`)
  }
  return out
}

/** Does the courtyard contain this pad's copper? An assembly keep-out that misses a pad is a lie. */
function padOutsideCourtyard(pad: Pad, c: Courtyard): boolean {
  const left = pad.center.x - pad.size.w / 2
  const right = pad.center.x + pad.size.w / 2
  const top = pad.center.y - pad.size.h / 2
  const bottom = pad.center.y + pad.size.h / 2
  return left < c.x - EPS || top < c.y - EPS || right > c.x + c.w + EPS || bottom > c.y + c.h + EPS
}

/**
 * Every problem with a proposed footprint, in plain language — empty means it is placeable. The editor
 * shows these live; the loader refuses anything with entries.
 */
export function footprintProblems(raw: unknown): string[] {
  if (!isRec(raw)) return ['not a footprint object']
  const out: string[] = []

  if (!nonEmpty(raw.id)) out.push('needs an id')
  else if (isBuiltinFootprintId(raw.id)) {
    out.push(
      `"${raw.id}" is a built-in footprint — choose a different id so the shipped one keeps working`,
    )
  }
  if (!nonEmpty(raw.name)) out.push('needs a name (what the picker shows)')

  const pads = raw.pads
  if (!Array.isArray(pads) || pads.length === 0) {
    out.push('needs at least one pad')
  } else {
    for (const [i, p] of pads.entries()) out.push(...padProblems(p, i))
    const ids = pads.filter(isRec).map((p) => p.id)
    const dupes = [
      ...new Set(ids.filter((id, i) => typeof id === 'string' && ids.indexOf(id) !== i)),
    ]
    if (dupes.length > 0) {
      out.push(`pad names must be unique — repeated: ${dupes.join(', ')} (a pin maps to one pad)`)
    }
  }

  for (const [key, label] of [
    ['silkscreen', 'silkscreen'],
    ['fabrication', 'body outline'],
  ] as const) {
    const lines = raw[key]
    if (lines === undefined) continue
    if (!Array.isArray(lines)) {
      out.push(`${label}: must be a list of lines`)
      continue
    }
    for (const [i, line] of lines.entries()) out.push(...silkProblems(line, i, label))
  }

  const labels = raw.labels
  if (
    !isRec(labels) ||
    !isXY(labels.reference) ||
    !isXY(labels.value) ||
    !isXY(labels.fabReference)
  ) {
    out.push('needs label anchors ({x, y} for reference, value and fabReference)')
  }

  const c = raw.courtyard
  if (
    !isRec(c) ||
    !finite(c.x) ||
    !finite(c.y) ||
    !finite(c.w) ||
    !finite(c.h) ||
    c.w <= 0 ||
    c.h <= 0
  ) {
    out.push('needs a courtyard (the assembly keep-out) with a positive width and height')
  } else if (Array.isArray(pads)) {
    const court = c as unknown as Courtyard
    const escaped = pads
      .filter((p): p is Pad => isRec(p) && isXY(p.center) && isRec(p.size))
      .filter((p) => finite(p.size.w) && finite(p.size.h) && padOutsideCourtyard(p, court))
      .map((p) => p.id)
    if (escaped.length > 0) {
      out.push(
        `the courtyard doesn't cover pad(s) ${escaped.join(', ')} — it must enclose all the copper it claims to keep clear`,
      )
    }
  }

  out.push(...provenanceProblems(raw.provenance, 'source'))
  const body = raw.body3d
  if (body !== undefined) {
    if (!isRec(body) || !finite(body.heightMm) || body.heightMm < 0) {
      out.push('3-D body: height must be a number of mm (0 or more)')
    } else if (!finite(body.standoffMm) || body.standoffMm < 0) {
      out.push('3-D body: standoff must be a number of mm (0 or more)')
    } else {
      out.push(...provenanceProblems(body.provenance, '3-D body source'))
    }
  }
  return out
}

/** Load-time gate: a validated footprint, or null if anything is wrong (mirrors validateUserPart). */
export function validateUserFootprint(raw: unknown): Footprint | null {
  if (footprintProblems(raw).length > 0) return null
  const fp = raw as Footprint
  return {
    ...fp,
    description: typeof fp.description === 'string' ? fp.description : '',
    silkscreen: Array.isArray(fp.silkscreen) ? (fp.silkscreen as SilkLine[]) : [],
    fabrication: Array.isArray(fp.fabrication) ? (fp.fabrication as SilkLine[]) : [],
  }
}

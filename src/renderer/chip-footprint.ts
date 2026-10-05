/**
 * Chip-level footprint author-OR-derive (TOOLCHAIN-ROADMAP.md — "Footprint two-way sync").
 *
 * Board packages already author-first (and derive a provisional land for honest two-terminal /
 * user-part pin orders). The chip side already place→derives cell geometry from gates. This module
 * is the missing chip/cell half for PACKAGES: given known pin/pad data (block ports, LEF-facing
 * cell pins, top-level chip I/O), either use a user-authored package or emit a clearly labeled
 * derived land — and refuse when the pin order is ambiguous or role-sensitive.
 *
 * Never invents a manufacturer package (SOIC, QFN, …). Derived lands are provisional_<N>pad.
 * No KiCad shell-outs.
 */
import { cellBlock } from './cell-polygons.ts'
import { type Footprint, parseProvisionalFootprintId, provisionalLand } from './footprint.ts'
import { type PadMapFailure, type PadMapVia, resolvePadMap } from './footprint-assignment.ts'
import type { TopNetlist } from './top-netlist.ts'
import { isUserFootprint, resolveFootprint } from './user-footprints.ts'

/** One chip/cell pin in declaration order — the data author-or-derive reads. */
export type ChipFootprintPin = {
  id: string
  name: string
  /** Explicit package pad when the author named one (`pin.pad`). */
  pad?: string
}

export type ChipFootprintRefusalReason =
  | 'no-pins'
  | 'duplicate-pin-ids'
  | 'role-sensitive'
  | 'ambiguous-pads'
  | 'authored-unfit'

export type ChipFootprintOk = {
  ok: true
  source: 'authored' | 'derived'
  footprint: Footprint
  padMap: Map<string, string>
  via: Map<string, PadMapVia>
}

export type ChipFootprintRefusal = {
  ok: false
  reason: ChipFootprintRefusalReason
  detail: string
  failures?: PadMapFailure[]
}

export type ChipFootprintResolution = ChipFootprintOk | ChipFootprintRefusal

/**
 * Built-in kinds whose pinout is role-sensitive: a derived land would invent which pad is the
 * primary / common / in+ / etc. They may take an AUTHORED package only when every pin lands by
 * explicit `pin.pad` or a unique pad-name match — never by bare declaration-order.
 */
export const CHIP_ROLE_SENSITIVE = new Set([
  'transformer',
  'transformer_center_tapped',
  'switch_spdt',
  'op_amp',
  'relay',
])

/** Pins from a circuit / standard-cell block's ports (declaration order). */
export function chipPinsFromBlock(block: {
  ports: readonly { id: string; label?: string; name?: string }[]
}): ChipFootprintPin[] {
  return block.ports.map((port) => {
    const name = (port.name ?? '').trim() || (port.label ?? '').trim() || port.id
    return { id: port.id, name }
  })
}

/**
 * Pins from a primitive standard-cell name, in LEF MACRO order (A / B / Y / VDD / VSS) when the
 * cell is one of the eight primitives. Undefined when the name is not a primitive gate — no
 * invented pinout for black-box / user cells.
 */
export function chipPinsFromCellName(name: string): ChipFootprintPin[] | undefined {
  const block = cellBlock(name)
  if (block === undefined) return undefined
  const pins: ChipFootprintPin[] = []
  for (const port of block.ports) {
    if (port.id === 'a' || port.id === 'in') pins.push({ id: port.id, name: 'A' })
    else if (port.id === 'b') pins.push({ id: port.id, name: 'B' })
    else if (port.id === 'out') pins.push({ id: port.id, name: 'Y' })
    else if (port.id === 'v_dd' || port.id === 'vdd') pins.push({ id: port.id, name: 'VDD' })
    else if (port.id === 'gnd' || port.id === 'vss') pins.push({ id: port.id, name: 'VSS' })
  }
  const names = new Set(pins.map((p) => p.name))
  if (!names.has('Y') || !names.has('VDD') || !names.has('VSS') || !names.has('A')) {
    return undefined
  }
  return pins
}

/** Top-level chip I/O from a floorplan netlist (named net-label pins), in netlist order. */
export function chipPinsFromTopNetlist(netlist: TopNetlist): ChipFootprintPin[] {
  const pins: ChipFootprintPin[] = []
  for (const net of netlist.signalNets) {
    if (net.pin === undefined) continue
    pins.push({ id: net.pin.name, name: net.pin.name })
  }
  return pins
}

function uniquePinIds(pins: readonly ChipFootprintPin[]): boolean {
  const ids = new Set(pins.map((p) => p.id))
  return ids.size === pins.length && pins.length > 0
}

function fittingAuthored(id: string | undefined, pinCount: number): Footprint | undefined {
  if (id === undefined) return undefined
  const fp = resolveFootprint(id)
  if (fp === undefined || fp.provisional === true) return undefined
  if (parseProvisionalFootprintId(fp.id) !== undefined) return undefined
  return fp.pads.length >= pinCount ? fp : undefined
}

/** True when every pin is assigned and none used bare declaration-order (role-sensitive gate). */
function fullyExplicitOrNamed(via: Map<string, PadMapVia>, pinIds: readonly string[]): boolean {
  for (const id of pinIds) {
    const how = via.get(id)
    if (how !== 'pin.pad' && how !== 'pad-name') return false
  }
  return pinIds.length > 0
}

/**
 * Author OR derive a chip-level footprint from known pin/pad data.
 *
 * - **Authored** — a real (non-provisional) package that fits; pad map assigns every pin without
 *   failures. Role-sensitive kinds additionally require every pin via `pin.pad` or unique pad-name
 *   (no declaration-order inventing of manufacturer pinouts).
 * - **Derived** — labeled `provisional_<N>pad` land when pin ids are a unique total order and the
 *   kind is not role-sensitive.
 * - **Refuse** — no pins, duplicate ids, role-sensitive without an honest authored pad map,
 *   authored package that does not fit or leaves pins unmapped / ambiguous.
 */
export function resolveChipFootprint(args: {
  pins: readonly ChipFootprintPin[]
  authoredId?: string | undefined
  /** When true, derive is refused; authored needs fully explicit / unique-name pad maps. */
  roleSensitive?: boolean | undefined
}): ChipFootprintResolution {
  const { pins, authoredId, roleSensitive = false } = args
  if (pins.length === 0) {
    return { ok: false, reason: 'no-pins', detail: 'A chip footprint needs at least one pin.' }
  }
  if (!uniquePinIds(pins)) {
    return {
      ok: false,
      reason: 'duplicate-pin-ids',
      detail: 'Pin ids must be a unique total order — duplicate ids make pad assignment a guess.',
    }
  }

  const authored = fittingAuthored(authoredId, pins.length)
  if (authored !== undefined) {
    const mapped = resolvePadMap(pins, authored)
    const allAssigned = mapped.failures.length === 0 && pins.every((p) => mapped.map.has(p.id))
    if (!allAssigned) {
      return {
        ok: false,
        reason: 'ambiguous-pads',
        detail:
          'The authored package fits by pad count, but pin→pad assignment failed or is incomplete.',
        failures: mapped.failures,
      }
    }
    if (
      roleSensitive &&
      !fullyExplicitOrNamed(
        mapped.via,
        pins.map((p) => p.id),
      )
    ) {
      return {
        ok: false,
        reason: 'role-sensitive',
        detail:
          'Role-sensitive pinouts need an authored package with explicit pin.pad or unique pad-name matches — declaration-order would invent the manufacturer pinout.',
        failures: mapped.failures,
      }
    }
    return {
      ok: true,
      source: 'authored',
      footprint: authored,
      padMap: mapped.map,
      via: mapped.via,
    }
  }

  if (authoredId !== undefined && authoredId !== '') {
    if (roleSensitive) {
      return {
        ok: false,
        reason: 'role-sensitive',
        detail:
          'Role-sensitive kinds cannot fall back to a derived land, and the authored package does not fit.',
      }
    }
  }

  if (roleSensitive) {
    return {
      ok: false,
      reason: 'role-sensitive',
      detail:
        'Role-sensitive pinouts stay packageless until an authored package with explicit pin→pad data exists.',
    }
  }

  const land = provisionalLand(pins.length)
  if (land === undefined) {
    return {
      ok: false,
      reason: 'authored-unfit',
      detail: `Cannot derive a land for ${String(pins.length)} pins.`,
    }
  }
  const mapped = resolvePadMap(pins, land)
  if (mapped.failures.length > 0 || !pins.every((p) => mapped.map.has(p.id))) {
    return {
      ok: false,
      reason: 'ambiguous-pads',
      detail: 'Derived land pad assignment failed.',
      failures: mapped.failures,
    }
  }
  return {
    ok: true,
    source: 'derived',
    footprint: land,
    padMap: mapped.map,
    via: mapped.via,
  }
}

/** The footprint id a part/node should carry after a resolution (undefined when refused). */
export function chipFootprintId(result: ChipFootprintResolution): string | undefined {
  return result.ok ? result.footprint.id : undefined
}

/**
 * Keep-matching for the chip path: a board-side edit of a USER-OWNED footprint writes that id back
 * only when resolveChipFootprint accepts it as authored for these pins. Built-ins, provisional
 * lands, and role-sensitive refusals leave the part unchanged. Mirrors applyUserOwnedFootprintEdit.
 */
export function applyChipFootprintEdit<T extends { footprintId?: string | undefined }>(
  part: T,
  pins: readonly ChipFootprintPin[],
  edited: Footprint,
  opts?: { roleSensitive?: boolean | undefined },
): T & { footprintId?: string | undefined } {
  if (edited.provisional === true) return part
  if (parseProvisionalFootprintId(edited.id) !== undefined) return part
  if (!isUserFootprint(edited.id)) return part
  const resolved = resolveChipFootprint({
    pins,
    authoredId: edited.id,
    roleSensitive: opts?.roleSensitive === true,
  })
  if (!resolved.ok || resolved.source !== 'authored' || resolved.footprint.id !== edited.id) {
    return part
  }
  if (part.footprintId === edited.id) return part
  return { ...part, footprintId: edited.id }
}

/**
 * Resolve a circuit block's chip-level footprint: author (chosenId) OR derive from port order.
 * `definition: 'block'` alone (no ports) stays packageless via footprintForPart — this is the
 * path that has honest pin data.
 */
export function footprintForBlock(
  block: { ports: readonly { id: string; label?: string; name?: string }[] },
  chosenId?: string,
): ChipFootprintResolution {
  return resolveChipFootprint({
    pins: chipPinsFromBlock(block),
    authoredId: chosenId,
    roleSensitive: false,
  })
}

/** Resolve a primitive cell's chip-level footprint from its LEF-facing pin abstract. */
export function footprintForCell(cellName: string, chosenId?: string): ChipFootprintResolution {
  const pins = chipPinsFromCellName(cellName)
  if (pins === undefined) {
    return {
      ok: false,
      reason: 'no-pins',
      detail: `No honest LEF pin abstract for cell "${cellName}".`,
    }
  }
  return resolveChipFootprint({ pins, authoredId: chosenId, roleSensitive: false })
}

/** Resolve the whole chip design's package from top-level I/O pins. */
export function footprintForChipDesign(
  netlist: TopNetlist,
  chosenId?: string,
): ChipFootprintResolution {
  return resolveChipFootprint({
    pins: chipPinsFromTopNetlist(netlist),
    authoredId: chosenId,
    roleSensitive: false,
  })
}

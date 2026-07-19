import { STANDARD_AMBIENT_C } from '../thermal-model.ts'
import { type ChipLayout, EMPTY_CHIP_LAYOUT } from './chip-layout.ts'
import type { CircuitFile, SavedPlacement } from './circuit-file.ts'
import type { BoardProfile, BoardSide, PlacementOverride, Rotation } from './pcb-board.ts'
import type { CopperTrace, Via } from './pcb-route.ts'
import { DEFAULT_STACKUP_OPTIONS, type StackupOptions } from './pcb-stackup.ts'
import { DEFAULT_SHEET, type SheetSettings } from './sheet-frame.tsx'

const VALID_ROTATIONS: readonly Rotation[] = [0, 90, 180, 270]

/** A loaded file's SavedPlacement[] → the hand-placements Map, keeping only valid rotations. */
export function placementsFromSaved(
  saved: readonly SavedPlacement[] | undefined,
): Map<string, PlacementOverride> {
  const map = new Map<string, PlacementOverride>()
  for (const p of saved ?? []) {
    if (!(VALID_ROTATIONS as readonly number[]).includes(p.rotation)) continue
    map.set(p.id, { x: p.x, y: p.y, rotation: p.rotation as Rotation })
  }
  return map
}

/**
 * The board-fab state a saved project seeds a fresh tab with. Both file-open paths must produce this:
 * File>Open sets these via setters on the live tab; the project browser (Open / recent / template)
 * seeds a NEW tab, whose useState initializers read it here. Keeping the derivation in ONE tested
 * place is what stops the two paths from drifting — a project browser Open that silently dropped all
 * of this (placements, copper, stack-up, board shape…) was the bug this function closes.
 */
export interface BoardFabState {
  sheet: SheetSettings
  placements: Map<string, PlacementOverride>
  chipLayout: ChipLayout
  ambient: number
  traces: CopperTrace[]
  vias: Via[]
  vScoredSides: BoardSide[]
  boardProfile: BoardProfile | null
  stackup: StackupOptions
}

/**
 * Map a loaded CircuitFile (or `undefined`, for a fresh/template project) to the board-fab state a tab
 * starts from. Each field mirrors exactly what the File>Open handler restores, so a saved board comes
 * back the same no matter which way it is reopened; a project with a field absent falls to its default.
 */
export function boardFabStateFromFile(file: CircuitFile | undefined): BoardFabState {
  return {
    // An older/partial sheet still fills every field by merging over the default.
    sheet: file?.sheet ? { ...DEFAULT_SHEET, ...file.sheet } : DEFAULT_SHEET,
    placements: placementsFromSaved(file?.placements),
    chipLayout: file?.chipLayout ?? EMPTY_CHIP_LAYOUT,
    ambient:
      typeof file?.projectAmbientC === 'number' && Number.isFinite(file.projectAmbientC)
        ? file.projectAmbientC
        : STANDARD_AMBIENT_C,
    // Fresh arrays so the tab's later edits never mutate the loaded file's data.
    traces: [...(file?.traces ?? [])],
    vias: [...(file?.vias ?? [])],
    vScoredSides: [...(file?.vScoredSides ?? [])],
    boardProfile: file?.boardProfile ?? null,
    stackup: file?.stackup ?? DEFAULT_STACKUP_OPTIONS,
  }
}

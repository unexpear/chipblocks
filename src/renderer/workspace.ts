/**
 * The app's four-level workflow — which level's workspace is currently showing. The top-of-project
 * breadcrumb (Circuit ▸ Board ▸ Chip ▸ System) travels between them. Circuit (the schematic) and
 * Board (the physical PCB) are built; Chip is the new level; System is still a disabled stub, so the
 * navigable state never holds 'system'. Widening this ONE type makes the compiler flag every place a
 * new level must be handled — so a level can't be half-added.
 */
export type WorkspaceMode = 'schematic' | 'board' | 'chip'

import type { DockEdge } from './dockable-panel.tsx'

/**
 * Panel grouping — tab stacks (Sprint 21). Each dockable panel has a placement:
 * which window edge it docks to, and which GROUP it belongs to. Panels that share
 * a group render as one framed tab stack at that edge; a standalone panel is just
 * a group of one. Stacking a panel onto another adopts the target's group + edge;
 * popping a panel out gives it a fresh group at the release edge. Pure data — App
 * owns the state, the dock renders it, this module is the unit-tested reducer.
 */
export type PanelPlacement = { edge: DockEdge; group: number }
export type PanelLayout = Record<string, PanelPlacement>

/** A rendered tab stack: its group id, its edge, and the member ids in canonical order. */
export type PanelGroup = { group: number; edge: DockEdge; ids: string[] }

/** The next free group number, so a popped-out panel never collides with a live group. */
function freeGroup(layout: PanelLayout): number {
  let max = -1
  for (const place of Object.values(layout)) max = Math.max(max, place.group)
  return max + 1
}

/**
 * Put a panel on its own at `edge` — the pop-out case (a tab leaves its stack) and
 * the plain "move a standalone panel to another edge" case are the same operation.
 */
export function moveToEdge(layout: PanelLayout, id: string, edge: DockEdge): PanelLayout {
  return { ...layout, [id]: { edge, group: freeGroup(layout) } }
}

/** Stack `dragId` into `targetId`'s group (adopting its edge). No-op if already together. */
export function stackOnto(layout: PanelLayout, dragId: string, targetId: string): PanelLayout {
  const target = layout[targetId]
  if (!target || dragId === targetId || layout[dragId]?.group === target.group) return layout
  return { ...layout, [dragId]: { edge: target.edge, group: target.group } }
}

/**
 * Group the visible panels (walked in canonical `order`) into tab stacks, each stack
 * stable by first appearance. A group's edge is its first visible member's edge —
 * members always share an edge, so that is the group's edge.
 */
export function panelGroups(
  layout: PanelLayout,
  order: readonly string[],
  isVisible: (id: string) => boolean,
): PanelGroup[] {
  const groups: PanelGroup[] = []
  const byGroup = new Map<number, PanelGroup>()
  // A panel not yet in the layout (a freshly-added registry entry) auto-docks at the bottom in
  // its own group — so ADDING a panel needs only a registry entry, never a silent no-show.
  let nextFreeGroup = freeGroup(layout)
  for (const id of order) {
    if (!isVisible(id)) continue
    const place: PanelPlacement = layout[id] ?? { edge: 'bottom', group: nextFreeGroup++ }
    const existing = byGroup.get(place.group)
    if (existing) {
      existing.ids.push(id)
      continue
    }
    const group: PanelGroup = { group: place.group, edge: place.edge, ids: [id] }
    byGroup.set(place.group, group)
    groups.push(group)
  }
  return groups
}

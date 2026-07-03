import { useState } from 'react'
import type { TabDropTarget } from './dockable-panel.tsx'
import { moveToEdge, type PanelLayout, stackOnto } from './panel-groups.ts'

/**
 * The dockable-panel layout, lifted out of the Canvas component: where each panel is docked + which
 * tab is active in each stacked group, and the drag-to-dock / drag-to-stack handler (drop a panel's
 * grip onto an edge to dock it, or onto another panel to stack them into a tab group — the reducers
 * are pure). Pure UI state with NO coupling to the circuit — nothing here touches nodes, edges, the
 * tool or the solve — so it takes no injected deps; it moved here VERBATIM.
 */
export function usePanelLayout() {
  const [panelLayout, setPanelLayout] = useState<PanelLayout>({
    hierarchy: { edge: 'left', group: 0 },
    properties: { edge: 'left', group: 2 },
    tools: { edge: 'top', group: 1 },
    scope: { edge: 'bottom', group: 3 },
    timeline: { edge: 'bottom', group: 3 },
    bode: { edge: 'bottom', group: 3 },
    pcb: { edge: 'bottom', group: 3 },
  })
  const [activeTab, setActiveTab] = useState<Record<number, string>>({})
  // Drag a panel's grip/tab onto another panel to stack them into a tab group; drop
  // onto an edge to dock it (or pop a stacked tab back out). The reducer is pure.
  const onTabDrop = (tabId: string, target: TabDropTarget) => {
    if (target.kind === 'edge') {
      setPanelLayout((layout) => moveToEdge(layout, tabId, target.edge))
      return
    }
    const group = panelLayout[target.targetId]?.group
    if (group !== undefined) setActiveTab((cur) => ({ ...cur, [group]: tabId }))
    setPanelLayout((layout) => stackOnto(layout, tabId, target.targetId))
  }

  return { panelLayout, activeTab, setActiveTab, onTabDrop }
}

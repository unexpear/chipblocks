import { type BoardRouteProp, Pcb3DView } from './pcb-3d-view.tsx'
import type { Board, Recess, Rotation } from './pcb-board.ts'
import { type BoardLayer, type BoardLayerId, layerLabel } from './pcb-layers.ts'
import type { BoardRouting } from './pcb-route.ts'
import type { Stackup } from './pcb-stackup.ts'
import { PcbView } from './pcb-view.tsx'
import { THEME } from './theme.ts'

/**
 * Shared board-view pieces, used by BOTH the PCB dock panel and the full-size main-area board
 * workspace so the two never drift:
 *
 *  - PcbViewControls — the Flat / Layers / 3D segmented toggle plus, in Layers mode, the ▲/▼ pager
 *    that walks the lamination one sheet at a time (with the sheet's real-thickness label).
 *  - BoardView — the one place that branches the view mode: 3D → the exploded PcbExplodedView, else →
 *    the flat/layers PcbView. Centralising the branch keeps the `mode` union honest in a single spot.
 */

export type PcbViewMode = 'flat' | 'layers' | 'exploded'

export function PcbViewControls({
  mode,
  onMode,
  layers,
  activeLayerIndex,
  onStep,
}: {
  mode: PcbViewMode
  onMode: (mode: PcbViewMode) => void
  layers: BoardLayer[]
  activeLayerIndex: number
  onStep: (delta: number) => void
}) {
  const modes: PcbViewMode[] = ['flat', 'layers', 'exploded']
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ display: 'flex', gap: 0 }}>
        {modes.map((m, i) => (
          <button
            key={m}
            type="button"
            onClick={() => onMode(m)}
            style={{
              border: `1px solid ${THEME.borderStrong}`,
              background: mode === m ? THEME.accentBlue : THEME.surfaceInput,
              color: mode === m ? '#0b1220' : THEME.textSoft,
              borderRadius: i === 0 ? '4px 0 0 4px' : i === modes.length - 1 ? '0 4px 4px 0' : '0',
              borderLeft: i === 0 ? undefined : 'none',
              fontSize: 11,
              padding: '2px 10px',
              cursor: 'pointer',
            }}
          >
            {m === 'flat' ? 'Flat' : m === 'layers' ? 'Layers' : '3D'}
          </button>
        ))}
      </span>
      {mode === 'layers' && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            onClick={() => onStep(-1)}
            disabled={activeLayerIndex <= 0}
            title="Up a layer (toward the top of the stack)"
            style={{
              border: `1px solid ${THEME.borderStrong}`,
              background: THEME.surfaceInput,
              color: activeLayerIndex <= 0 ? THEME.textFaint : THEME.textSoft,
              borderRadius: 4,
              fontSize: 12,
              padding: '0 8px',
              cursor: activeLayerIndex <= 0 ? 'default' : 'pointer',
            }}
          >
            ▲
          </button>
          <span style={{ fontSize: 11, color: THEME.textSoft, minWidth: 150 }}>
            {(() => {
              const l = layers[activeLayerIndex]
              return l ? layerLabel(l) : ''
            })()} · {Math.max(activeLayerIndex + 1, 1)}/{layers.length}
          </span>
          <button
            type="button"
            onClick={() => onStep(1)}
            disabled={activeLayerIndex >= layers.length - 1}
            title="Down a layer (toward the bottom of the stack)"
            style={{
              border: `1px solid ${THEME.borderStrong}`,
              background: THEME.surfaceInput,
              color: activeLayerIndex >= layers.length - 1 ? THEME.textFaint : THEME.textSoft,
              borderRadius: 4,
              fontSize: 12,
              padding: '0 8px',
              cursor: activeLayerIndex >= layers.length - 1 ? 'default' : 'pointer',
            }}
          >
            ▼
          </button>
        </span>
      )}
    </div>
  )
}

export function BoardView({
  board,
  stackup,
  routing,
  drcMarkers = [],
  mode,
  activeLayer,
  pxPerMm = 12,
  viewHeight = 460,
  coordinateGrid = false,
  recesses = [],
  onMove,
  onRotate,
  route,
}: {
  board: Board
  stackup: Stackup
  routing: BoardRouting
  drcMarkers?: { x: number; y: number }[]
  mode: PcbViewMode
  activeLayer: BoardLayerId
  /** Scale for the flat/layers view (mm → px). */
  pxPerMm?: number
  /** Pixel height for the 3-D canvas. */
  viewHeight?: number
  /** Draw the coordinate axes + 4-quadrant grid (our coordinate system) on the flat + 3-D views. */
  coordinateGrid?: boolean
  /** Controlled-depth pockets milled into the board (cavity / stepped boards) — shown in the 3-D view. */
  recesses?: Recess[]
  onMove?: (partId: string, x: number, y: number) => void
  onRotate?: (partId: string, rotation: Rotation) => void
  /** The route + via tools' live state + handlers, threaded to PcbView (flat/layers) AND Pcb3DView
   *  (the 3-D exploded view) — you can lay copper by clicking in either. */
  route?: BoardRouteProp
}) {
  if (mode === 'exploded') {
    // "3D" — the real to-scale, orbitable board (the from-scratch pcb-3d engine). The route/via tools
    // work here too: a click casts a ray onto the active copper layer and lays copper in 3-D space.
    return (
      <Pcb3DView
        board={board}
        routing={routing}
        stackup={stackup}
        height={viewHeight}
        coordinateGrid={coordinateGrid}
        recesses={recesses}
        {...(route ? { route } : {})}
      />
    )
  }
  return (
    <PcbView
      board={board}
      airwires={routing.unrouted}
      traces={routing.traces}
      vias={routing.vias}
      markers={drcMarkers}
      mode={mode}
      activeLayer={activeLayer}
      pxPerMm={pxPerMm}
      coordinateGrid={coordinateGrid}
      {...(onMove ? { onMove } : {})}
      {...(onRotate ? { onRotate } : {})}
      {...(route
        ? {
            routeActive: route.active,
            padBoxes: route.padBoxes,
            onRouteClick: route.onClick,
            onRouteMove: route.onMove,
            viaActive: route.viaActive,
            onViaClick: route.onViaClick,
            ...(route.pendingPoints ? { pendingPoints: route.pendingPoints } : {}),
            ...(route.cursor !== undefined ? { routeCursor: route.cursor } : {}),
            ...(route.color ? { routeColor: route.color } : {}),
          }
        : {})}
    />
  )
}

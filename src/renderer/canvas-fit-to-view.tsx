/**
 * Fit to View on the schematic canvas: the button in the canvas's zoom controls and the hook App's F key
 * calls. Frames every visible part with the shared bounds-fit (fit-bounds.ts); an empty sheet resets to
 * the default zoom (1:1 at the origin).
 */
import { ControlButton, useReactFlow, useStore, useStoreApi } from '@xyflow/react'
import { useCallback } from 'react'
import { fitBounds } from './fit-bounds.ts'
import { HelpTip } from './tooltip.tsx'

export const CANVAS_DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 } as const
/** The most a fit zooms in, so one small part doesn't fill the whole pane. */
const FIT_MAX_ZOOM = 2

const rectToBox = (r: { x: number; y: number; width: number; height: number }) => ({
  x: r.x,
  y: r.y,
  w: r.width,
  h: r.height,
})

export function useCanvasFitToView(): () => void {
  const { getNodes, getNodesBounds, setViewport } = useReactFlow()
  const store = useStoreApi()
  return useCallback(() => {
    const { width, height, minZoom, maxZoom } = store.getState()
    const shown = getNodes().filter((n) => !n.hidden)
    const fit =
      shown.length === 0
        ? null
        : fitBounds(rectToBox(getNodesBounds(shown)), width, height, {
            margin: 0.08,
            minScale: minZoom,
            maxScale: Math.min(FIT_MAX_ZOOM, maxZoom),
          })
    void setViewport(
      fit === null ? CANVAS_DEFAULT_VIEWPORT : { x: fit.offsetX, y: fit.offsetY, zoom: fit.scale },
    )
  }, [getNodes, getNodesBounds, setViewport, store])
}

export function CanvasFitToViewButton() {
  const fit = useCanvasFitToView()
  // The live zoom, so a check can see the fit land (only this button re-renders on zoom).
  const zoom = useStore((s) => Math.round(s.transform[2] * 1000) / 1000)
  return (
    <HelpTip helpId="canvas.fitView">
      <span>
        <ControlButton
          onClick={fit}
          aria-label="Fit to View"
          data-testid="canvas-fit-to-view"
          data-zoom={zoom}
        >
          ⛶
        </ControlButton>
      </span>
    </HelpTip>
  )
}

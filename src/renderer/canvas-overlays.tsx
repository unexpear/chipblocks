/**
 * Connect / wire-tool canvas overlays — the SVG + button markers the wire and connect tools draw over the
 * React Flow canvas: the rubber-band wire-in-progress, the connectable dot on every handle, and the queued
 * start→end pairs (Batch mode). All prop-driven (no editor state), rendered by Canvas; lifted out of the
 * App.tsx hub. They read each handle's absolute position from React Flow's useInternalNode, as they always
 * did. `PendingWirePreview`, `ConnectPointsOverlay`, and the `ConnectAnchor` type are what Canvas uses; the
 * rest are internal to this file.
 */

import { useInternalNode, ViewportPortal } from '@xyflow/react'
import { THEME } from './theme.ts'
import { roundedPathD } from './wire-path.ts'
/**
 * The wire-in-progress (click-by-click drawing): a dashed route from the start
 * anchor (a terminal dot, or a free point in space) through the clicked
 * corners to the cursor — sharp or rounded to match the active subtool. Pinned
 * in flow coordinates so it pans/zooms with the canvas.
 */
export function PendingWirePreview({
  pending,
  cursor,
  curved,
  curveRadius,
}: {
  pending: {
    start: { nodeId: string; handleId: string } | { x: number; y: number }
    corners: { id: string; x: number; y: number }[]
  }
  cursor: { x: number; y: number } | null
  curved: boolean
  curveRadius: number
}) {
  const start = pending.start
  const anchoredToNode = 'nodeId' in start
  const node = useInternalNode(anchoredToNode ? start.nodeId : '__free_point__')
  let origin: { x: number; y: number } | null = null
  if (anchoredToNode) {
    const handle = node?.internals.handleBounds?.source?.find((h) => h.id === start.handleId)
    if (node && handle) {
      origin = {
        x: node.internals.positionAbsolute.x + handle.x + handle.width / 2,
        y: node.internals.positionAbsolute.y + handle.y + handle.height / 2,
      }
    }
  } else {
    origin = start
  }
  if (origin === null) return null
  const points = [origin, ...pending.corners, ...(cursor !== null ? [cursor] : [])]
  const path = curved
    ? roundedPathD(points, curveRadius)
    : points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ')
  return (
    <ViewportPortal>
      {/* biome-ignore lint/a11y/noSvgWithoutTitle: decorative rubber-band preview, hidden from the accessibility tree */}
      <svg
        width={1}
        height={1}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          overflow: 'visible',
          pointerEvents: 'none',
        }}
        aria-hidden
      >
        <path d={path} fill="none" stroke={THEME.wire} strokeWidth={1.6} strokeDasharray="6 4" />
        {pending.corners.map((c) => (
          <circle
            key={c.id}
            cx={c.x}
            cy={c.y}
            r={3.5}
            fill={THEME.accentBlue}
            stroke={THEME.surfaceDeep}
          />
        ))}
        <circle
          cx={origin.x}
          cy={origin.y}
          r={4}
          fill="none"
          stroke={THEME.accentBlue}
          strokeWidth={1.5}
        />
      </svg>
    </ViewportPortal>
  )
}

export type ConnectAnchor = { nodeId: string; handleId: string }

/**
 * Connect tool — the dots for every point you can wire to. Mirrors PendingWirePreview's trick of
 * reading each handle's absolute position from useInternalNode. One marker per handle (part pin,
 * block port, junction); clicking it picks that point (first = start, second = end). The pending
 * start lights up; queued pairs (Batch mode) are drawn as faint dashed lines so you can see what's
 * about to route before you press Route all.
 */
export function ConnectPointsOverlay({
  nodes,
  start,
  queue,
  onPick,
}: {
  nodes: { id: string }[]
  start: ConnectAnchor | null
  queue: { from: ConnectAnchor; to: ConnectAnchor }[]
  onPick: (nodeId: string, handleId: string) => void
}) {
  return (
    <ViewportPortal>
      {/* biome-ignore lint/a11y/noSvgWithoutTitle: decorative queued-pair preview lines */}
      <svg
        width={1}
        height={1}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          overflow: 'visible',
          pointerEvents: 'none',
        }}
        aria-hidden
      >
        {queue.map((pair) => (
          <QueuedConnectLine
            key={`${pair.from.nodeId}:${pair.from.handleId}>${pair.to.nodeId}:${pair.to.handleId}`}
            from={pair.from}
            to={pair.to}
          />
        ))}
      </svg>
      {nodes.map((n) => (
        <NodeConnectPoints key={n.id} nodeId={n.id} start={start} onPick={onPick} />
      ))}
    </ViewportPortal>
  )
}

/** Absolute flow position of one handle on a node (its centre), or null if not measured yet. */
function connectHandlePos(
  node: ReturnType<typeof useInternalNode>,
  handleId: string,
): { x: number; y: number } | null {
  const bounds = node?.internals.handleBounds
  const handle =
    bounds?.source?.find((h) => h.id === handleId) ?? bounds?.target?.find((h) => h.id === handleId)
  if (!node || !handle) return null
  return {
    x: node.internals.positionAbsolute.x + handle.x + handle.width / 2,
    y: node.internals.positionAbsolute.y + handle.y + handle.height / 2,
  }
}

/** Every connectable dot for one node — one clickable marker per handle. */
function NodeConnectPoints({
  nodeId,
  start,
  onPick,
}: {
  nodeId: string
  start: ConnectAnchor | null
  onPick: (nodeId: string, handleId: string) => void
}) {
  const node = useInternalNode(nodeId)
  const bounds = node?.internals.handleBounds
  if (!node || !bounds) return null
  const seen = new Set<string>()
  const handles = [...(bounds.source ?? []), ...(bounds.target ?? [])].filter((h) => {
    if (h.id === null || h.id === undefined || seen.has(h.id)) return false
    seen.add(h.id)
    return true
  })
  return (
    <>
      {handles.map((h) => {
        const handleId = h.id as string
        const x = node.internals.positionAbsolute.x + h.x + h.width / 2
        const y = node.internals.positionAbsolute.y + h.y + h.height / 2
        const isStart = start?.nodeId === nodeId && start?.handleId === handleId
        return (
          <button
            type="button"
            key={handleId}
            className="nodrag nopan"
            title={`Connect: ${nodeId} · ${handleId}`}
            onClick={(event) => {
              event.stopPropagation()
              onPick(nodeId, handleId)
            }}
            style={{
              position: 'absolute',
              left: x - 7,
              top: y - 7,
              width: 14,
              height: 14,
              padding: 0,
              borderRadius: '50%',
              background: isStart ? THEME.accentBlue : 'rgba(56,139,253,0.22)',
              border: `2px solid ${isStart ? THEME.accentBlueBright : THEME.accentBlue}`,
              cursor: 'pointer',
              boxShadow: isStart ? '0 0 0 3px rgba(56,139,253,0.35)' : 'none',
            }}
          />
        )
      })}
    </>
  )
}

/** One queued start→end pair, drawn as a faint dashed line (Batch mode preview). */
function QueuedConnectLine({ from, to }: { from: ConnectAnchor; to: ConnectAnchor }) {
  const fromNode = useInternalNode(from.nodeId)
  const toNode = useInternalNode(to.nodeId)
  const a = connectHandlePos(fromNode, from.handleId)
  const b = connectHandlePos(toNode, to.handleId)
  if (a === null || b === null) return null
  return (
    <line
      x1={a.x}
      y1={a.y}
      x2={b.x}
      y2={b.y}
      stroke={THEME.statusOk}
      strokeWidth={1.6}
      strokeDasharray="5 4"
    />
  )
}

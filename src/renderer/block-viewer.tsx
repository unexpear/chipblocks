import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  ViewportPortal,
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BlockData } from './blocks.ts'
import type { Point } from './net-edge.tsx'
import { type Box, type Dir, orthogonalRoute, routesOverlap } from './orthogonal-route.ts'
import { nodeTypes } from './symbols.tsx'
import { THEME } from './theme.ts'
import { findWireCrossings, WireCrossingsOverlay } from './wire-crossings.tsx'

/**
 * The descend view (S19-v3-67): double-click a block and see the REAL circuit inside — the same
 * symbols, the same parts, in their grouped layout, read-only. Editing goes through Ungroup.
 *
 * The internal WIRES are drawn by us (DescendWires), not by React Flow. React Flow won't measure these
 * statically-built nodes (their `measured` stays empty, so it can't place edges) — so we read each pin's
 * REAL on-screen position, route every wire AROUND the parts with the orthogonal auto-router (which can
 * never cut through a part), and draw the wire directly. The wire geometry also feeds the crossing
 * markers — open dot = "crossing, NOT connected".
 */

const NO_EDGES: never[] = []

/** Which edge of its part a pin sits on = the direction a wire leaves it (perpendicular to that edge). */
const edgeDir = (p: Point, box: Box): Dir => {
  const dl = p.x - box.x
  const dr = box.x + box.w - p.x
  const dt = p.y - box.y
  const db = box.y + box.h - p.y
  const m = Math.min(dl, dr, dt, db)
  return m === dl ? 'left' : m === dr ? 'right' : m === dt ? 'up' : 'down'
}

type DescendWire = {
  id: string
  source: string
  sourceHandle?: string | null
  target: string
  targetHandle?: string | null
}

/**
 * Draw the block's internal wires ourselves. We read each part's box and each pin's centre straight
 * from the DOM (React Flow won't measure these nodes, so its own positions are empty), convert them to
 * flow coordinates, route every wire AROUND the parts with the orthogonal router (never through one),
 * and render the routes as SVG in a ViewportPortal so they pan/zoom with the parts. Each route is also
 * reported up for the crossing markers. Flow coordinates are viewport-independent, so we compute once.
 */
function DescendWires({
  wires,
  fitBox,
  light,
  onGeom,
}: {
  wires: DescendWire[]
  fitBox: { x: number; y: number; width: number; height: number }
  light: boolean
  onGeom: (id: string, pts: Point[]) => void
}) {
  const { screenToFlowPosition, setViewport } = useReactFlow()
  const pane = useStore((s) => (s as { domNode?: HTMLElement | null }).domNode)
  const [routes, setRoutes] = useState<{ id: string; pts: Point[] }[]>([])
  useEffect(() => {
    if (!pane) return
    // Don't gate on useNodesInitialized — React Flow never measures these nodes, so it never reports
    // "initialized". The pins ARE in the DOM once the nodes render, so we just wait a couple of frames
    // for layout, then read their real positions.
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const flowCenter = (el: Element): Point => {
          const r = el.getBoundingClientRect()
          return screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
        }
        const boxOf = (id: string): (Box & { id: string }) | null => {
          const el = pane.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`)
          if (!el) return null
          const r = el.getBoundingClientRect()
          const tl = screenToFlowPosition({ x: r.left, y: r.top })
          const br = screenToFlowPosition({ x: r.right, y: r.bottom })
          return { id, x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y }
        }
        const pinOf = (nodeId: string, handleId?: string | null): Point | null => {
          const node = `.react-flow__node[data-id="${CSS.escape(nodeId)}"]`
          const el = handleId
            ? pane.querySelector(
                `${node} .react-flow__handle[data-handleid="${CSS.escape(handleId)}"]`,
              )
            : pane.querySelector(`${node} .react-flow__handle`)
          return el ? flowCenter(el) : null
        }
        const allBoxes = [...pane.querySelectorAll('.react-flow__node[data-id]')]
          .map((el) => boxOf(el.getAttribute('data-id') as string))
          .filter((b): b is Box & { id: string } => b !== null)
        const out: { id: string; pts: Point[] }[] = []
        const placed: Point[][] = []
        wires.forEach((w) => {
          const from = pinOf(w.source, w.sourceHandle)
          const to = pinOf(w.target, w.targetHandle)
          const fromBox = boxOf(w.source)
          const toBox = boxOf(w.target)
          if (!from || !to || !fromBox || !toBox) return
          const obstacles = allBoxes.filter((b) => b.id !== w.source && b.id !== w.target)
          const fromDir = edgeDir(from, fromBox)
          const toDir = edgeDir(to, toBox)
          // Real space for wires: take the first lane whose route doesn't run on top of a wire already
          // placed. The lane offset shifts the routing channel, so a clashing wire steps into the next
          // free track instead of overlapping — a clean wire (no clash) just stays in lane 0.
          let pts: Point[] = []
          for (let lane = 0; lane < 12; lane++) {
            pts = [from, ...orthogonalRoute(from, fromDir, to, toDir, obstacles, { lane }), to]
            if (!placed.some((q) => routesOverlap(pts, q))) break
          }
          placed.push(pts)
          out.push({ id: w.id, pts })
          onGeom(w.id, pts)
        })
        setRoutes(out)
        // Frame the whole block from its own layout — React Flow can't fitView these unmeasured nodes, so
        // we compute the zoom + pan to fit `fitBox` in the pane ourselves (deterministic). The wires above
        // are in flow coords, so they re-frame with it.
        const pw = pane.clientWidth || 1
        const ph = pane.clientHeight || 1
        const zoom = Math.min(pw / fitBox.width, ph / fitBox.height, 1.5) * 0.9
        const cx = fitBox.x + fitBox.width / 2
        const cy = fitBox.y + fitBox.height / 2
        setViewport({ x: pw / 2 - cx * zoom, y: ph / 2 - cy * zoom, zoom })
      })
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [pane, wires, fitBox, screenToFlowPosition, setViewport, onGeom])
  const stroke = light ? THEME.borderStrong : THEME.textSoft
  return (
    <ViewportPortal>
      {/* One SVG at the flow origin; the polylines use flow coords and ride the viewport transform. */}
      {/* biome-ignore lint/a11y/noSvgWithoutTitle: decorative wire overlay, hidden from the a11y tree */}
      <svg
        aria-hidden
        width={1}
        height={1}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          overflow: 'visible',
          pointerEvents: 'none',
        }}
      >
        {routes.map((r) => (
          <polyline
            key={r.id}
            points={r.pts.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke={stroke}
            strokeWidth={1.6}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
      </svg>
    </ViewportPortal>
  )
}

export function BlockViewer({
  block,
  onUngroup,
  onClose,
  light,
}: {
  block: BlockData
  onUngroup: () => void
  onClose: () => void
  light: boolean
}) {
  const border = light ? `1px solid ${THEME.textPrimary}` : `1px solid ${THEME.borderSubtle}`
  // Each drawn wire reports its routed path here; where two cross (and don't share a node) we mark the
  // schematic open dot — "crossing, NOT connected" — exactly like the main canvas.
  const [wireGeoms, setWireGeoms] = useState(new Map<string, Point[]>())
  const reportWireGeom = useCallback((wireId: string, points: Point[]) => {
    setWireGeoms((prev) => {
      const next = new Map(prev)
      next.set(wireId, points)
      return next
    })
  }, [])
  const crossings = useMemo(
    () =>
      findWireCrossings(
        wireGeoms,
        block.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
      ),
    [wireGeoms, block.edges],
  )
  const wires = useMemo<DescendWire[]>(
    () =>
      block.edges.map((e) => ({
        id: e.id,
        source: e.source,
        sourceHandle: e.sourceHandle,
        target: e.target,
        targetHandle: e.targetHandle,
      })),
    [block],
  )
  // The frame for the view, from the block's own part layout (positions are part top-lefts; pad for the
  // parts' sizes + breathing room). Used because React Flow can't fitView these unmeasured nodes.
  const fitBox = useMemo(() => {
    const xs = block.nodes.map((n) => n.x)
    const ys = block.nodes.map((n) => n.y)
    const minX = Math.min(0, ...xs)
    const minY = Math.min(0, ...ys)
    const maxX = Math.max(0, ...xs)
    const maxY = Math.max(0, ...ys)
    return { x: minX - 40, y: minY - 40, width: maxX - minX + 200, height: maxY - minY + 160 }
  }, [block])
  const nodes = useMemo(
    () =>
      block.nodes.map((n) => ({
        id: n.id,
        type: n.block ? 'block' : n.definition === 'junction' ? 'junction' : 'device',
        position: { x: n.x, y: n.y },
        draggable: false,
        selectable: false,
        data: {
          definition: n.definition,
          label: n.block ? n.block.name : n.id,
          ...(n.rotation ? { rotation: n.rotation } : {}),
          ...(n.parameters ? { parameters: n.parameters } : {}),
          ...(n.block ? { block: n.block } : {}),
        },
      })),
    [block],
  )

  return (
    <div
      className="nodrag nopan"
      style={{
        position: 'absolute',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 58,
        width: 640,
        height: 440,
        display: 'flex',
        flexDirection: 'column',
        background: light ? THEME.textBright : THEME.surfaceBase,
        border,
        borderRadius: 8,
        boxShadow: '0 10px 32px rgba(0,0,0,0.5)',
        padding: 12,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        color: light ? THEME.borderSubtle : THEME.textPrimary,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{block.name} — inside the block</div>
        <span style={{ color: light ? THEME.textFaint : THEME.textMuted, fontSize: 11 }}>
          the real parts; the solver computes THESE every time
        </span>
        <button
          type="button"
          onClick={onUngroup}
          title="Explode the block back into its parts on the canvas (edit, then group again)"
          style={viewerButton(light)}
        >
          ⧉ Ungroup
        </button>
        <button type="button" onClick={onClose} style={{ ...viewerButton(light), marginLeft: 4 }}>
          ✕ Close
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, border, borderRadius: 6, overflow: 'hidden' }}>
        <ReactFlowProvider>
          {/* No `fitView` — React Flow can't fit these unmeasured nodes (it zooms to one part). We frame
              the view ourselves from the block's layout (DescendWires → fitBounds(fitBox)). */}
          <ReactFlow
            nodes={nodes}
            edges={NO_EDGES}
            nodeTypes={nodeTypes}
            colorMode={light ? 'light' : 'dark'}
            minZoom={0.001}
            maxZoom={1000}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            zoomOnDoubleClick={false}
            proOptions={{ hideAttribution: true }}
          >
            {/* We draw the internal wires (React Flow won't measure these nodes), routed AROUND the
                parts; DescendWires also frames the view (fitBounds). The open-dot markers flag where
                two wires cross without connecting. */}
            <DescendWires wires={wires} fitBox={fitBox} light={light} onGeom={reportWireGeom} />
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
            <WireCrossingsOverlay crossings={crossings} onJoin={() => {}} light={light} readOnly />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
      <div style={{ color: light ? THEME.textFaint : THEME.textMuted, fontSize: 10, marginTop: 6 }}>
        Ports:{' '}
        {block.ports.map((p) => p.label).join(' · ') || 'none — nothing wired across the boundary'}
      </div>
    </div>
  )
}

function viewerButton(light: boolean): React.CSSProperties {
  return {
    marginLeft: 'auto',
    padding: '3px 10px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 11,
    background: light ? THEME.white : THEME.surfaceRaised,
    border: light ? `1px solid ${THEME.textPrimary}` : `1px solid ${THEME.borderSubtle}`,
    color: light ? THEME.borderStrong : THEME.textSoft,
  }
}

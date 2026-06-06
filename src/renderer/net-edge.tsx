import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getBezierPath } from '@xyflow/react'

/**
 * Net edge (Sprint 18 polish). A bezier wire plus an optional net-id chip that
 * is lifted clear of the symbol row.
 *
 * React Flow's built-in edge label sits at the exact path midpoint, which in
 * the deterministic grid layout lands on top of whatever symbol the wire passes
 * through (the `net_battery_neg`-on-the-switch overlap). Rendering the chip
 * ourselves via EdgeLabelRenderer lets us nudge it above the wire so it never
 * covers a symbol. The chip renders only when `label` is set — world-to-flow
 * marks exactly one edge per net (FlowEdge.showLabel), so a multi-spoke net no
 * longer repeats its name on every spoke.
 */
const LABEL_LIFT = 26

export function NetEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  style,
}: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })
  return (
    <>
      <BaseEdge id={id} path={path} style={style} />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - LABEL_LIFT}px)`,
              background: '#0c0c0e',
              border: '1px solid #3a3a3f',
              borderRadius: 3,
              padding: '3px 5px',
              fontSize: 9,
              fontFamily: 'system-ui, sans-serif',
              color: '#cdd6e0',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}

export const edgeTypes = { net: NetEdge }

import { useViewport } from '@xyflow/react'
import { THEME } from './theme.ts'

/**
 * Coordinate-graph overlay: the x and y axes through the origin (flow 0,0), the four
 * quadrants (numbered I–IV in the usual layout), and the origin marker — drawn behind
 * the parts as a placement reference on top of the graph-paper grid. It tracks the
 * viewport, so the origin stays pinned to the same spot under the circuit as you pan
 * and zoom. Purely visual: it reads nothing from the circuit and changes nothing.
 *
 * Axis lines are drawn in screen space (a constant 1.5 px weight at any zoom) at the
 * origin's current screen position — flow (0,0) lands at the viewport translate (x, y).
 * The labels scale with the zoom, so they shrink with the circuit when you zoom out
 * instead of looming large at a fixed pixel size.
 */
export function CoordinateAxes({ light }: { light: boolean }) {
  const { x, y, zoom } = useViewport()
  const axisStroke = light ? THEME.textSoft : THEME.borderStrong
  const ink = light ? THEME.textMuted : THEME.textFaint
  // The axes must span the canvas at any pan; a huge half-length around the origin
  // covers it, and the SVG clips to the pane bounds.
  const SPAN = 1_000_000
  // Label size + placement follow the zoom so they shrink with the circuit when you zoom
  // out. Capped at 1 (the base size) so zooming in keeps them readable, never oversized.
  const labelScale = Math.min(1, zoom)
  return (
    <svg
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 0,
      }}
    >
      <title>coordinate axes</title>
      <line x1={x - SPAN} y1={y} x2={x + SPAN} y2={y} stroke={axisStroke} strokeWidth={1.5} />
      <line x1={x} y1={y - SPAN} x2={x} y2={y + SPAN} stroke={axisStroke} strokeWidth={1.5} />
      <circle cx={x} cy={y} r={3} fill="none" stroke={axisStroke} strokeWidth={1.5} />
      {/* quadrant numerals — math layout: I upper-right, going counter-clockwise */}
      <g
        fill={ink}
        fontFamily="Georgia, 'Times New Roman', serif"
        fontSize={13 * labelScale}
        fontStyle="italic"
      >
        <text x={x + 30 * labelScale} y={y - 22 * labelScale}>
          I
        </text>
        <text x={x - 38 * labelScale} y={y - 22 * labelScale}>
          II
        </text>
        <text x={x - 42 * labelScale} y={y + 32 * labelScale}>
          III
        </text>
        <text x={x + 30 * labelScale} y={y + 32 * labelScale}>
          IV
        </text>
      </g>
      {/* axis name labels, on the positive ends near the origin */}
      <g
        fill={ink}
        fontFamily="system-ui, sans-serif"
        fontSize={12 * labelScale}
        fontStyle="italic"
      >
        <text x={x + 64 * labelScale} y={y - 7 * labelScale}>
          x
        </text>
        <text x={x + 7 * labelScale} y={y - 60 * labelScale}>
          y
        </text>
      </g>
    </svg>
  )
}

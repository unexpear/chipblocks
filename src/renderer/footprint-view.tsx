import { type Footprint, footprintBounds, type Pad } from './footprint.ts'

/**
 * A footprint viewer — draws a physical package the way an EDA tool does: gold copper pads, the white
 * silkscreen outline, and the courtyard keep-out (dashed, magenta, KiCad's convention). Pure geometry
 * from footprint.ts scaled mm → px; it reads nothing from the circuit. The origin cross marks the
 * footprint centre (pin 1 is squared off, the board convention for finding orientation).
 */

// Real-PCB colours (a footprint reads as itself regardless of the app theme).
const COPPER = '#d9a441' // ENIG-gold pad
const COPPER_EDGE = '#b5852b'
const SILK = '#e8eaed'
const COURTYARD = '#a06ad8' // magenta keep-out, the KiCad convention
const BOARD = '#0c0c0e'
const ORIGIN = '#5b5b62'
const PAD_INK = '#241a06'

export function FootprintView({
  footprint,
  pxPerMm = 44,
  paddingMm = 0.45,
  showLabels = true,
}: {
  footprint: Footprint
  pxPerMm?: number
  /** Blank margin around the courtyard, in mm. */
  paddingMm?: number
  showLabels?: boolean
}) {
  const b = footprintBounds(footprint)
  const minX = b.minX - paddingMm
  const minY = b.minY - paddingMm
  const wPx = (b.maxX - b.minX + 2 * paddingMm) * pxPerMm
  const hPx = (b.maxY - b.minY + 2 * paddingMm) * pxPerMm
  // mm (origin-centred) → svg px.
  const sx = (x: number) => (x - minX) * pxPerMm
  const sy = (y: number) => (y - minY) * pxPerMm
  const mm = (n: number) => n * pxPerMm

  const padShape = (p: Pad) => {
    const w = mm(p.size.w)
    const h = mm(p.size.h)
    const cx = sx(p.center.x)
    const cy = sy(p.center.y)
    if (p.shape === 'circle') {
      return (
        <circle
          cx={cx}
          cy={cy}
          r={Math.min(w, h) / 2}
          fill={COPPER}
          stroke={COPPER_EDGE}
          strokeWidth={1}
        />
      )
    }
    const rx =
      p.shape === 'roundrect' ? Math.min(w, h) * 0.18 : p.shape === 'oval' ? Math.min(w, h) / 2 : 0
    return (
      <rect
        x={cx - w / 2}
        y={cy - h / 2}
        width={w}
        height={h}
        rx={rx}
        ry={rx}
        fill={COPPER}
        stroke={COPPER_EDGE}
        strokeWidth={1}
      />
    )
  }

  return (
    <svg
      width={wPx}
      height={hPx}
      viewBox={`0 0 ${wPx} ${hPx}`}
      style={{ display: 'block', fontFamily: 'system-ui, sans-serif' }}
      role="img"
      aria-label={`${footprint.name} footprint`}
    >
      <title>{`${footprint.name} — ${footprint.id}`}</title>
      <rect x={0} y={0} width={wPx} height={hPx} fill={BOARD} rx={4} />

      {/* courtyard keep-out */}
      <rect
        x={sx(footprint.courtyard.x)}
        y={sy(footprint.courtyard.y)}
        width={mm(footprint.courtyard.w)}
        height={mm(footprint.courtyard.h)}
        fill="none"
        stroke={COURTYARD}
        strokeWidth={1}
        strokeDasharray="4 3"
        opacity={0.75}
      />

      {/* through-hole drills sit under their pad; draw the pad, then the hole */}
      {footprint.pads.map((p) => (
        <g key={`pad-${p.id}`}>
          {padShape(p)}
          {p.type === 'through_hole' && p.holeDiameter !== undefined ? (
            <circle
              cx={sx(p.center.x)}
              cy={sy(p.center.y)}
              r={mm(p.holeDiameter) / 2}
              fill={BOARD}
            />
          ) : null}
          {showLabels ? (
            <text
              x={sx(p.center.x)}
              y={sy(p.center.y)}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={Math.min(mm(p.size.h) * 0.5, 12)}
              fontWeight={700}
              fill={PAD_INK}
            >
              {p.id}
            </text>
          ) : null}
        </g>
      ))}

      {/* silkscreen outline */}
      {footprint.silkscreen.map((s, i) => (
        <line
          key={`silk-${i}-${s.from.x}-${s.from.y}`}
          x1={sx(s.from.x)}
          y1={sy(s.from.y)}
          x2={sx(s.to.x)}
          y2={sy(s.to.y)}
          stroke={SILK}
          strokeWidth={Math.max(1, mm(s.width))}
          strokeLinecap="round"
        />
      ))}

      {/* origin cross (footprint centre) */}
      <g stroke={ORIGIN} strokeWidth={1} opacity={0.7}>
        <line x1={sx(0) - 5} y1={sy(0)} x2={sx(0) + 5} y2={sy(0)} />
        <line x1={sx(0)} y1={sy(0) - 5} x2={sx(0)} y2={sy(0) + 5} />
      </g>
    </svg>
  )
}

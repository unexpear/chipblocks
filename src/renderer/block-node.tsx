import { Handle, type NodeProps, Position } from '@xyflow/react'
import { type CSSProperties, Fragment, useContext } from 'react'
import { type BlockData, type BlockPort, blockLayout } from './blocks.ts'
import { HealthContext } from './health.ts'
import { THEME } from './theme.ts'

/**
 * A circuit block on the canvas (S19-v3-67) — ONE node showing its name + its pins, like a chip
 * package: pins sit on the FOUR edges (blockLayout centers them per edge, so they always stay on the
 * perimeter), and power pins are marked +/− in red/blue exactly as a real chip marks its supply pins.
 * The real parts live inside (double-click to descend); the solver always works on those, never the box.
 */

const POS: Record<BlockPort['side'], Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
}

/** A power pin's colour + marker; a signal pin is a neutral dot with no marker (no false polarity). */
function pinLook(kind: BlockPort['kind']): { color: string; glyph: string } {
  if (kind === 'power_positive') return { color: THEME.statusDanger, glyph: '+' }
  if (kind === 'power_negative') return { color: THEME.accentBlueDeep, glyph: '−' }
  return { color: THEME.textMuted, glyph: '' }
}

/** The pin's label position just INSIDE the box, next to its handle on whichever edge it's on. */
function labelStyle(side: BlockPort['side'], coord: number): CSSProperties {
  if (side === 'left') return { left: 5, top: coord, transform: 'translateY(-50%)' }
  if (side === 'right')
    return { right: 5, top: coord, transform: 'translateY(-50%)', textAlign: 'right' }
  if (side === 'top') return { top: 4, left: coord, transform: 'translateX(-50%)' }
  return { bottom: 4, left: coord, transform: 'translateX(-50%)' }
}

export function BlockNode({ id, data }: NodeProps) {
  const block = (data as { block?: BlockData }).block
  const health = useContext(HealthContext).get(id)
  if (!block) return null
  const { width, height, placed } = blockLayout(block.ports)
  return (
    <div
      className={health?.failed ? 'cb-shake' : undefined}
      title={`${block.name} — a circuit block (${block.nodes.length} parts inside, ${block.ports.length} pins). Double-click to see the real circuit it is made of.`}
      style={{ position: 'relative', width, height, fontFamily: 'system-ui, sans-serif' }}
    >
      {health?.failed ? <div className="cb-danger" /> : null}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          border: health?.failed
            ? `1.5px solid ${THEME.statusDanger}`
            : `1.5px solid ${THEME.textMuted}`,
          borderRadius: 6,
          background: THEME.surfacePanel,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ color: THEME.textBright, fontSize: 11, fontWeight: 700 }}>{block.name}</span>
      </div>
      {placed.map(({ port, side, coord }) => {
        const look = pinLook(port.kind)
        const onSide = side === 'left' || side === 'right'
        const polarity =
          port.kind === 'power_positive'
            ? ' (+ power)'
            : port.kind === 'power_negative'
              ? ' (− power)'
              : ''
        const text = `${look.glyph}${look.glyph && port.name ? ' ' : ''}${port.name ?? ''}`
        return (
          <Fragment key={port.id}>
            <Handle
              id={port.id}
              type="source"
              position={POS[side]}
              title={`${port.name ?? port.label}${polarity} — this pin IS the internal terminal ${port.label}`}
              style={{
                ...(onSide ? { top: coord } : { left: coord }),
                background: look.color,
                width: 9,
                height: 9,
              }}
            />
            {text ? (
              <div
                style={{
                  position: 'absolute',
                  ...labelStyle(side, coord),
                  fontSize: 8,
                  fontWeight: 600,
                  color: look.color,
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                }}
              >
                {text}
              </div>
            ) : null}
          </Fragment>
        )
      })}
      <div
        style={{
          position: 'absolute',
          top: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          color: THEME.textMuted,
          fontSize: 9,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}
      >
        {String((data as { label?: string }).label ?? id)}
        {health?.failed ? (
          <span title={health.note} style={{ marginLeft: 5 }}>
            💥
          </span>
        ) : null}
      </div>
    </div>
  )
}

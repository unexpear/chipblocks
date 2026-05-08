/**
 * Block palette — left-side sidebar that lets the user drag a new block
 * onto the canvas. Each entry is `draggable`; the dragged data carries
 * the block `type` string. The canvas (in App.tsx) handles `onDrop` and
 * spawns a new node at the drop location with default parameters.
 */

import type { CSSProperties, DragEvent } from 'react'

export const PALETTE_DRAG_TYPE = 'application/chipblocks-block-type'

export interface PaletteEntry {
  type: string
  label: string
  color: string
  description: string
}

// Order matches the canvas display border colors set in App.css.
// New block types should be appended here as they're added to BLOCK_REGISTRY.
export const PALETTE: PaletteEntry[] = [
  { type: 'oscillator', label: 'Oscillator', color: '#4caf50', description: 'Square wave source' },
  { type: 'triangle',   label: 'Triangle',   color: '#ffc107', description: 'Triangle wave source' },
  { type: 'sawtooth',   label: 'Sawtooth',   color: '#9c27b0', description: 'Sawtooth wave source' },
  { type: 'mixer',      label: 'Mixer',      color: '#2196f3', description: 'Average two audio inputs' },
  { type: 'adsr',       label: 'ADSR',       color: '#ff9800', description: 'Attack/Decay/Sustain/Release envelope' },
  { type: 'gate',       label: 'Gate',       color: '#00bcd4', description: 'Periodic 1-bit pulse' },
  { type: 'output',     label: 'Output',     color: '#f44336', description: 'Audio sink (where Play reads from)' },
]

// Default `data` for a freshly-spawned node. Keep in sync with each
// block's frontend node component default props.
export function defaultDataForType(type: string): Record<string, unknown> {
  switch (type) {
    case 'oscillator':
    case 'triangle':
    case 'sawtooth':
      return { freq: 440 }
    case 'adsr':
      return { attack_ms: 10, decay_ms: 100, sustain_level: 80, release_ms: 200 }
    case 'gate':
      return { rate_hz: 4, duty_pct: 50 }
    case 'mixer':
    case 'output':
    default:
      return {}
  }
}

interface PaletteProps {
  collapsed: boolean
  onToggle: () => void
}

export function Palette({ collapsed, onToggle }: PaletteProps) {
  const onDragStart = (e: DragEvent<HTMLDivElement>, type: string) => {
    e.dataTransfer.setData(PALETTE_DRAG_TYPE, type)
    e.dataTransfer.effectAllowed = 'move'
  }

  if (collapsed) {
    return (
      <aside className="palette palette-collapsed">
        <button className="palette-toggle" onClick={onToggle} title="Show palette">▶</button>
      </aside>
    )
  }

  return (
    <aside className="palette">
      <div className="palette-header">
        <span className="palette-title">Blocks</span>
        <span className="palette-spacer" />
        <button className="palette-toggle" onClick={onToggle} title="Hide palette">◀</button>
      </div>
      <div className="palette-list">
        {PALETTE.map((entry) => (
          <div
            key={entry.type}
            className="palette-item"
            draggable
            onDragStart={(e) => onDragStart(e, entry.type)}
            title={entry.description}
            style={{ '--swatch': entry.color } as CSSProperties}
          >
            <span className="palette-swatch" />
            <span className="palette-label">{entry.label}</span>
          </div>
        ))}
      </div>
      <div className="palette-footer">
        Drag onto canvas
      </div>
    </aside>
  )
}

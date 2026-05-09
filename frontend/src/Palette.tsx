/**
 * Block palette — left-side sidebar that lets the user drag a new block
 * onto the canvas. Each entry is a `<button draggable>`: keyboard users
 * can Tab to it and press Enter / Space to spawn the block at a default
 * canvas position; mouse users can still drag-and-drop to spawn at the
 * drop point. The canvas (in App.tsx) handles `onDrop` and the
 * `onAddBlock` callback handles keyboard / click activation.
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
  { type: 'sine',       label: 'Sine',       color: '#ce93d8', description: 'Sine wave source (cleanest tone)' },
  { type: 'wavetable',  label: 'Wavetable',  color: '#8bc34a', description: 'Morphable single-cycle waveform (4 preset shapes)' },
  { type: 'noise',      label: 'Noise',      color: '#795548', description: 'Pseudo-random 8-bit signed source' },
  { type: 'constant',   label: 'Constant',   color: '#9e9e9e', description: 'Fixed 8-bit signed value (-128..127)' },
  { type: 'mixer',      label: 'Mixer',      color: '#2196f3', description: 'Average two audio inputs' },
  { type: 'adsr',       label: 'ADSR',       color: '#ff9800', description: 'Attack/Decay/Sustain/Release envelope' },
  { type: 'gate',       label: 'Gate',       color: '#00bcd4', description: 'Periodic 1-bit pulse' },
  { type: 'lowpass',    label: 'Low-pass',   color: '#00897b', description: '1-pole IIR low-pass filter' },
  { type: 'highpass',   label: 'High-pass',  color: '#006064', description: '1-pole IIR high-pass filter' },
  { type: 'bandpass',   label: 'Band-pass',  color: '#5e35b1', description: '1-pole IIR band-pass filter (1-octave bandwidth)' },
  { type: 'samplehold', label: 'S & H',      color: '#607d8b', description: 'Sample-and-Hold on clock edge' },
  { type: 'fm',         label: 'FM',         color: '#e91e63', description: 'Two-operator FM voice (carrier + modulator)' },
  { type: 'multiply',   label: 'Multiply',   color: '#3f51b5', description: 'Ring modulator / VCA: (a * b) >> 7' },
  { type: 'bitcrusher', label: 'Bitcrusher', color: '#5d4037', description: 'Lo-fi bit-depth reduction (1–8 effective bits)' },
  { type: 'delay',      label: 'Delay',      color: '#7c4dff', description: 'Fixed-length delay line (1–1024 samples)' },
  { type: 'and',        label: 'AND',        color: '#0277bd', description: '1-bit logical AND (a & b)' },
  { type: 'or',         label: 'OR',         color: '#0288d1', description: '1-bit logical OR (a | b)' },
  { type: 'xor',        label: 'XOR',        color: '#039be5', description: '1-bit exclusive OR (a ^ b)' },
  { type: 'not',        label: 'NOT',        color: '#03a9f4', description: '1-bit inverter (~a)' },
  { type: 'counter',    label: 'Counter',    color: '#01579b', description: 'Wrapping counter clocked by a 1-bit signal' },
  { type: 'output',     label: 'Output',     color: '#f44336', description: 'Audio sink (where Play reads from)' },
]

// Default `data` for a freshly-spawned node. Keep in sync with each
// block's frontend node component default props.
export function defaultDataForType(type: string): Record<string, unknown> {
  switch (type) {
    case 'oscillator':
    case 'triangle':
    case 'sawtooth':
    case 'sine':
      return { freq: 440 }
    case 'adsr':
      return { attack_ms: 10, decay_ms: 100, sustain_level: 80, release_ms: 200 }
    case 'gate':
      return { rate_hz: 4, duty_pct: 50 }
    case 'lowpass':
      return { cutoff_hz: 800 }
    case 'highpass':
      return { cutoff_hz: 800 }
    case 'bandpass':
      return { center_hz: 1000 }
    case 'constant':
      return { value: 0 }
    case 'fm':
      return { carrier_freq: 440, modulator_freq: 110, mod_depth: 64 }
    case 'wavetable':
      return { freq: 440, shape: 'sine' }
    case 'bitcrusher':
      return { bits: 4 }
    case 'delay':
      return { delay_samples: 128 }
    case 'counter':
      return { max_value: 16 }
    case 'mixer':
    case 'output':
    case 'samplehold':
    case 'noise':
    case 'multiply':
    case 'and':
    case 'or':
    case 'xor':
    case 'not':
    default:
      return {}
  }
}

interface PaletteProps {
  collapsed: boolean
  onToggle: () => void
  /** Called when a palette item is activated by click / keyboard
   * (Enter or Space on a focused button). Implementations should
   * place the new node at a sensible default location. */
  onAddBlock: (type: string) => void
}

export function Palette({ collapsed, onToggle, onAddBlock }: PaletteProps) {
  const onDragStart = (e: DragEvent<HTMLButtonElement>, type: string) => {
    e.dataTransfer.setData(PALETTE_DRAG_TYPE, type)
    e.dataTransfer.effectAllowed = 'move'
  }

  if (collapsed) {
    return (
      <aside className="palette palette-collapsed">
        <button
          className="palette-toggle"
          onClick={onToggle}
          aria-label="Show palette"
          title="Show palette"
        >
          ▶
        </button>
      </aside>
    )
  }

  return (
    <aside className="palette">
      <div className="palette-header">
        <span className="palette-title">Blocks</span>
        <span className="palette-spacer" />
        <button
          className="palette-toggle"
          onClick={onToggle}
          aria-label="Hide palette"
          title="Hide palette"
        >
          ◀
        </button>
      </div>
      <div className="palette-list">
        {PALETTE.map((entry) => (
          <button
            key={entry.type}
            type="button"
            className="palette-item"
            draggable
            onDragStart={(e) => onDragStart(e, entry.type)}
            onClick={() => onAddBlock(entry.type)}
            title={entry.description}
            aria-label={`Add ${entry.label} block`}
            style={{ '--swatch': entry.color } as CSSProperties}
          >
            <span className="palette-swatch" />
            <span className="palette-label">{entry.label}</span>
          </button>
        ))}
      </div>
      <div className="palette-footer">
        Drag or click to add
      </div>
    </aside>
  )
}

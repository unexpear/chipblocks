// Bundled example graphs accessible via the toolbar's Load → Examples
// menu. Same wire format as user-saved files, kept in sync with the
// canonical copies under <repo>/examples/. The renderer imports these
// at build time so they work in dev and packaged builds without IPC.

import type { Edge } from '@xyflow/react'
import type { AppNode } from './blocks'

export interface ExampleGraph {
  id: string
  label: string
  description: string
  nodes: AppNode[]
  edges: Edge[]
}

export const EXAMPLES: ExampleGraph[] = [
  {
    id: 'two-osc-mix',
    label: 'Two oscillators mixed',
    description: 'A 440 Hz square + 660 Hz saw averaged through a mixer.',
    nodes: [
      { id: 'osc1',  type: 'oscillator', position: { x: 50,  y: 60  }, data: { freq: 440 } },
      { id: 'osc2',  type: 'sawtooth',   position: { x: 50,  y: 220 }, data: { freq: 660 } },
      { id: 'mixer', type: 'mixer',      position: { x: 400, y: 130 }, data: {} },
      { id: 'out',   type: 'output',     position: { x: 700, y: 130 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'osc1',  target: 'mixer', sourceHandle: 'audio-out', targetHandle: 'in-1' },
      { id: 'e2', source: 'osc2',  target: 'mixer', sourceHandle: 'audio-out', targetHandle: 'in-2' },
      { id: 'e3', source: 'mixer', target: 'out',   sourceHandle: 'mix-out',   targetHandle: 'audio-in' },
    ],
  },
  {
    id: 'adsr-pulse',
    label: 'ADSR-shaped pulse',
    description: 'A square wave gated by a 4 Hz pulse, shaped by an Attack/Decay/Sustain/Release envelope.',
    nodes: [
      { id: 'osc',  type: 'oscillator', position: { x: 50,  y: 60  }, data: { freq: 440 } },
      { id: 'gate', type: 'gate',       position: { x: 50,  y: 220 }, data: { rate_hz: 4, duty_pct: 50 } },
      { id: 'env',  type: 'adsr',       position: { x: 350, y: 80  }, data: { attack_ms: 20, decay_ms: 80, sustain_level: 80, release_ms: 150 } },
      { id: 'out',  type: 'output',     position: { x: 700, y: 130 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'osc',  target: 'env', sourceHandle: 'audio-out', targetHandle: 'audio-in' },
      { id: 'e2', source: 'gate', target: 'env', sourceHandle: 'gate-out',  targetHandle: 'gate'     },
      { id: 'e3', source: 'env',  target: 'out', sourceHandle: 'audio-out', targetHandle: 'audio-in' },
    ],
  },
]

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
  {
    id: 'kick-drum',
    label: 'Kick drum',
    description: 'A 60 Hz sine pulsed by a fast-decay envelope — short low-frequency thump.',
    nodes: [
      { id: 'sine', type: 'sine',   position: { x: 50,  y: 60  }, data: { freq: 60 } },
      { id: 'gate', type: 'gate',   position: { x: 50,  y: 220 }, data: { rate_hz: 2, duty_pct: 5 } },
      { id: 'env',  type: 'adsr',   position: { x: 400, y: 80  }, data: { attack_ms: 1, decay_ms: 80, sustain_level: 0, release_ms: 1 } },
      { id: 'out',  type: 'output', position: { x: 700, y: 130 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'sine', target: 'env', sourceHandle: 'audio-out', targetHandle: 'audio-in' },
      { id: 'e2', source: 'gate', target: 'env', sourceHandle: 'gate-out',  targetHandle: 'gate'     },
      { id: 'e3', source: 'env',  target: 'out', sourceHandle: 'audio-out', targetHandle: 'audio-in' },
    ],
  },
  {
    id: 'snare-drum',
    label: 'Snare drum',
    description: 'A noise burst gated by a fast-decay envelope — classic snare crack.',
    nodes: [
      { id: 'noise', type: 'noise',  position: { x: 50,  y: 60  }, data: {} },
      { id: 'gate',  type: 'gate',   position: { x: 50,  y: 220 }, data: { rate_hz: 2, duty_pct: 5 } },
      { id: 'env',   type: 'adsr',   position: { x: 400, y: 80  }, data: { attack_ms: 1, decay_ms: 60, sustain_level: 0, release_ms: 1 } },
      { id: 'out',   type: 'output', position: { x: 700, y: 130 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'noise', target: 'env', sourceHandle: 'audio-out', targetHandle: 'audio-in' },
      { id: 'e2', source: 'gate',  target: 'env', sourceHandle: 'gate-out',  targetHandle: 'gate'     },
      { id: 'e3', source: 'env',   target: 'out', sourceHandle: 'audio-out', targetHandle: 'audio-in' },
    ],
  },
  {
    id: 'bass-lead',
    label: 'Bass lead',
    description: 'A 110 Hz sawtooth low-pass filtered, then gated by a sustaining envelope — punchy bass line.',
    nodes: [
      { id: 'saw',  type: 'sawtooth', position: { x: 50,  y: 60  }, data: { freq: 110 } },
      { id: 'gate', type: 'gate',     position: { x: 50,  y: 380 }, data: { rate_hz: 2, duty_pct: 50 } },
      { id: 'lpf',  type: 'lowpass',  position: { x: 350, y: 60  }, data: { cutoff_hz: 600 } },
      { id: 'env',  type: 'adsr',     position: { x: 600, y: 80  }, data: { attack_ms: 5, decay_ms: 40, sustain_level: 100, release_ms: 100 } },
      { id: 'out',  type: 'output',   position: { x: 900, y: 130 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'saw',  target: 'lpf', sourceHandle: 'audio-out', targetHandle: 'audio-in' },
      { id: 'e2', source: 'lpf',  target: 'env', sourceHandle: 'audio-out', targetHandle: 'audio-in' },
      { id: 'e3', source: 'gate', target: 'env', sourceHandle: 'gate-out',  targetHandle: 'gate'     },
      { id: 'e4', source: 'env',  target: 'out', sourceHandle: 'audio-out', targetHandle: 'audio-in' },
    ],
  },
  {
    id: 'lofi-pad',
    label: 'Lo-fi pad',
    description: 'Two triangles a major-third apart (220 + 277 Hz), mixed and softly low-passed — sustained drone.',
    nodes: [
      { id: 'tri1',  type: 'triangle', position: { x: 50,  y: 60  }, data: { freq: 220 } },
      { id: 'tri2',  type: 'triangle', position: { x: 50,  y: 220 }, data: { freq: 277 } },
      { id: 'mixer', type: 'mixer',    position: { x: 350, y: 130 }, data: {} },
      { id: 'lpf',   type: 'lowpass',  position: { x: 600, y: 130 }, data: { cutoff_hz: 1500 } },
      { id: 'out',   type: 'output',   position: { x: 900, y: 130 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'tri1',  target: 'mixer', sourceHandle: 'audio-out', targetHandle: 'in-1'     },
      { id: 'e2', source: 'tri2',  target: 'mixer', sourceHandle: 'audio-out', targetHandle: 'in-2'     },
      { id: 'e3', source: 'mixer', target: 'lpf',   sourceHandle: 'mix-out',   targetHandle: 'audio-in' },
      { id: 'e4', source: 'lpf',   target: 'out',   sourceHandle: 'audio-out', targetHandle: 'audio-in' },
    ],
  },
  {
    id: 'arpeggio',
    label: 'Stair-stepped arpeggio',
    description: 'A slow 4 Hz sawtooth sampled by an 8 Hz clock — sample-and-hold turns the ramp into a quantized note sequence.',
    nodes: [
      { id: 'saw',  type: 'sawtooth',   position: { x: 50,  y: 60  }, data: { freq: 4 } },
      { id: 'gate', type: 'gate',       position: { x: 50,  y: 220 }, data: { rate_hz: 8, duty_pct: 50 } },
      { id: 'snh',  type: 'samplehold', position: { x: 400, y: 130 }, data: {} },
      { id: 'out',  type: 'output',     position: { x: 700, y: 130 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'saw',  target: 'snh', sourceHandle: 'audio-out', targetHandle: 'audio-in' },
      { id: 'e2', source: 'gate', target: 'snh', sourceHandle: 'gate-out',  targetHandle: 'clock'    },
      { id: 'e3', source: 'snh',  target: 'out', sourceHandle: 'audio-out', targetHandle: 'audio-in' },
    ],
  },
  {
    id: 'echo',
    label: 'Echo',
    description: 'Direct + delayed signal mixed; the delayed copy is scaled to half-amplitude via Multiply by Constant 64. Demonstrates Delay + Multiply + Mixer composition.',
    nodes: [
      { id: 'src',   type: 'oscillator', position: { x: 50,   y: 60  }, data: { freq: 220 } },
      { id: 'delay', type: 'delay',      position: { x: 350,  y: 220 }, data: { delay_samples: 256 } },
      { id: 'scale', type: 'constant',   position: { x: 350,  y: 380 }, data: { value: 64 } },
      { id: 'wet',   type: 'multiply',   position: { x: 600,  y: 300 }, data: {} },
      { id: 'mix',   type: 'mixer',      position: { x: 850,  y: 180 }, data: {} },
      { id: 'out',   type: 'output',     position: { x: 1100, y: 180 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'src',   target: 'mix',   sourceHandle: 'audio-out', targetHandle: 'in-1'     },
      { id: 'e2', source: 'src',   target: 'delay', sourceHandle: 'audio-out', targetHandle: 'audio-in' },
      { id: 'e3', source: 'delay', target: 'wet',   sourceHandle: 'audio-out', targetHandle: 'in-1'     },
      { id: 'e4', source: 'scale', target: 'wet',   sourceHandle: 'audio-out', targetHandle: 'in-2'     },
      { id: 'e5', source: 'wet',   target: 'mix',   sourceHandle: 'audio-out', targetHandle: 'in-2'     },
      { id: 'e6', source: 'mix',   target: 'out',   sourceHandle: 'mix-out',   targetHandle: 'audio-in' },
    ],
  },
  {
    id: 'lofi-crunch',
    label: 'Lo-fi crunch',
    description: 'A 220 Hz sawtooth bit-crushed to 3 effective bits, then softened with a low-pass at 2 kHz — gritty retro tone.',
    nodes: [
      { id: 'saw',    type: 'sawtooth',   position: { x: 50,  y: 130 }, data: { freq: 220 } },
      { id: 'crunch', type: 'bitcrusher', position: { x: 350, y: 130 }, data: { bits: 3 } },
      { id: 'smooth', type: 'lowpass',    position: { x: 600, y: 130 }, data: { cutoff_hz: 2000 } },
      { id: 'out',    type: 'output',     position: { x: 850, y: 130 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'saw',    target: 'crunch', sourceHandle: 'audio-out', targetHandle: 'audio-in' },
      { id: 'e2', source: 'crunch', target: 'smooth', sourceHandle: 'audio-out', targetHandle: 'audio-in' },
      { id: 'e3', source: 'smooth', target: 'out',    sourceHandle: 'audio-out', targetHandle: 'audio-in' },
    ],
  },
  {
    id: 'color-bars',
    label: 'Color bars on a VGA monitor',
    description: 'VGA Timing → Color Bars → VGA Output. The first visual chip: build to iCEBreaker, plug a VGA-PMOD into PMOD1B, see 8 SMPTE color bars.',
    nodes: [
      { id: 'vt', type: 'vgatiming', position: { x: 50,  y: 60 }, data: {} },
      { id: 'cb', type: 'colorbars', position: { x: 380, y: 60 }, data: {} },
      { id: 'vo', type: 'vgaoutput', position: { x: 700, y: 60 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'vt', target: 'cb', sourceHandle: 'x',       targetHandle: 'x'       },
      { id: 'e2', source: 'vt', target: 'cb', sourceHandle: 'visible', targetHandle: 'visible' },
      { id: 'e3', source: 'cb', target: 'vo', sourceHandle: 'r',       targetHandle: 'r'       },
      { id: 'e4', source: 'cb', target: 'vo', sourceHandle: 'g',       targetHandle: 'g'       },
      { id: 'e5', source: 'cb', target: 'vo', sourceHandle: 'b',       targetHandle: 'b'       },
      { id: 'e6', source: 'vt', target: 'vo', sourceHandle: 'hsync',   targetHandle: 'hsync'   },
      { id: 'e7', source: 'vt', target: 'vo', sourceHandle: 'vsync',   targetHandle: 'vsync'   },
    ],
  },
]

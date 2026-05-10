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
  {
    id: 'vga-stripe',
    label: 'White vertical stripe on a VGA monitor',
    description: 'VGA Timing → Pixel Range → VGA Output. The Pixel Range output drives all three R/G/B channels, so the in-window pixels paint white on a black background. v0.1 has no visual mixer, so background-and-foreground rectangles need a future block — this is the simplest patch the visual chain currently supports.',
    nodes: [
      { id: 'vt', type: 'vgatiming',  position: { x: 50,  y: 60 }, data: {} },
      { id: 'pr', type: 'pixelrange', position: { x: 380, y: 60 }, data: { start: 100, end: 200 } },
      { id: 'vo', type: 'vgaoutput',  position: { x: 700, y: 60 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'vt', target: 'pr', sourceHandle: 'x',      targetHandle: 'pixel'  },
      { id: 'e2', source: 'pr', target: 'vo', sourceHandle: 'inside', targetHandle: 'r'      },
      { id: 'e3', source: 'pr', target: 'vo', sourceHandle: 'inside', targetHandle: 'g'      },
      { id: 'e4', source: 'pr', target: 'vo', sourceHandle: 'inside', targetHandle: 'b'      },
      { id: 'e5', source: 'vt', target: 'vo', sourceHandle: 'hsync',  targetHandle: 'hsync'  },
      { id: 'e6', source: 'vt', target: 'vo', sourceHandle: 'vsync',  targetHandle: 'vsync'  },
    ],
  },
  {
    id: 'cpu-accumulator',
    label: 'CPU accumulator (Counter→ROM→Adder→Register, audio via Reinterpret)',
    description: 'A tiny accumulator using the Sprint 17 CPU primitives: a Counter walks a 16-entry ROM (the first 8 Fibonacci numbers, padded with zeros), the ROM byte feeds Adder.in-a, a Register holds the running sum and feeds it back via Adder.in-b, and a parallel RAM logs each new sum to the same address. The Sprint 18 Reinterpret block bridges the CPU-domain Register output (data-u8) to the audio domain (audio-s8) so the running sum actually drives the speaker — the LSBs of the sum vary per cycle, producing rhythmic crackle.',
    nodes: [
      { id: 'gate', type: 'gate',        position: { x: 40,   y: 60  }, data: { rate_hz: 100, duty_pct: 50 } },
      { id: 'cnt',  type: 'counter',     position: { x: 240,  y: 60  }, data: { max_value: 16 } },
      { id: 'rom',  type: 'rom',         position: { x: 460,  y: 60  }, data: { contents: [1, 1, 2, 3, 5, 8, 13, 21, 0, 0, 0, 0, 0, 0, 0, 0] } },
      { id: 'add',  type: 'adder',       position: { x: 720,  y: 60  }, data: {} },
      { id: 'reg',  type: 'register',    position: { x: 940,  y: 60  }, data: {} },
      { id: 'ram',  type: 'ram',         position: { x: 720,  y: 280 }, data: {} },
      { id: 'ri',   type: 'reinterpret', position: { x: 940,  y: 320 }, data: {} },
      { id: 'out',  type: 'output',      position: { x: 1140, y: 320 }, data: {} },
    ],
    edges: [
      { id: 'e1',  source: 'gate', target: 'cnt', sourceHandle: 'gate-out',  targetHandle: 'clock'        },
      { id: 'e2',  source: 'cnt',  target: 'rom', sourceHandle: 'addr-out',  targetHandle: 'addr'         },
      { id: 'e3',  source: 'rom',  target: 'add', sourceHandle: 'data-out',  targetHandle: 'in-a'         },
      { id: 'e4',  source: 'reg',  target: 'add', sourceHandle: 'data-out',  targetHandle: 'in-b'         },
      { id: 'e5',  source: 'add',  target: 'reg', sourceHandle: 'sum-out',   targetHandle: 'data-in'      },
      { id: 'e6',  source: 'gate', target: 'reg', sourceHandle: 'gate-out',  targetHandle: 'write-enable' },
      { id: 'e7',  source: 'cnt',  target: 'ram', sourceHandle: 'addr-out',  targetHandle: 'addr'         },
      { id: 'e8',  source: 'reg',  target: 'ram', sourceHandle: 'data-out',  targetHandle: 'data-in'      },
      { id: 'e9',  source: 'gate', target: 'ram', sourceHandle: 'gate-out',  targetHandle: 'write-enable' },
      { id: 'e10', source: 'reg',  target: 'ri',  sourceHandle: 'data-out',  targetHandle: 'data-in'      },
      { id: 'e11', source: 'ri',   target: 'out', sourceHandle: 'audio-out', targetHandle: 'audio-in'     },
    ],
  },
  {
    id: 'cpu-counter-with-branch',
    label: 'Branchable counter (Comparator + Mux conditional reset)',
    description: 'A counter that resets at a target value — a tiny program that branches without a state machine. Three ROMs supply data-u8 constants (1 to increment, 7 as the reset target, 0 as the reset value). Each cycle: Adder adds the increment to the Register; Comparator checks whether the Register equals the target; Mux picks between the incremented sum and 0 based on the equal flag; the chosen value latches on the gate edge. Output runs through Reinterpret so the running counter (0..7..0..7..) is audible as a saw-shaped buzz.',
    nodes: [
      { id: 'gate',        type: 'gate',        position: { x: 40,   y: 60  }, data: { rate_hz: 200, duty_pct: 50 } },
      { id: 'cnt',         type: 'counter',     position: { x: 240,  y: 60  }, data: { max_value: 16 } },
      { id: 'rom_inc',     type: 'rom',         position: { x: 460,  y: 40  }, data: { contents: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] } },
      { id: 'rom_targets', type: 'rom',         position: { x: 460,  y: 220 }, data: { contents: [7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7] } },
      { id: 'rom_reset',   type: 'rom',         position: { x: 460,  y: 400 }, data: { contents: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] } },
      { id: 'add',         type: 'adder',       position: { x: 720,  y: 60  }, data: {} },
      { id: 'cmp',         type: 'comparator',  position: { x: 720,  y: 240 }, data: {} },
      { id: 'mux',         type: 'mux',         position: { x: 940,  y: 200 }, data: {} },
      { id: 'reg',         type: 'register',    position: { x: 1160, y: 200 }, data: {} },
      { id: 'ri',          type: 'reinterpret', position: { x: 1380, y: 200 }, data: {} },
      { id: 'out',         type: 'output',      position: { x: 1580, y: 200 }, data: {} },
    ],
    edges: [
      { id: 'e1',  source: 'gate',        target: 'cnt',         sourceHandle: 'gate-out',  targetHandle: 'clock'        },
      { id: 'e2',  source: 'cnt',         target: 'rom_inc',     sourceHandle: 'addr-out',  targetHandle: 'addr'         },
      { id: 'e3',  source: 'cnt',         target: 'rom_targets', sourceHandle: 'addr-out',  targetHandle: 'addr'         },
      { id: 'e4',  source: 'cnt',         target: 'rom_reset',   sourceHandle: 'addr-out',  targetHandle: 'addr'         },
      { id: 'e5',  source: 'rom_inc',     target: 'add',         sourceHandle: 'data-out',  targetHandle: 'in-a'         },
      { id: 'e6',  source: 'reg',         target: 'add',         sourceHandle: 'data-out',  targetHandle: 'in-b'         },
      { id: 'e7',  source: 'reg',         target: 'cmp',         sourceHandle: 'data-out',  targetHandle: 'in-a'         },
      { id: 'e8',  source: 'rom_targets', target: 'cmp',         sourceHandle: 'data-out',  targetHandle: 'in-b'         },
      { id: 'e9',  source: 'add',         target: 'mux',         sourceHandle: 'sum-out',   targetHandle: 'in-a'         },
      { id: 'e10', source: 'rom_reset',   target: 'mux',         sourceHandle: 'data-out',  targetHandle: 'in-b'         },
      { id: 'e11', source: 'cmp',         target: 'mux',         sourceHandle: 'eq-out',    targetHandle: 'select'       },
      { id: 'e12', source: 'mux',         target: 'reg',         sourceHandle: 'data-out',  targetHandle: 'data-in'      },
      { id: 'e13', source: 'gate',        target: 'reg',         sourceHandle: 'gate-out',  targetHandle: 'write-enable' },
      { id: 'e14', source: 'reg',         target: 'ri',          sourceHandle: 'data-out',  targetHandle: 'data-in'      },
      { id: 'e15', source: 'ri',          target: 'out',         sourceHandle: 'audio-out', targetHandle: 'audio-in'     },
    ],
  },
]

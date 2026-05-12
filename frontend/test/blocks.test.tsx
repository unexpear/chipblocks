/**
 * Block-component tests (Sprint-12 T1).
 *
 * Each block component is rendered in a ReactFlowProvider (the
 * components reach for `useReactFlow()` and `<Handle>` rendering, both
 * of which need React Flow's context). We assert:
 *   - The component mounts and shows its title.
 *   - The expected number of input/output handles render.
 *   - For blocks with a `useValidatedNumber` parameter input:
 *       - default value renders,
 *       - typing updates the input text,
 *       - out-of-range text triggers a `role=alert` error and the
 *         literal text is kept in the input,
 *       - blur on invalid input snaps back to the last committed value.
 *
 * What this does NOT cover: React Flow's connect/drag interactions, or
 * `updateNodeData` actually mutating the store (the components are
 * rendered without a registered node, so commits are no-ops). The hook
 * keeps local state, which is what we actually need to verify here.
 */

import { describe, expect, it } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { ReactFlowProvider, Position } from '@xyflow/react'

import { OscillatorNode } from '../src/blocks/OscillatorNode'
import { TriangleNode } from '../src/blocks/TriangleNode'
import { SawtoothNode } from '../src/blocks/SawtoothNode'
import { SineNode } from '../src/blocks/SineNode'
import { NoiseNode } from '../src/blocks/NoiseNode'
import { ConstantNode } from '../src/blocks/ConstantNode'
import { MixerNode } from '../src/blocks/MixerNode'
import { OutputNode } from '../src/blocks/OutputNode'
import { ADSRNode } from '../src/blocks/ADSRNode'
import { GateNode } from '../src/blocks/GateNode'
import { LowPassFilterNode } from '../src/blocks/LowPassFilterNode'
import { HighPassFilterNode } from '../src/blocks/HighPassFilterNode'
import { BandPassFilterNode } from '../src/blocks/BandPassFilterNode'
import { SampleAndHoldNode } from '../src/blocks/SampleAndHoldNode'
import { FmNode } from '../src/blocks/FmNode'
import { MultiplyNode } from '../src/blocks/MultiplyNode'
import { WavetableNode } from '../src/blocks/WavetableNode'
import { BitcrusherNode } from '../src/blocks/BitcrusherNode'
import { ShifterNode } from '../src/blocks/ShifterNode'
import { VcoNode } from '../src/blocks/VcoNode'
import { LfoNode } from '../src/blocks/LfoNode'
import { AudioSumNode } from '../src/blocks/AudioSumNode'
import { VcfNode } from '../src/blocks/VcfNode'
import { HardsyncNode } from '../src/blocks/HardsyncNode'
import { DelayNode } from '../src/blocks/DelayNode'
import { AndGateNode } from '../src/blocks/AndGateNode'
import { OrGateNode } from '../src/blocks/OrGateNode'
import { XorGateNode } from '../src/blocks/XorGateNode'
import { NotGateNode } from '../src/blocks/NotGateNode'
import { CounterNode } from '../src/blocks/CounterNode'
import { VgaTimingNode } from '../src/blocks/VgaTimingNode'
import { ColorBarsNode } from '../src/blocks/ColorBarsNode'
import { VgaOutputNode } from '../src/blocks/VgaOutputNode'
import { DistortionNode } from '../src/blocks/DistortionNode'
import { PixelRangeNode } from '../src/blocks/PixelRangeNode'
import { SolidColorNode } from '../src/blocks/SolidColorNode'
import { BusSplitNode } from '../src/blocks/BusSplitNode'
import { BusJoinNode } from '../src/blocks/BusJoinNode'
import { AdderNode } from '../src/blocks/AdderNode'
import { RegisterNode } from '../src/blocks/RegisterNode'
import { RAMNode } from '../src/blocks/RAMNode'
import { RegisterFileNode } from '../src/blocks/RegisterFileNode'
import { ROMNode } from '../src/blocks/ROMNode'
import { ReinterpretNode } from '../src/blocks/ReinterpretNode'
import { SubtractorNode } from '../src/blocks/SubtractorNode'
import { ComparatorNode } from '../src/blocks/ComparatorNode'
import { MuxNode } from '../src/blocks/MuxNode'

// ---------------------------------------------------------------------------
// Helpers

afterEach(() => {
  cleanup()
})

const wrap = (ui: ReactNode) =>
  render(<ReactFlowProvider>{ui}</ReactFlowProvider>)

// React Flow's <Handle> renders a div with .react-flow__handle. The
// `data-handlepos` attribute distinguishes left (target / inputs) vs.
// right (source / outputs) so we don't have to rely on per-block class
// names.
function countHandles(container: HTMLElement, side: 'source' | 'target'): number {
  const sel = `.react-flow__handle-${side === 'source' ? 'right' : 'left'}, .react-flow__handle.source, .react-flow__handle.target`
  // Most reliable: handles get the literal class "source" or "target"
  // alongside react-flow__handle.
  return container.querySelectorAll(`.react-flow__handle.${side}`).length
}

// Minimum NodeProps shape every block component needs. Each block
// destructures `id` + `data`; the rest are required by the type but
// never read. We cast to the right `NodeProps<...>` shape at the
// call site.
function nodePropsBase(id: string) {
  return {
    id,
    type: 'mock',
    selected: false,
    isConnectable: true,
    zIndex: 0,
    xPos: 0,
    yPos: 0,
    dragging: false,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    width: 100,
    height: 50,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    deletable: true,
    selectable: true,
    draggable: true,
    dragHandle: undefined,
  }
}

// ---------------------------------------------------------------------------
// Source blocks (no inputs, 1 output) — Oscillator, Triangle, Sawtooth,
// Sine all share the exact same shape: a single freq input wired to the
// `useValidatedNumber` hook with [20, 20000] range.

interface FreqBlockCase {
  name: string
  Component: React.ComponentType<{
    id: string
    data: { freq: number }
  } & ReturnType<typeof nodePropsBase>>
  defaultFreq: number
}

const freqBlocks: FreqBlockCase[] = [
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { name: 'Oscillator', Component: OscillatorNode as any, defaultFreq: 440 },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { name: 'Triangle',   Component: TriangleNode as any,   defaultFreq: 220 },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { name: 'Sawtooth',   Component: SawtoothNode as any,   defaultFreq: 660 },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { name: 'Sine',       Component: SineNode as any,       defaultFreq: 60  },
]

describe.each(freqBlocks)('$name block', ({ name, Component, defaultFreq }) => {
  it('renders title + freq input with default', () => {
    const { container } = wrap(
      <Component {...nodePropsBase(`${name}-1`)} data={{ freq: defaultFreq }} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe(name)
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')
    expect(input).not.toBeNull()
    expect(input?.value).toBe(String(defaultFreq))
    // Source-only block: 0 target handles, 1 source handle.
    expect(countHandles(container, 'target')).toBe(0)
    expect(countHandles(container, 'source')).toBe(1)
  })

  it('typing into the freq input updates the value', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <Component {...nodePropsBase(`${name}-2`)} data={{ freq: defaultFreq }} />,
    )
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!
    await user.clear(input)
    await user.type(input, '880')
    expect(input.value).toBe('880')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('out-of-range freq keeps the literal text and shows an error', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <Component {...nodePropsBase(`${name}-3`)} data={{ freq: defaultFreq }} />,
    )
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!
    await user.clear(input)
    await user.type(input, '30000')
    // 30000 > max=20000 — input keeps the literal text but flags invalid.
    expect(input.value).toBe('30000')
    const alert = container.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert?.textContent).toMatch(/20.*20000/)
  })

  it('blur on invalid input snaps back to last committed value', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <Component {...nodePropsBase(`${name}-4`)} data={{ freq: defaultFreq }} />,
    )
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!
    await user.clear(input)
    await user.type(input, '99999')
    expect(input.value).toBe('99999')
    // Move focus away — hook's onBlur should snap back to defaultFreq
    // because the component is rendered without a registered node, so
    // no `commit` ever stuck.
    await user.tab()
    expect(input.value).toBe(String(defaultFreq))
  })
})

// ---------------------------------------------------------------------------
// Constant block: 1 input field with [-128, 127] range.

describe('Constant block', () => {
  it('renders title + value input with default', () => {
    const { container } = wrap(
      <ConstantNode {...nodePropsBase('const-1')} data={{ value: 0 }} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('Constant')
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')
    expect(input?.value).toBe('0')
    expect(countHandles(container, 'target')).toBe(0)
    expect(countHandles(container, 'source')).toBe(1)
  })

  it('typing a valid value (42) updates the input', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <ConstantNode {...nodePropsBase('const-3')} data={{ value: 0 }} />,
    )
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!
    await user.clear(input)
    await user.type(input, '42')
    expect(input.value).toBe('42')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('out-of-range value (200) shows an error', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <ConstantNode {...nodePropsBase('const-2')} data={{ value: 0 }} />,
    )
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!
    await user.clear(input)
    await user.type(input, '200')
    expect(input.value).toBe('200')
    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toMatch(/-128.*127/)
  })
})

// ---------------------------------------------------------------------------
// Display-only blocks: Noise, Mixer, Output, S&H, Multiply.

describe('Noise block', () => {
  it('renders title and a single output handle, no inputs', () => {
    const { container } = wrap(
      <NoiseNode {...nodePropsBase('noise-1')} data={{}} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('Noise')
    expect(container.querySelectorAll('input').length).toBe(0)
    expect(countHandles(container, 'target')).toBe(0)
    expect(countHandles(container, 'source')).toBe(1)
  })
})

describe('Mixer block', () => {
  it('renders title with 2 input handles and 1 output handle', () => {
    const { container } = wrap(
      <MixerNode {...nodePropsBase('mixer-1')} data={{}} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('Mixer')
    expect(countHandles(container, 'target')).toBe(2)
    expect(countHandles(container, 'source')).toBe(1)
  })
})

describe('Output block', () => {
  it('renders title with 1 input handle and 0 output handles', () => {
    const { container } = wrap(
      <OutputNode {...nodePropsBase('out-1')} data={{}} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('Output')
    expect(countHandles(container, 'target')).toBe(1)
    expect(countHandles(container, 'source')).toBe(0)
  })
})

describe('SampleAndHold block', () => {
  it('renders S & H title with 2 inputs and 1 output', () => {
    const { container } = wrap(
      <SampleAndHoldNode {...nodePropsBase('snh-1')} data={{}} />,
    )
    // & is rendered as the literal & character.
    expect(container.querySelector('.block-title')?.textContent).toBe('S & H')
    expect(countHandles(container, 'target')).toBe(2)
    expect(countHandles(container, 'source')).toBe(1)
  })
})

describe('Multiply block', () => {
  it('renders title with 2 inputs and 1 output', () => {
    const { container } = wrap(
      <MultiplyNode {...nodePropsBase('mul-1')} data={{}} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('Multiply')
    expect(countHandles(container, 'target')).toBe(2)
    expect(countHandles(container, 'source')).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// LowPassFilter: 1 input handle, 1 output handle, 1 cutoff field [1, 22050].

describe('LowPassFilter block', () => {
  it('renders title + cutoff_hz input with default', () => {
    const { container } = wrap(
      <LowPassFilterNode
        {...nodePropsBase('lpf-1')}
        data={{ cutoff_hz: 800 }}
      />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('Low-pass')
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')
    expect(input?.value).toBe('800')
    expect(countHandles(container, 'target')).toBe(1)
    expect(countHandles(container, 'source')).toBe(1)
  })

  it('typing a valid cutoff (4000) updates the input', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <LowPassFilterNode
        {...nodePropsBase('lpf-3')}
        data={{ cutoff_hz: 800 }}
      />,
    )
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!
    await user.clear(input)
    await user.type(input, '4000')
    expect(input.value).toBe('4000')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('out-of-range cutoff (50000) shows an error', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <LowPassFilterNode
        {...nodePropsBase('lpf-2')}
        data={{ cutoff_hz: 800 }}
      />,
    )
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!
    await user.clear(input)
    await user.type(input, '50000')
    expect(input.value).toBe('50000')
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/22050/)
  })
})

// ---------------------------------------------------------------------------
// HighPassFilter: 1 input handle, 1 output handle, 1 cutoff field [1, 22050].

describe('HighPassFilter block', () => {
  it('renders title + cutoff_hz input with default', () => {
    const { container } = wrap(
      <HighPassFilterNode
        {...nodePropsBase('hpf-1')}
        data={{ cutoff_hz: 800 }}
      />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('High-pass')
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')
    expect(input?.value).toBe('800')
    expect(countHandles(container, 'target')).toBe(1)
    expect(countHandles(container, 'source')).toBe(1)
    // aria-label on the cutoff input.
    expect(input?.getAttribute('aria-label')).toBe('Cutoff frequency in hertz')
  })

  it('typing a valid cutoff (4000) updates the input', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <HighPassFilterNode
        {...nodePropsBase('hpf-2')}
        data={{ cutoff_hz: 800 }}
      />,
    )
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!
    await user.clear(input)
    await user.type(input, '4000')
    expect(input.value).toBe('4000')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('out-of-range cutoff (50000) shows an error and snaps back on blur', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <HighPassFilterNode
        {...nodePropsBase('hpf-3')}
        data={{ cutoff_hz: 800 }}
      />,
    )
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!
    await user.clear(input)
    await user.type(input, '50000')
    expect(input.value).toBe('50000')
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/22050/)
    await user.tab()
    expect(input.value).toBe('800')
  })
})

// ---------------------------------------------------------------------------
// BandPassFilter: 1 input handle, 1 output handle, 1 center_hz field [10, 22050].

describe('BandPassFilter block', () => {
  it('renders title + center_hz input with default', () => {
    const { container } = wrap(
      <BandPassFilterNode
        {...nodePropsBase('bpf-1')}
        data={{ center_hz: 1000 }}
      />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('Band-pass')
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')
    expect(input?.value).toBe('1000')
    expect(countHandles(container, 'target')).toBe(1)
    expect(countHandles(container, 'source')).toBe(1)
    // aria-label on the center input.
    expect(input?.getAttribute('aria-label')).toBe('Center frequency in hertz')
  })

  it('typing a valid center (500) updates the input', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <BandPassFilterNode
        {...nodePropsBase('bpf-2')}
        data={{ center_hz: 1000 }}
      />,
    )
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!
    await user.clear(input)
    await user.type(input, '500')
    expect(input.value).toBe('500')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('out-of-range center (5) shows an error and snaps back on blur', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <BandPassFilterNode
        {...nodePropsBase('bpf-3')}
        data={{ center_hz: 1000 }}
      />,
    )
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!
    await user.clear(input)
    await user.type(input, '5')
    expect(input.value).toBe('5')
    // 5 is below the min of 10.
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/10.*22050/)
    await user.tab()
    expect(input.value).toBe('1000')
  })
})

// ---------------------------------------------------------------------------
// ADSR: 4 fields (A, D, S, R). Each is a separate `useValidatedNumber`
// instance; we don't enumerate every range, just spot-check that all 4
// inputs render with the right values + that one of them validates.

describe('ADSR block', () => {
  it('renders title + 4 number inputs with defaults', () => {
    const { container } = wrap(
      <ADSRNode
        {...nodePropsBase('adsr-1')}
        data={{ attack_ms: 10, decay_ms: 100, sustain_level: 80, release_ms: 200 }}
      />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('ADSR')
    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="number"]')
    expect(inputs.length).toBe(4)
    expect(inputs[0].value).toBe('10')
    expect(inputs[1].value).toBe('100')
    expect(inputs[2].value).toBe('80')
    expect(inputs[3].value).toBe('200')
    // ADSR has 2 inputs (gate + audio-in) and 1 output.
    expect(countHandles(container, 'target')).toBe(2)
    expect(countHandles(container, 'source')).toBe(1)
  })

  it('typing a valid attack (250) updates the input', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <ADSRNode
        {...nodePropsBase('adsr-3')}
        data={{ attack_ms: 10, decay_ms: 100, sustain_level: 80, release_ms: 200 }}
      />,
    )
    const attackInput = container.querySelectorAll<HTMLInputElement>('input[type="number"]')[0]
    await user.clear(attackInput)
    await user.type(attackInput, '250')
    expect(attackInput.value).toBe('250')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('out-of-range sustain (200, max 127) shows an error and snaps back on blur', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <ADSRNode
        {...nodePropsBase('adsr-2')}
        data={{ attack_ms: 10, decay_ms: 100, sustain_level: 80, release_ms: 200 }}
      />,
    )
    const sustainInput = container.querySelectorAll<HTMLInputElement>('input[type="number"]')[2]
    await user.clear(sustainInput)
    await user.type(sustainInput, '200')
    expect(sustainInput.value).toBe('200')
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/0.*127/)
    await user.tab()
    expect(sustainInput.value).toBe('80')
  })

  // Regression-guard: LD audit (2026-05-10) replaced the A/D/S/R
  // single-letter labels with 3-char expansions. Any agent that flips
  // back to single letters must update both this test and the audit.
  it('uses 3-char Att/Dec/Sus/Rel labels (not A/D/S/R)', () => {
    const { container } = wrap(
      <ADSRNode
        {...nodePropsBase('adsr-labels')}
        data={{ attack_ms: 10, decay_ms: 100, sustain_level: 80, release_ms: 200 }}
      />,
    )
    const labels = Array.from(container.querySelectorAll('.block-label')).map((el) => el.textContent)
    expect(labels).toEqual(['Att', 'Dec', 'Sus', 'Rel'])
  })
})

// ---------------------------------------------------------------------------
// Gate: 2 fields. rate_hz [1..1000], duty_pct [1..99].

describe('Gate block', () => {
  it('renders title + 2 number inputs with defaults', () => {
    const { container } = wrap(
      <GateNode
        {...nodePropsBase('gate-1')}
        data={{ rate_hz: 4, duty_pct: 50 }}
      />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('Gate')
    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="number"]')
    expect(inputs.length).toBe(2)
    expect(inputs[0].value).toBe('4')
    expect(inputs[1].value).toBe('50')
  })

  it('typing a valid rate (10) updates the input', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <GateNode
        {...nodePropsBase('gate-3')}
        data={{ rate_hz: 4, duty_pct: 50 }}
      />,
    )
    const rateInput = container.querySelectorAll<HTMLInputElement>('input[type="number"]')[0]
    await user.clear(rateInput)
    await user.type(rateInput, '10')
    expect(rateInput.value).toBe('10')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('out-of-range duty (150) shows an error', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <GateNode
        {...nodePropsBase('gate-2')}
        data={{ rate_hz: 4, duty_pct: 50 }}
      />,
    )
    const dutyInput = container.querySelectorAll<HTMLInputElement>('input[type="number"]')[1]
    await user.clear(dutyInput)
    await user.type(dutyInput, '150')
    expect(dutyInput.value).toBe('150')
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/1.*99/)
  })
})

// ---------------------------------------------------------------------------
// FM: 3 fields. carrier/modulator [20..20000], depth [0..127].

describe('FM block', () => {
  it('renders title + 3 number inputs with defaults', () => {
    const { container } = wrap(
      <FmNode
        {...nodePropsBase('fm-1')}
        data={{ carrier_freq: 440, modulator_freq: 110, mod_depth: 64 }}
      />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('FM')
    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="number"]')
    expect(inputs.length).toBe(3)
    expect(inputs[0].value).toBe('440')
    expect(inputs[1].value).toBe('110')
    expect(inputs[2].value).toBe('64')
  })

  it('typing a valid depth (100) updates the input', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <FmNode
        {...nodePropsBase('fm-2')}
        data={{ carrier_freq: 440, modulator_freq: 110, mod_depth: 64 }}
      />,
    )
    const depth = container.querySelectorAll<HTMLInputElement>('input[type="number"]')[2]
    await user.clear(depth)
    await user.type(depth, '100')
    expect(depth.value).toBe('100')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('out-of-range depth (200, max 127) shows an error', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <FmNode
        {...nodePropsBase('fm-3')}
        data={{ carrier_freq: 440, modulator_freq: 110, mod_depth: 64 }}
      />,
    )
    const depth = container.querySelectorAll<HTMLInputElement>('input[type="number"]')[2]
    await user.clear(depth)
    await user.type(depth, '200')
    expect(depth.value).toBe('200')
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/0.*127/)
  })

  // Regression-guard: LD audit (2026-05-10) replaced the C/M/D
  // single-letter labels with 3-char expansions ("Car"/"Mod"/"Dep").
  it('uses Car/Mod/Dep labels (not C/M/D)', () => {
    const { container } = wrap(
      <FmNode
        {...nodePropsBase('fm-labels')}
        data={{ carrier_freq: 440, modulator_freq: 110, mod_depth: 64 }}
      />,
    )
    const labels = Array.from(container.querySelectorAll('.block-label')).map((el) => el.textContent)
    expect(labels).toEqual(['Car', 'Mod', 'Dep'])
  })
})

// ---------------------------------------------------------------------------
// Wavetable: freq input + shape select.

describe('Wavetable block', () => {
  it('renders title + freq input + shape select', () => {
    const { container } = wrap(
      <WavetableNode
        {...nodePropsBase('wt-1')}
        data={{ freq: 440, shape: 'sine' }}
      />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('Wavetable')
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')
    expect(input?.value).toBe('440')
    const select = container.querySelector<HTMLSelectElement>('select')
    expect(select).not.toBeNull()
    expect(select?.value).toBe('sine')
    // Shape options: sine, pulse_25, ramp_up, formant.
    expect(select?.querySelectorAll('option').length).toBe(4)
  })

  it('typing a valid freq (880) updates the input', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <WavetableNode
        {...nodePropsBase('wt-3')}
        data={{ freq: 440, shape: 'sine' }}
      />,
    )
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!
    await user.clear(input)
    await user.type(input, '880')
    expect(input.value).toBe('880')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('out-of-range freq (50000) shows an error', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <WavetableNode
        {...nodePropsBase('wt-2')}
        data={{ freq: 440, shape: 'sine' }}
      />,
    )
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!
    await user.clear(input)
    await user.type(input, '50000')
    expect(input.value).toBe('50000')
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/20.*20000/)
  })
})

// ---------------------------------------------------------------------------
// Bitcrusher: 1 input handle, 1 output handle, 1 bits field [1, 8].

describe('Bitcrusher block', () => {
  it('renders title + bits input with default', () => {
    const { container } = wrap(
      <BitcrusherNode {...nodePropsBase('bc-1')} data={{ bits: 4 }} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('Bitcrusher')
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')
    expect(input?.value).toBe('4')
    expect(countHandles(container, 'target')).toBe(1)
    expect(countHandles(container, 'source')).toBe(1)
  })

  it('typing a valid bits value (2) updates the input', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <BitcrusherNode {...nodePropsBase('bc-2')} data={{ bits: 4 }} />,
    )
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!
    await user.clear(input)
    await user.type(input, '2')
    expect(input.value).toBe('2')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('out-of-range bits (12) shows an error', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <BitcrusherNode {...nodePropsBase('bc-3')} data={{ bits: 4 }} />,
    )
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!
    await user.clear(input)
    await user.type(input, '12')
    expect(input.value).toBe('12')
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/1.*8/)
  })
})

// ---------------------------------------------------------------------------
// Delay: 1 input handle, 1 output handle, 1 delay_samples field [1, 1024].

describe('Delay block', () => {
  it('renders title + delay_samples input with default', () => {
    const { container } = wrap(
      <DelayNode {...nodePropsBase('dl-1')} data={{ delay_samples: 128 }} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('Delay')
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')
    expect(input?.value).toBe('128')
    expect(countHandles(container, 'target')).toBe(1)
    expect(countHandles(container, 'source')).toBe(1)
  })

  it('typing a valid value (500) updates the input', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <DelayNode {...nodePropsBase('dl-2')} data={{ delay_samples: 128 }} />,
    )
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!
    await user.clear(input)
    await user.type(input, '500')
    expect(input.value).toBe('500')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('out-of-range delay_samples (2000) shows an error and snaps back on blur', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <DelayNode {...nodePropsBase('dl-3')} data={{ delay_samples: 128 }} />,
    )
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!
    await user.clear(input)
    await user.type(input, '2000')
    expect(input.value).toBe('2000')
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/1.*1024/)
    await user.tab()
    expect(input.value).toBe('128')
  })
})

// ---------------------------------------------------------------------------
// Logic blocks: AND / OR / XOR are 2-input parameterless 1-bit gates;
// NOT is 1-input parameterless; Counter has a clock input + max_value
// parameter [1..127].

describe('AndGate block', () => {
  it('renders title with 2 inputs and 1 output, no params', () => {
    const { container } = wrap(
      <AndGateNode {...nodePropsBase('and-1')} data={{}} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('AND')
    expect(container.querySelectorAll('input').length).toBe(0)
    expect(countHandles(container, 'target')).toBe(2)
    expect(countHandles(container, 'source')).toBe(1)
  })
})

describe('OrGate block', () => {
  it('renders title with 2 inputs and 1 output, no params', () => {
    const { container } = wrap(
      <OrGateNode {...nodePropsBase('or-1')} data={{}} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('OR')
    expect(container.querySelectorAll('input').length).toBe(0)
    expect(countHandles(container, 'target')).toBe(2)
    expect(countHandles(container, 'source')).toBe(1)
  })
})

describe('XorGate block', () => {
  it('renders title with 2 inputs and 1 output, no params', () => {
    const { container } = wrap(
      <XorGateNode {...nodePropsBase('xor-1')} data={{}} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('XOR')
    expect(container.querySelectorAll('input').length).toBe(0)
    expect(countHandles(container, 'target')).toBe(2)
    expect(countHandles(container, 'source')).toBe(1)
  })
})

describe('NotGate block', () => {
  it('renders title with 1 input and 1 output, no params', () => {
    const { container } = wrap(
      <NotGateNode {...nodePropsBase('not-1')} data={{}} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('NOT')
    expect(container.querySelectorAll('input').length).toBe(0)
    expect(countHandles(container, 'target')).toBe(1)
    expect(countHandles(container, 'source')).toBe(1)
  })
})

describe('Counter block', () => {
  it('renders title + max_value input with default + 2 source handles', () => {
    const { container } = wrap(
      <CounterNode {...nodePropsBase('cnt-1')} data={{ max_value: 16 }} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('Counter')
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')
    expect(input?.value).toBe('16')
    expect(input?.getAttribute('aria-label')).toBe('Wrap value (1 to 127)')
    expect(countHandles(container, 'target')).toBe(1)
    // Sprint 17 / ADR-002: Counter now exposes audio-out + addr-out.
    expect(countHandles(container, 'source')).toBe(2)
    const handles = container.querySelectorAll<HTMLElement>('.react-flow__handle')
    const ids = Array.from(handles).map((h) => h.getAttribute('data-handleid'))
    expect(ids).toContain('audio-out')
    expect(ids).toContain('addr-out')
  })

  it('out-of-range max_value (200) shows an error and snaps back on blur', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <CounterNode {...nodePropsBase('cnt-2')} data={{ max_value: 16 }} />,
    )
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!
    await user.clear(input)
    await user.type(input, '200')
    expect(input.value).toBe('200')
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/1.*127/)
    await user.tab()
    expect(input.value).toBe('16')
  })
})

// ---------------------------------------------------------------------------
// Visual blocks: VgaTiming (5 outputs, no inputs), ColorBars (2 inputs,
// 3 outputs), VgaOutput (5 inputs, no outputs). All parameterless.

describe('VgaTiming block', () => {
  it('renders title with 5 source handles and no target handles', () => {
    const { container } = wrap(
      <VgaTimingNode {...nodePropsBase('vt-1')} data={{}} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('VGA Timing')
    expect(container.querySelectorAll('input').length).toBe(0)
    expect(countHandles(container, 'target')).toBe(0)
    expect(countHandles(container, 'source')).toBe(5)
  })
})

describe('ColorBars block', () => {
  it('renders title with 2 inputs and 3 outputs, no params', () => {
    const { container } = wrap(
      <ColorBarsNode {...nodePropsBase('cb-1')} data={{}} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('Color Bars')
    expect(container.querySelectorAll('input').length).toBe(0)
    expect(countHandles(container, 'target')).toBe(2)
    expect(countHandles(container, 'source')).toBe(3)
  })
})

describe('VgaOutput block', () => {
  it('renders title with 5 inputs and 0 outputs', () => {
    const { container } = wrap(
      <VgaOutputNode {...nodePropsBase('vo-1')} data={{}} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('VGA Output')
    expect(container.querySelectorAll('input').length).toBe(0)
    expect(countHandles(container, 'target')).toBe(5)
    expect(countHandles(container, 'source')).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Distortion: 1 input handle, 1 output handle, 1 threshold field [1, 127].

describe('Distortion block', () => {
  it('renders title + threshold input with default', () => {
    const { container } = wrap(
      <DistortionNode {...nodePropsBase('dist-1')} data={{ threshold: 32 }} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('Distortion')
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')
    expect(input?.value).toBe('32')
    expect(input?.getAttribute('aria-label')).toBe('Clip threshold (1 to 127)')
    expect(countHandles(container, 'target')).toBe(1)
    expect(countHandles(container, 'source')).toBe(1)
  })

  it('typing a valid threshold (16) updates the input', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <DistortionNode {...nodePropsBase('dist-2')} data={{ threshold: 32 }} />,
    )
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!
    await user.clear(input)
    await user.type(input, '16')
    expect(input.value).toBe('16')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('out-of-range threshold (200) shows an error and snaps back on blur', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <DistortionNode {...nodePropsBase('dist-3')} data={{ threshold: 32 }} />,
    )
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!
    await user.clear(input)
    await user.type(input, '200')
    expect(input.value).toBe('200')
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/1.*127/)
    await user.tab()
    expect(input.value).toBe('32')
  })
})

// ---------------------------------------------------------------------------
// PixelRange: 1 input handle, 1 output handle, 2 fields (start, end) each [0, 639].

describe('PixelRange block', () => {
  it('renders title + 2 number inputs with defaults', () => {
    const { container } = wrap(
      <PixelRangeNode {...nodePropsBase('pr-1')} data={{ start: 100, end: 200 }} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('Pixel Range')
    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="number"]')
    expect(inputs.length).toBe(2)
    expect(inputs[0].value).toBe('100')
    expect(inputs[1].value).toBe('200')
    expect(countHandles(container, 'target')).toBe(1)
    expect(countHandles(container, 'source')).toBe(1)
  })

  it('out-of-range start (700) shows an error and snaps back on blur', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <PixelRangeNode {...nodePropsBase('pr-2')} data={{ start: 100, end: 200 }} />,
    )
    const startInput = container.querySelectorAll<HTMLInputElement>('input[type="number"]')[0]
    await user.clear(startInput)
    await user.type(startInput, '700')
    expect(startInput.value).toBe('700')
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/0.*639/)
    await user.tab()
    expect(startInput.value).toBe('100')
  })

  // Regression-guard: LD audit (2026-05-10) replaced the a/b labels
  // with start/end so working-memory users don't have to recall which
  // letter is which after a context-switch.
  it('uses start/end labels (not a/b)', () => {
    const { container } = wrap(
      <PixelRangeNode {...nodePropsBase('pr-labels')} data={{ start: 100, end: 200 }} />,
    )
    const labels = Array.from(container.querySelectorAll('.block-label')).map((el) => el.textContent)
    expect(labels).toEqual(['start', 'end'])
  })
})

// ---------------------------------------------------------------------------
// SolidColor: no inputs, 3 output handles, 1 color select.

describe('SolidColor block', () => {
  it('renders title + color select with default and 8 options', () => {
    const { container } = wrap(
      <SolidColorNode {...nodePropsBase('sc-1')} data={{ color: 'white' }} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('Solid Color')
    const select = container.querySelector<HTMLSelectElement>('select')
    expect(select).not.toBeNull()
    expect(select?.value).toBe('white')
    expect(select?.querySelectorAll('option').length).toBe(8)
    expect(countHandles(container, 'target')).toBe(0)
    expect(countHandles(container, 'source')).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// Bus blocks: BusSplit (1 input, 8 outputs) and BusJoin (8 inputs, 1 output).
// Both parameter-less; v0.1 fixes the width at 8 bits.

describe('BusSplit block', () => {
  it('renders title with 1 input and 8 outputs, no params', () => {
    const { container } = wrap(
      <BusSplitNode {...nodePropsBase('bs-1')} data={{}} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('Bus Split')
    expect(container.querySelectorAll('input').length).toBe(0)
    expect(countHandles(container, 'target')).toBe(1)
    expect(countHandles(container, 'source')).toBe(8)
    // Spot-check the LSB and MSB handle ids are present and labelled.
    const handles = container.querySelectorAll<HTMLElement>('.react-flow__handle')
    const ids = Array.from(handles).map((h) => h.getAttribute('data-handleid'))
    expect(ids).toContain('bus-in')
    for (let i = 0; i < 8; i++) {
      expect(ids).toContain(`bit-${i}`)
    }
  })
})

describe('BusJoin block', () => {
  it('renders title with 8 inputs and 1 output, no params', () => {
    const { container } = wrap(
      <BusJoinNode {...nodePropsBase('bj-1')} data={{}} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('Bus Join')
    expect(container.querySelectorAll('input').length).toBe(0)
    expect(countHandles(container, 'target')).toBe(8)
    expect(countHandles(container, 'source')).toBe(1)
    const handles = container.querySelectorAll<HTMLElement>('.react-flow__handle')
    const ids = Array.from(handles).map((h) => h.getAttribute('data-handleid'))
    expect(ids).toContain('bus-out')
    for (let i = 0; i < 8; i++) {
      expect(ids).toContain(`bit-${i}`)
    }
  })
})

// ---------------------------------------------------------------------------
// CPU primitives (Sprint 17, ADR-002): Adder, Register, RAM, ROM.
// All four follow the 8-file cookbook; ROM is the only one with a
// parameter, and that parameter is an array (a textarea editor rather
// than a number input).

describe('Adder block', () => {
  it('renders title with 2 inputs and 2 outputs, no params', () => {
    const { container } = wrap(
      <AdderNode {...nodePropsBase('add-1')} data={{}} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('Adder')
    expect(container.querySelectorAll('input').length).toBe(0)
    expect(countHandles(container, 'target')).toBe(2)
    expect(countHandles(container, 'source')).toBe(2)
    const handles = container.querySelectorAll<HTMLElement>('.react-flow__handle')
    const ids = Array.from(handles).map((h) => h.getAttribute('data-handleid'))
    expect(ids).toContain('in-a')
    expect(ids).toContain('in-b')
    expect(ids).toContain('sum-out')
    expect(ids).toContain('carry-out')
  })
})

describe('Register block', () => {
  it('renders title with 2 inputs and 1 output, no params', () => {
    const { container } = wrap(
      <RegisterNode {...nodePropsBase('reg-1')} data={{}} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('Register')
    expect(container.querySelectorAll('input').length).toBe(0)
    expect(countHandles(container, 'target')).toBe(2)
    expect(countHandles(container, 'source')).toBe(1)
    const handles = container.querySelectorAll<HTMLElement>('.react-flow__handle')
    const ids = Array.from(handles).map((h) => h.getAttribute('data-handleid'))
    expect(ids).toContain('data-in')
    expect(ids).toContain('write-enable')
    expect(ids).toContain('data-out')
  })
})

describe('RAM block', () => {
  it('renders title with 3 inputs and 1 output, no params', () => {
    const { container } = wrap(
      <RAMNode {...nodePropsBase('ram-1')} data={{}} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('RAM')
    expect(container.querySelectorAll('input').length).toBe(0)
    expect(countHandles(container, 'target')).toBe(3)
    expect(countHandles(container, 'source')).toBe(1)
    const handles = container.querySelectorAll<HTMLElement>('.react-flow__handle')
    const ids = Array.from(handles).map((h) => h.getAttribute('data-handleid'))
    expect(ids).toContain('addr')
    expect(ids).toContain('data-in')
    expect(ids).toContain('write-enable')
    expect(ids).toContain('data-out')
  })
})

describe('RegisterFile block', () => {
  it('renders title with 4 inputs and 1 output, no params', () => {
    const { container } = wrap(
      <RegisterFileNode {...nodePropsBase('rf-1')} data={{}} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('Reg File')
    expect(container.querySelectorAll('input').length).toBe(0)
    expect(countHandles(container, 'target')).toBe(4)
    expect(countHandles(container, 'source')).toBe(1)
    const handles = container.querySelectorAll<HTMLElement>('.react-flow__handle')
    const ids = Array.from(handles).map((h) => h.getAttribute('data-handleid'))
    expect(ids).toContain('read-addr')
    expect(ids).toContain('write-addr')
    expect(ids).toContain('data-in')
    expect(ids).toContain('write-enable')
    expect(ids).toContain('data-out')
  })
})

describe('ROM block', () => {
  it('renders title + contents textarea with default zeros', () => {
    const { container } = wrap(
      <ROMNode
        {...nodePropsBase('rom-1')}
        data={{ contents: Array(16).fill(0) }}
      />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('ROM')
    // The contents field is a textarea, not an <input type=number>.
    const ta = container.querySelector<HTMLTextAreaElement>('textarea')
    expect(ta).not.toBeNull()
    expect(ta?.value).toBe(
      '0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0',
    )
    expect(countHandles(container, 'target')).toBe(1)
    expect(countHandles(container, 'source')).toBe(1)
  })

  it('renders pre-populated contents as comma-separated text', () => {
    const program = [1, 1, 2, 3, 5, 8, 13, 21]
    const { container } = wrap(
      <ROMNode
        {...nodePropsBase('rom-2')}
        data={{ contents: program }}
      />,
    )
    const ta = container.querySelector<HTMLTextAreaElement>('textarea')!
    expect(ta.value).toBe('1, 1, 2, 3, 5, 8, 13, 21')
  })

  it('typing a non-numeric token surfaces an inline error', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <ROMNode
        {...nodePropsBase('rom-3')}
        data={{ contents: Array(16).fill(0) }}
      />,
    )
    const ta = container.querySelector<HTMLTextAreaElement>('textarea')!
    await user.clear(ta)
    await user.type(ta, '1, 2, abc')
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(
      /not a number/,
    )
  })

  it('typing an out-of-range value flags the entry', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <ROMNode
        {...nodePropsBase('rom-4')}
        data={{ contents: Array(16).fill(0) }}
      />,
    )
    const ta = container.querySelector<HTMLTextAreaElement>('textarea')!
    await user.clear(ta)
    await user.type(ta, '1, 2, 300')
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/0.255/)
  })
})

// ---------------------------------------------------------------------------
// Sprint 18 primitives — Reinterpret / Subtractor / Comparator / Mux. All
// parameter-less; Subtractor mirrors Adder's split shape, Comparator emits
// three flag projections, Mux picks one of two 8-bit values per select,
// Reinterpret bridges data-u8 to audio-s8 with no inputs/outputs other
// than the rename.

describe('Reinterpret block', () => {
  it('renders title with 1 input and 1 output, no params', () => {
    const { container } = wrap(
      <ReinterpretNode {...nodePropsBase('ri-1')} data={{}} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('Reinterpret')
    expect(container.querySelectorAll('input').length).toBe(0)
    expect(countHandles(container, 'target')).toBe(1)
    expect(countHandles(container, 'source')).toBe(1)
    const handles = container.querySelectorAll<HTMLElement>('.react-flow__handle')
    const ids = Array.from(handles).map((h) => h.getAttribute('data-handleid'))
    expect(ids).toContain('data-in')
    expect(ids).toContain('audio-out')
  })
})

describe('Subtractor block', () => {
  it('renders title with 2 inputs and 2 outputs, no params', () => {
    const { container } = wrap(
      <SubtractorNode {...nodePropsBase('sub-1')} data={{}} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('Subtractor')
    expect(container.querySelectorAll('input').length).toBe(0)
    expect(countHandles(container, 'target')).toBe(2)
    expect(countHandles(container, 'source')).toBe(2)
    const handles = container.querySelectorAll<HTMLElement>('.react-flow__handle')
    const ids = Array.from(handles).map((h) => h.getAttribute('data-handleid'))
    expect(ids).toContain('in-a')
    expect(ids).toContain('in-b')
    expect(ids).toContain('diff-out')
    expect(ids).toContain('borrow-out')
  })

  it('every handle has an aria-label', () => {
    const { container } = wrap(
      <SubtractorNode {...nodePropsBase('sub-2')} data={{}} />,
    )
    const handles = container.querySelectorAll<HTMLElement>('.react-flow__handle')
    for (const h of Array.from(handles)) {
      expect(h.getAttribute('aria-label')).toBeTruthy()
    }
  })
})

describe('Comparator block', () => {
  it('renders title with 2 inputs and 3 outputs, no params', () => {
    const { container } = wrap(
      <ComparatorNode {...nodePropsBase('cmp-1')} data={{}} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('Comparator')
    expect(container.querySelectorAll('input').length).toBe(0)
    expect(countHandles(container, 'target')).toBe(2)
    expect(countHandles(container, 'source')).toBe(3)
    const handles = container.querySelectorAll<HTMLElement>('.react-flow__handle')
    const ids = Array.from(handles).map((h) => h.getAttribute('data-handleid'))
    expect(ids).toContain('in-a')
    expect(ids).toContain('in-b')
    expect(ids).toContain('eq-out')
    expect(ids).toContain('lt-out')
    expect(ids).toContain('gt-out')
  })
})

describe('VCF block', () => {
  it('renders title with 2 inputs (audio-in + cutoff-in), 1 output, base + range fields', () => {
    const { container } = wrap(
      <VcfNode {...nodePropsBase('vcf-1')} data={{ base_cutoff: 1000, range: 2000 }} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('VCF')
    expect(countHandles(container, 'target')).toBe(2)
    expect(countHandles(container, 'source')).toBe(1)
    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="number"]')
    expect(inputs.length).toBe(2)
    expect(inputs[0].value).toBe('1000')
    expect(inputs[1].value).toBe('2000')
    const handles = container.querySelectorAll<HTMLElement>('.react-flow__handle')
    const ids = Array.from(handles).map((h) => h.getAttribute('data-handleid'))
    expect(ids).toContain('audio-in')
    expect(ids).toContain('cutoff-in')
    expect(ids).toContain('audio-out')
  })

  it('out-of-range base_cutoff (0) shows an error', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <VcfNode {...nodePropsBase('vcf-2')} data={{ base_cutoff: 1000, range: 2000 }} />,
    )
    const baseInput = container.querySelectorAll<HTMLInputElement>('input[type="number"]')[0]
    await user.clear(baseInput)
    await user.type(baseInput, '0')
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/1.*22050/)
  })
})

describe('HardSync block', () => {
  it('renders title with 1 input (sync-in), 1 output, and freq control', () => {
    const { container } = wrap(
      <HardsyncNode {...nodePropsBase('hs-1')} data={{ freq: 660 }} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('Hard Sync')
    expect(countHandles(container, 'target')).toBe(1)
    expect(countHandles(container, 'source')).toBe(1)
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')
    expect(input?.value).toBe('660')
    const handles = container.querySelectorAll<HTMLElement>('.react-flow__handle')
    const ids = Array.from(handles).map((h) => h.getAttribute('data-handleid'))
    expect(ids).toContain('sync-in')
    expect(ids).toContain('audio-out')
  })

  it('out-of-range freq (10) shows an error', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <HardsyncNode {...nodePropsBase('hs-2')} data={{ freq: 660 }} />,
    )
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!
    await user.clear(input)
    await user.type(input, '10')
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/20.*20000/)
  })
})

describe('AudioSum block', () => {
  it('renders title with 2 inputs and 1 output, no params', () => {
    const { container } = wrap(
      <AudioSumNode {...nodePropsBase('asm-1')} data={{}} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('Audio Sum')
    expect(container.querySelectorAll('input').length).toBe(0)
    expect(countHandles(container, 'target')).toBe(2)
    expect(countHandles(container, 'source')).toBe(1)
    const handles = container.querySelectorAll<HTMLElement>('.react-flow__handle')
    const ids = Array.from(handles).map((h) => h.getAttribute('data-handleid'))
    expect(ids).toContain('in-1')
    expect(ids).toContain('in-2')
    expect(ids).toContain('audio-out')
  })
})

describe('LFO block', () => {
  it('renders title with 0 inputs, 1 output, and rate + millihz + shape controls', () => {
    const { container } = wrap(
      <LfoNode {...nodePropsBase('lfo-1')} data={{ rate: 5, rate_millihz: 0, shape: 'sine' }} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('LFO')
    expect(countHandles(container, 'target')).toBe(0)
    expect(countHandles(container, 'source')).toBe(1)
    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="number"]')
    expect(inputs.length).toBe(2)
    expect(inputs[0].value).toBe('5')
    expect(inputs[1].value).toBe('0')
    const select = container.querySelector<HTMLSelectElement>('select')
    expect(select?.value).toBe('sine')
  })

  it('out-of-range rate (50) shows an error', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <LfoNode {...nodePropsBase('lfo-2')} data={{ rate: 5, rate_millihz: 0, shape: 'square' }} />,
    )
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!
    await user.clear(input)
    await user.type(input, '50')
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/0.*30/)
  })

  it('accepts sub-Hz via rate_millihz field (rate=0, millihz=500)', () => {
    const { container } = wrap(
      <LfoNode {...nodePropsBase('lfo-3')} data={{ rate: 0, rate_millihz: 500, shape: 'sine' }} />,
    )
    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="number"]')
    expect(inputs[0].value).toBe('0')
    expect(inputs[1].value).toBe('500')
  })
})

describe('VCO block', () => {
  it('renders title with 1 input, 1 output, and base_freq + range fields', () => {
    const { container } = wrap(
      <VcoNode {...nodePropsBase('vco-1')} data={{ base_freq: 440, range: 100 }} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('VCO')
    expect(countHandles(container, 'target')).toBe(1)
    expect(countHandles(container, 'source')).toBe(1)
    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="number"]')
    expect(inputs.length).toBe(2)
    expect(inputs[0].value).toBe('440')
    expect(inputs[1].value).toBe('100')
    const handles = container.querySelectorAll<HTMLElement>('.react-flow__handle')
    const ids = Array.from(handles).map((h) => h.getAttribute('data-handleid'))
    expect(ids).toContain('freq-in')
    expect(ids).toContain('audio-out')
  })

  it('out-of-range base_freq (10) shows an error', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <VcoNode {...nodePropsBase('vco-2')} data={{ base_freq: 440, range: 100 }} />,
    )
    const baseFreqInput = container.querySelectorAll<HTMLInputElement>('input[type="number"]')[0]
    await user.clear(baseFreqInput)
    await user.type(baseFreqInput, '10')
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/20.*20000/)
  })
})

describe('Shifter block', () => {
  it('renders title with 1 input, 1 output, and direction + amount controls', () => {
    const { container } = wrap(
      <ShifterNode {...nodePropsBase('sh-1')} data={{ direction: 'left', amount: 1 }} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('Shifter')
    expect(countHandles(container, 'target')).toBe(1)
    expect(countHandles(container, 'source')).toBe(1)
    const select = container.querySelector<HTMLSelectElement>('select')
    expect(select?.value).toBe('left')
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')
    expect(input?.value).toBe('1')
  })

  it('out-of-range amount (9) shows an error', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <ShifterNode {...nodePropsBase('sh-2')} data={{ direction: 'right', amount: 1 }} />,
    )
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!
    await user.clear(input)
    await user.type(input, '9')
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/1.*7/)
  })
})

describe('Mux block', () => {
  it('renders title with 3 inputs and 1 output, no params', () => {
    const { container } = wrap(
      <MuxNode {...nodePropsBase('mux-1')} data={{}} />,
    )
    expect(container.querySelector('.block-title')?.textContent).toBe('Mux')
    expect(container.querySelectorAll('input').length).toBe(0)
    expect(countHandles(container, 'target')).toBe(3)
    expect(countHandles(container, 'source')).toBe(1)
    const handles = container.querySelectorAll<HTMLElement>('.react-flow__handle')
    const ids = Array.from(handles).map((h) => h.getAttribute('data-handleid'))
    expect(ids).toContain('in-a')
    expect(ids).toContain('in-b')
    expect(ids).toContain('select')
    expect(ids).toContain('data-out')
  })
})

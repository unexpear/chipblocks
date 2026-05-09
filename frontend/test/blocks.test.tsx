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
import { SampleAndHoldNode } from '../src/blocks/SampleAndHoldNode'
import { FmNode } from '../src/blocks/FmNode'
import { MultiplyNode } from '../src/blocks/MultiplyNode'
import { WavetableNode } from '../src/blocks/WavetableNode'

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

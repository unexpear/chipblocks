import { describe, expect, it } from 'vitest'
import { type CanvasEdge, type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'

// A net label / power port: a named tie point. Every label sharing a name is electrically
// one net (a teleporting rail) without a drawn wire — the same merge ground already does,
// keyed by the user's net name instead of the single 0 V node.
const label = (id: string, name: string): CanvasNode => ({
  id,
  definition: 'net_label',
  parameters: { net_name: { value: name } },
})
const resistor = (id: string): CanvasNode => ({ id, definition: 'resistor' })
const wire = (
  id: string,
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
): CanvasEdge => ({ id, source, sourceHandle, target, targetHandle })

describe('net labels (power ports) in canvas-to-world', () => {
  it('two labels of the same name collapse into one net — no wire between them', () => {
    const world = canvasToWorld(
      [resistor('R1'), resistor('R2'), label('L1', '+5V'), label('L2', '+5V')],
      [
        wire('w1', 'R1', 'terminal_a', 'L1', 'reference_terminal'),
        wire('w2', 'R2', 'terminal_a', 'L2', 'reference_terminal'),
      ],
    )
    const labelNets = [...world.nets.values()].filter((n) => n.type === 'net_label')
    expect(labelNets).toHaveLength(1) // both +5V labels became ONE net
    const members = labelNets[0]?.members.map((m) => m.instance) ?? []
    expect(members).toContain('L1')
    expect(members).toContain('L2')
  })

  it('a net label carries no current — it is a tie point, not a solver device', () => {
    const world = canvasToWorld(
      [resistor('R1'), label('L1', '+5V')],
      [wire('w1', 'R1', 'terminal_a', 'L1', 'reference_terminal')],
    )
    expect(world.instances.has('L1')).toBe(false) // no device stamped for a net label
    expect(world.instances.has('R1')).toBe(true)
    expect(world.instances.has('wire_w1')).toBe(true)
  })

  it('different names stay separate nets — no accidental merge', () => {
    const world = canvasToWorld(
      [resistor('R1'), resistor('R2'), label('L1', '+5V'), label('L2', '+12V')],
      [
        wire('w1', 'R1', 'terminal_a', 'L1', 'reference_terminal'),
        wire('w2', 'R2', 'terminal_a', 'L2', 'reference_terminal'),
      ],
    )
    const labelNets = [...world.nets.values()].filter((n) => n.type === 'net_label')
    expect(labelNets).toHaveLength(2) // +5V and +12V are distinct rails
  })

  it('three same-named labels all merge — one rail across the whole sheet', () => {
    const world = canvasToWorld(
      [
        resistor('R1'),
        resistor('R2'),
        resistor('R3'),
        label('L1', 'VCC'),
        label('L2', 'VCC'),
        label('L3', 'VCC'),
      ],
      [
        wire('w1', 'R1', 'terminal_a', 'L1', 'reference_terminal'),
        wire('w2', 'R2', 'terminal_a', 'L2', 'reference_terminal'),
        wire('w3', 'R3', 'terminal_a', 'L3', 'reference_terminal'),
      ],
    )
    const labelNets = [...world.nets.values()].filter((n) => n.type === 'net_label')
    expect(labelNets).toHaveLength(1)
    expect(labelNets[0]?.members.filter((m) => m.instance.startsWith('L'))).toHaveLength(3)
  })

  it('an unnamed label is a local tie point only — it does not teleport', () => {
    const world = canvasToWorld(
      [resistor('R1'), resistor('R2'), label('L1', ''), label('L2', '')],
      [
        wire('w1', 'R1', 'terminal_a', 'L1', 'reference_terminal'),
        wire('w2', 'R2', 'terminal_a', 'L2', 'reference_terminal'),
      ],
    )
    // No shared rail: two blank labels are NOT one net.
    const labelNets = [...world.nets.values()].filter((n) => n.type === 'net_label')
    expect(labelNets).toHaveLength(0)
    // But the wires still connect (the labels are valid endpoints, just not teleporting).
    expect(world.instances.has('wire_w1')).toBe(true)
    expect(world.instances.has('wire_w2')).toBe(true)
  })
})

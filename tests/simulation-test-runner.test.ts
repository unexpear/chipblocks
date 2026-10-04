import { afterEach, describe, expect, test, vi } from 'vitest'
import { acTestResponse } from '../src/ac-analysis.ts'
import type { World } from '../src/cross-fk-validator.ts'
import { NAND2_BLOCK } from '../src/renderer/builtin-blocks.ts'
import * as traceEngine from '../src/renderer/run-trace.ts'
import {
  runDigitalTestCopy,
  runElectricalTestCopy,
} from '../src/renderer/simulation-test-runner.ts'
import type { SimulationAssertion } from '../src/simulation-assertions.ts'
import { simulationPreflight } from '../src/simulation-preflight.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

test('AC test refuses expired budgets before attempting the sweep', () => {
  const result = acTestResponse(
    loadedSource(),
    { inputSource: 'source', outputNet: 'supply' },
    [100],
    { deadline: -1 },
  )
  expect(result.complete).toBe(false)
  expect(result.points).toEqual([])
  expect(result.warnings.join(' ')).toContain('time budget')
})

test('AC test refuses an oversized matrix instead of allocating it', () => {
  const result = acTestResponse(
    loadedSource(),
    { inputSource: 'source', outputNet: 'supply' },
    [100],
    { maxUnknowns: 1 },
  )
  expect(result.complete).toBe(false)
  expect(result.points).toEqual([])
  expect(result.warnings.join(' ')).toContain('limit is 1')
})

test('AC partial sweep remains incomplete even when its first requested point is valid', () => {
  let checks = 0
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => (++checks <= 2 ? 0 : 100))
  try {
    const result = acTestResponse(
      loadedSource(),
      { inputSource: 'source', outputNet: 'supply' },
      [100, 200],
      { deadline: 50 },
    )
    expect(result.points).toHaveLength(1)
    expect(Number.isFinite(result.points[0]?.gain)).toBe(true)
    expect(result.complete).toBe(false)
    expect(result.warnings.join(' ')).toContain('incomplete')
  } finally {
    clock.mockRestore()
  }
})

function loadedSource(): World {
  return {
    definitions: new Map(),
    behaviors: new Map(),
    activeVariables: new Map(),
    instances: new Map([
      [
        'source',
        {
          id: 'source',
          kind_ref: 'primitive_device',
          definition: 'power_source',
          parameters: { nominal_voltage: scalar(1, 'volt') },
          connects: [
            { of: 'source', terminal: 'terminal_positive', net: 'supply' },
            { of: 'source', terminal: 'terminal_negative', net: 'ground' },
          ],
        },
      ],
      [
        'load',
        {
          id: 'load',
          kind_ref: 'primitive_device',
          definition: 'resistor',
          parameters: {
            resistance: scalar(1000, 'ohm'),
            thermal_resistance_junction_ambient: scalar(100, 'kelvin_per_watt'),
          },
          connects: [
            { of: 'load', terminal: 'terminal_a', net: 'supply' },
            { of: 'load', terminal: 'terminal_b', net: 'ground' },
          ],
        },
      ],
    ]),
    nets: new Map([
      [
        'supply',
        {
          id: 'supply',
          kind: 'net',
          members: [
            { instance: 'source', terminal: 'terminal_positive' },
            { instance: 'load', terminal: 'terminal_a' },
          ],
        },
      ],
      [
        'ground',
        {
          id: 'ground',
          kind: 'net',
          type: 'ground',
          members: [
            { instance: 'source', terminal: 'terminal_negative' },
            { instance: 'load', terminal: 'terminal_b' },
          ],
        },
      ],
    ]),
  }
}
const voltageTest: SimulationAssertion = {
  id: 'supply-voltage',
  label: 'One volt supply',
  signal: 'voltage:supply',
  unit: 'volt',
  measurement: { kind: 'point', at: 0 },
  expected: { kind: 'near', value: 1, absolute: 1e-9, relative: 0 },
  provenance: { kind: 'analytic', description: 'Ideal 1 V source fixes its output potential.' },
}

describe('isolated simulation tests and topology preflight', () => {
  afterEach(() => vi.restoreAllMocks())
  test('saved DC and AC probes follow terminal identity when generated net IDs change', () => {
    const world = loadedSource()
    const net = world.nets.get('supply')
    if (!net) throw new Error('missing net')
    world.nets.delete('supply')
    world.nets.set('renumbered', { ...net, id: 'renumbered' })
    for (const instance of world.instances.values())
      for (const connection of instance.connects ?? [])
        if (connection.net === 'supply') connection.net = 'renumbered'
    const endpoint = { blockId: 'source', terminalId: 'terminal_positive' }
    const dc = runElectricalTestCopy(world, { kind: 'dc', projectAmbientC: 25 }, [
      { ...voltageTest, probe: { kind: 'terminal-voltage', ...endpoint } },
    ])
    expect(dc.passed).toBe(true)
    expect(dc.reports[0]?.assertion.signal).toBe('voltage:renumbered')
    const ac = runElectricalTestCopy(
      world,
      {
        kind: 'ac',
        projectAmbientC: 25,
        inputSource: 'source',
        outputNet: 'supply',
        outputProbe: endpoint,
        frequenciesHz: [100],
      },
      [
        {
          ...voltageTest,
          signal: 'gain:supply',
          unit: 'dimensionless',
          probe: { kind: 'ac-output', ...endpoint },
          measurement: { kind: 'point', at: 100 },
        },
      ],
    )
    expect(ac.passed).toBe(true)
    expect(ac.reports[0]?.targets).toContainEqual({ netId: 'renumbered' })
    expect(voltageTest.signal).toBe('voltage:supply')
  })

  test('a deleted saved probe fails rather than following another net with the old name', () => {
    const result = runElectricalTestCopy(loadedSource(), { kind: 'dc', projectAmbientC: 25 }, [
      {
        ...voltageTest,
        probe: { kind: 'terminal-voltage', blockId: 'deleted', terminalId: 'pin' },
      },
    ])
    expect(result.passed).toBe(false)
    expect(result.findings[0]?.code).toBe('missing-probe')
  })
  test('zero AC amplitude is testable without inventing a defined phase or finite decibel gain', () => {
    const result = runElectricalTestCopy(
      loadedSource(),
      {
        kind: 'ac',
        projectAmbientC: 25,
        inputSource: 'source',
        outputNet: 'ground',
        frequenciesHz: [100],
      },
      [
        {
          ...voltageTest,
          signal: 'gain:ground',
          unit: 'dimensionless',
          measurement: { kind: 'point', at: 100 },
          expected: { kind: 'near', value: 0, absolute: 0, relative: 0 },
        },
      ],
    )
    expect(result.passed).toBe(true)
    expect(result.signals.get('phaseDeg:ground')?.samples[0]?.value).toBeNull()
    expect(result.signals.get('gainDb:ground')?.samples[0]?.value).toBeNull()
  })
  test('AC runs on a copy at explicit frequencies with numerical-model provenance', () => {
    const world = loadedSource()
    const before = structuredClone(world)
    const result = runElectricalTestCopy(
      world,
      {
        kind: 'ac',
        projectAmbientC: 25,
        inputSource: 'source',
        outputNet: 'supply',
        frequenciesHz: [100, 1000],
      },
      [
        {
          ...voltageTest,
          signal: 'gain:supply',
          unit: 'dimensionless',
          measurement: { kind: 'point', at: 1000 },
        },
      ],
    )
    expect(result.passed).toBe(true)
    expect(result.reports[0]?.axis).toBe('hertz')
    expect(result.warnings.join(' ')).toContain('1 nS')
    expect(world).toEqual(before)
  })

  test('AC omissions cannot pass even when the selected source still has the expected gain', () => {
    for (const definition of ['unrecognized-device', 'transistor_bjt_npn']) {
      const world = loadedSource()
      const load = world.instances.get('load')
      if (load) load.definition = definition
      const result = acTestResponse(world, { inputSource: 'source', outputNet: 'supply' }, [100])
      expect(result.points[0]?.gain).toBeCloseTo(1)
      expect(result.complete).toBe(false)
      expect(result.omitted.some((part) => part.id === 'load')).toBe(true)
    }
  })

  test('AC reports declared values it ignores instead of certifying their omission', () => {
    const world = loadedSource()
    const source = world.instances.get('source')
    if (!source?.parameters) throw new Error('missing source')
    source.parameters.internal_resistance = scalar(100, 'ohm')
    const result = acTestResponse(world, { inputSource: 'source', outputNet: 'supply' }, [100])
    expect(result.complete).toBe(false)
    expect(result.warnings.join(' ')).toContain('internal_resistance')
  })

  test.each([
    [[0]],
    [[Number.NaN]],
    [[100, 100]],
    [[200, 100]],
    [[]],
  ])('AC rejects invalid frequency sampling %s', (frequenciesHz) => {
    expect(
      acTestResponse(loadedSource(), { inputSource: 'source', outputNet: 'supply' }, frequenciesHz)
        .complete,
    ).toBe(false)
  })
  test('DC preview leaves the full live world unchanged and returns an independent snapshot', () => {
    const world = loadedSource()
    const before = structuredClone(world)
    const result = runElectricalTestCopy(world, { kind: 'dc', projectAmbientC: 25 }, [voltageTest])
    expect(result.passed).toBe(true)
    expect(result.findings).toEqual([])
    expect(world).toEqual(before)
    expect(result.inputSnapshot).not.toBe(world)
    if (!result.inputSnapshot || !('instances' in result.inputSnapshot))
      throw new Error('missing snapshot')
    result.inputSnapshot.instances.clear()
    expect(world).toEqual(before)
    expect(result.reports[0]?.provenance?.inputs).toContain('nominal_voltage')
  })
  test('thermal-limit assertions use the real settled temperature', () => {
    const request: SimulationAssertion = {
      ...voltageTest,
      id: 'heat',
      signal: 'temperature:load',
      unit: 'degree_celsius',
      expected: { kind: 'range', minimum: 25, maximum: 25.2 },
      provenance: { kind: 'analytic', description: 'T=25+(1^2/1000)*100=25.1 C' },
    }
    const result = runElectricalTestCopy(loadedSource(), { kind: 'dc', projectAmbientC: 25 }, [
      request,
    ])
    expect(result.passed).toBe(true)
    expect(result.reports[0]?.actual).toBeCloseTo(25.1, 4)
    expect(
      runElectricalTestCopy(loadedSource(), { kind: 'dc', projectAmbientC: 25 }, [
        { ...request, expected: { kind: 'range', minimum: 25, maximum: 25.05 } },
      ]).passed,
    ).toBe(false)
  })
  test('transient previews use their copy and preserve time-step provenance', () => {
    const world = loadedSource()
    const before = structuredClone(world)
    const result = runElectricalTestCopy(
      world,
      { kind: 'transient', projectAmbientC: 25, timeStep: 1e-5, duration: 2e-5 },
      [{ ...voltageTest, measurement: { kind: 'point', at: 2e-5 } }],
    )
    expect(result.passed).toBe(true)
    expect(world).toEqual(before)
    expect(result.reports[0]?.axis).toBe('second')
    expect(result.reports[0]?.provenance?.inputs).toContain('timeStep')
  })
  test('reports missing reference, broken membership, and disconnected islands with targets and repairs', () => {
    const world = loadedSource()
    world.nets.get('ground')?.members.pop()
    world.nets.set('island', {
      id: 'island',
      kind: 'net',
      members: [{ instance: 'missing', terminal: 'pin' }],
    })
    const findings = simulationPreflight(world)
    expect(findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['missing-membership', 'orphan-member', 'unreferenced-island']),
    )
    expect(
      findings.every((finding) => finding.repair.length > 0 && finding.targets.length > 0),
    ).toBe(true)
    const result = runElectricalTestCopy(world, { kind: 'dc', projectAmbientC: 25 }, [voltageTest])
    expect(result.passed).toBe(false)
    expect(result.signals.size).toBe(0)
    const ground = world.nets.get('ground')
    if (ground) delete ground.type
    expect(simulationPreflight(world).some((finding) => finding.code === 'missing-reference')).toBe(
      true,
    )
  })
  test('checks duplicate terminals and source shorts before solving', () => {
    const world = loadedSource()
    const source = world.instances.get('source')
    if (!source?.connects) throw new Error('missing source')
    source.connects.push({ of: 'source', terminal: 'terminal_positive', net: 'ground' })
    const negative = source.connects[1]
    if (negative) negative.net = 'supply'
    expect(simulationPreflight(world).map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['duplicate-terminal', 'source-shorted']),
    )
  })
  test('unsupported devices cannot certify a plausible supported-subcircuit result', () => {
    const world = loadedSource()
    const load = world.instances.get('load')
    if (load) load.definition = 'not-a-supported-device'
    const result = runElectricalTestCopy(world, { kind: 'dc', projectAmbientC: 25 }, [voltageTest])
    expect(result.passed).toBe(false)
    expect(result.reports[0]?.status).toBe('unavailable')
    expect(result.warnings.join(' ')).toContain('Unsupported')
  })
  test('digital execution cannot mutate nested live blocks or held input maps', () => {
    const block = structuredClone(NAND2_BLOCK)
    const inputs = new Map([
      ['a', 1],
      ['b', 1],
    ])
    const before = structuredClone(block)
    const trace = traceEngine.runTrace(block, 1, inputs)
    if (!trace) throw new Error('no trace')
    vi.spyOn(traceEngine, 'runTrace').mockImplementation((copy, _cycles, held) => {
      copy.origin.x = 123
      copy.nodes.splice(0)
      held?.set('a', 0)
      return trace
    })
    const request: SimulationAssertion = {
      ...voltageTest,
      signal: 'out',
      unit: 'dimensionless',
      measurement: { kind: 'point', at: 1 },
      expected: { kind: 'near', value: 0, absolute: 0, relative: 0 },
    }
    const result = runDigitalTestCopy(block, 'nand', 1, inputs, [request])
    expect(result.passed).toBe(true)
    expect(result.reports[0]?.provenance?.inputs).toContain('["a",1]')
    expect(block).toEqual(before)
    expect(inputs.get('a')).toBe(1)
  })
  test('invalid requests fail without changing their live inputs', () => {
    const world = loadedSource()
    const before = structuredClone(world)
    expect(
      runElectricalTestCopy(world, { kind: 'dc', projectAmbientC: Number.NaN }, [voltageTest])
        .passed,
    ).toBe(false)
    expect(
      runElectricalTestCopy(
        world,
        { kind: 'transient', projectAmbientC: 25, timeStep: 0, duration: 1 },
        [voltageTest],
      ).passed,
    ).toBe(false)
    expect(world).toEqual(before)
    expect(runDigitalTestCopy(NAND2_BLOCK, 'nand', 257, new Map(), []).findings[0]?.code).toBe(
      'invalid-digital-inputs',
    )
  })

  test('empty identities produce a preflight report rather than an exception', () => {
    const world = loadedSource()
    const load = world.instances.get('load')
    if (load) load.id = ''
    expect(
      runElectricalTestCopy(world, { kind: 'dc', projectAmbientC: 25 }, [voltageTest]).findings[0]
        ?.code,
    ).toBe('empty-identity')
  })

  test('rejects ignored input names and values the digital pins cannot represent', () => {
    for (const inputs of [new Map([['typo', 1]]), new Map([['a', 2]]), new Map([['a', -1]])]) {
      const result = runDigitalTestCopy(NAND2_BLOCK, 'nand', 1, inputs, [])
      expect(result.passed).toBe(false)
      expect(result.findings[0]?.code).toMatch(/invalid-digital/)
    }
  })
})

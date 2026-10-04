import type { AcPoint } from '../ac-analysis.ts'
import type { World } from '../cross-fk-validator.ts'
import type { Solution } from '../dc-solver.ts'
import { asBlockId, asNetId, asTerminalId, type RuntimeTarget } from '../runtime-contracts.ts'
import type { TestSeries, TestUnit } from '../simulation-assertions.ts'
import type { TransientPoint, TransientResult } from '../transient-solver.ts'
import { buildMathView } from './math-view.ts'
import type { TraceResult } from './run-trace.ts'

const nullable = (value: number | undefined): number | null =>
  value !== undefined && Number.isFinite(value) ? value : null

export function dcTestSignals(
  world: World,
  solution: Solution,
  inputs: string,
  temperatures: ReadonlyMap<string, number>,
  thermalConverged: boolean,
): Map<string, TestSeries> {
  const signals = new Map<string, TestSeries>()
  const status =
    solution.status === 'unsupported-element'
      ? 'unsupported'
      : solution.status === 'solved' && solution.converged
        ? 'complete'
        : 'incomplete'
  const add = (
    id: string,
    value: number | null,
    unit: TestUnit,
    targets: RuntimeTarget[],
    formula: string,
    complete = true,
  ) => {
    signals.set(id, {
      axis: 'operating-point',
      unit,
      status: complete ? status : 'incomplete',
      samples: [{ at: 0, value }],
      targets,
      provenance: { engine: 'dc', inputs, formula },
      warnings: [...solution.warnings],
    })
  }
  for (const net of world.nets.values())
    add(
      `voltage:${net.id}`,
      nullable(solution.nodes.get(net.id)),
      'volt',
      [{ netId: asNetId(net.id) }],
      'V(net) relative to the solved ground',
    )
  for (const instance of world.instances.values()) {
    add(
      `current:${instance.id}`,
      nullable(solution.branches.get(instance.id)),
      'ampere',
      [{ blockId: asBlockId(instance.id) }],
      'signed solver branch current; multi-terminal devices use the solver branch convention',
    )
    add(
      `temperature:${instance.id}`,
      nullable(temperatures.get(instance.id)),
      'degree_celsius',
      [{ blockId: asBlockId(instance.id) }],
      'recorded electro-thermal fixed-point temperature',
      thermalConverged,
    )
  }
  for (const net of buildMathView(world, solution).nets)
    add(
      `kcl:${net.id}`,
      net.sumAmps,
      'ampere',
      [{ netId: asNetId(net.id) }],
      `Σ signed currents at net; ${net.terms.join(' + ')}`,
    )
  return signals
}

export function acTestSignals(
  points: AcPoint[],
  inputSource: string,
  outputNet: string,
  inputs: string,
  warnings: string[],
  supported: boolean,
): Map<string, TestSeries> {
  const signals = new Map<string, TestSeries>()
  for (const [quantity, unit, formula] of [
    ['gain', 'dimensionless', '|Vout / Vin|'],
    ['gainDb', 'decibel', '20 log10 |Vout / Vin|'],
    ['phaseDeg', 'degree', 'arg(Vout / Vin) in degrees'],
  ] as const) {
    signals.set(`${quantity}:${outputNet}`, {
      axis: 'hertz',
      unit,
      status: supported ? 'complete' : 'unsupported',
      samples: points.map((point) => ({
        at: point.frequencyHz,
        value: quantity === 'phaseDeg' && point.gain === 0 ? null : nullable(point[quantity]),
      })),
      targets: [{ blockId: asBlockId(inputSource) }, { netId: asNetId(outputNet) }],
      provenance: { engine: 'ac', inputs, formula },
      warnings: [...warnings],
    })
  }
  return signals
}

export function digitalTestSignals(
  trace: TraceResult,
  blockId: string,
  inputs: string,
): Map<string, TestSeries> {
  return new Map(
    trace.outputs.map((signal) => [
      signal.name,
      {
        axis: 'cycle',
        unit: 'dimensionless',
        status: trace.cycles.every((cycle) => cycle.settled) ? 'complete' : 'incomplete',
        samples: trace.cycles.map((cycle) => ({
          at: cycle.cycle,
          value: nullable(cycle.values.get(signal.name)),
        })),
        targets: [{ blockId: asBlockId(blockId) }],
        provenance: {
          engine: 'run-trace',
          inputs,
          formula:
            'integer output after each full clock cycle; constant input vector; cold all-low state',
        },
        warnings: trace.anomalies.map((anomaly) => anomaly.detail),
      },
    ]),
  )
}

export function transientTestSignals(
  world: World,
  result: TransientResult,
  inputs: string,
): Map<string, TestSeries> {
  const signals = new Map<string, TestSeries>()
  const status =
    result.status === 'solved'
      ? 'complete'
      : result.status === 'unsupported-element'
        ? 'unsupported'
        : 'incomplete'
  const add = (
    id: string,
    unit: TestUnit,
    targets: RuntimeTarget[],
    formula: string,
    valueAt: (point: TransientPoint) => number | null,
  ) => {
    signals.set(id, {
      axis: 'second',
      unit,
      status,
      samples: result.series.map((point) => ({ at: point.time, value: valueAt(point) })),
      targets,
      provenance: { engine: 'transient', inputs, formula },
      warnings: [...result.warnings],
    })
  }
  const voltage = (point: TransientPoint, net: string) =>
    net === result.ground ? 0 : nullable(point.nodes.get(net))
  const powerAt = (point: TransientPoint, instanceId: string): number | null => {
    const connects = world.instances.get(instanceId)?.connects
    if (
      !connects?.length ||
      new Set(connects.map((connection) => connection.terminal)).size !== connects.length
    )
      return null
    let power = 0
    for (const connection of connects) {
      const volts = voltage(point, connection.net)
      const amps = nullable(point.currents?.get(`${instanceId}/${connection.terminal}`))
      if (volts === null || amps === null) return null
      power += volts * amps
    }
    return nullable(power)
  }
  const devices = [...world.instances.values()].filter(
    (instance) => instance.definition !== 'ground',
  )
  for (const net of world.nets.values()) {
    add(
      `voltage:${net.id}`,
      'volt',
      [{ netId: asNetId(net.id) }],
      'V(net,t) relative to solved ground',
      (point) => voltage(point, net.id),
    )
    add(
      `kcl:${net.id}`,
      'ampere',
      [{ netId: asNetId(net.id) }],
      'Σ signed currents leaving the net into device terminals',
      (point) => {
        let residual = 0
        const members = net.members.filter(
          (member) => world.instances.get(member.instance)?.definition !== 'ground',
        )
        if (members.length === 0) return null
        for (const member of members) {
          const amps = nullable(point.currents?.get(`${member.instance}/${member.terminal}`))
          if (amps === null) return null
          residual += amps
        }
        return nullable(residual)
      },
    )
  }
  for (const instance of devices) {
    add(
      `power:${instance.id}`,
      'watt',
      [{ blockId: asBlockId(instance.id) }],
      'Pabsorbed(t) = Σ Vterminal(t) × Iinto-terminal(t)',
      (point) => powerAt(point, instance.id),
    )
    for (const connection of instance.connects ?? [])
      add(
        `current:${instance.id}/${connection.terminal}`,
        'ampere',
        [
          {
            blockId: asBlockId(instance.id),
            terminalId: asTerminalId(connection.terminal),
            netId: asNetId(connection.net),
          },
        ],
        'signed recorded current into this device terminal',
        (point) => nullable(point.currents?.get(`${instance.id}/${connection.terminal}`)),
      )
  }
  add(
    'power-balance',
    'watt',
    devices.map((instance) => ({ blockId: asBlockId(instance.id) })),
    'Σ Pabsorbed over all recorded devices, including signed source delivery and reactive absorption',
    (point) => {
      if (devices.length === 0) return null
      let total = 0
      for (const instance of devices) {
        const power = powerAt(point, instance.id)
        if (power === null) return null
        total += power
      }
      return nullable(total)
    },
  )
  return signals
}

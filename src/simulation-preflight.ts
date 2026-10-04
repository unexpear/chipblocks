import type { World } from './cross-fk-validator.ts'
import { readScalarParam } from './instance-params.ts'
import { asBlockId, asNetId, asTerminalId, type RuntimeTarget } from './runtime-contracts.ts'

export type PreflightFinding = {
  code: string
  severity: 'error' | 'warning'
  message: string
  targets: RuntimeTarget[]
  repair: string
}

export function transientModelPreflight(world: World): PreflightFinding[] {
  return [...world.instances.values()].flatMap((instance) => {
    if (instance.definition !== 'capacitor') return []
    const ignored = ['esr', 'dissipation_factor'].filter((parameter) => {
      const value = readScalarParam(instance, parameter)
      return value !== undefined && value !== 0
    })
    if (ignored.length === 0) return []
    return [
      {
        code: 'unsupported-transient-capacitor-loss',
        severity: 'error' as const,
        message: `${instance.id}: declared ${ignored.join(', ')} is modeled in AC but is not read by the transient capacitor model.`,
        targets: [{ blockId: asBlockId(instance.id) }],
        repair:
          'Use AC to test the declared loss, or represent a known constant ESR as an explicit series resistor for transient analysis. Do not remove real loss merely to obtain a passing test.',
      },
    ]
  })
}

export function simulationPreflight(world: World): PreflightFinding[] {
  const findings: PreflightFinding[] = []
  const names = [
    ...world.instances.keys(),
    ...world.nets.keys(),
    ...[...world.instances.values()].flatMap((instance) => [
      instance.id,
      ...(instance.connects ?? []).flatMap((connection) => [
        connection.of,
        connection.net,
        connection.terminal,
      ]),
    ]),
    ...[...world.nets.values()].flatMap((net) => [
      net.id,
      ...net.members.flatMap((member) => [member.instance, member.terminal]),
    ]),
  ]
  if (names.some((name) => !name.trim()))
    return [
      {
        code: 'empty-identity',
        severity: 'error',
        message: 'A device, net, or terminal has an empty identity.',
        targets: [],
        repair: 'Repair empty identities before running connectivity checks.',
      },
    ]
  const add = (
    code: string,
    message: string,
    targets: RuntimeTarget[],
    repair: string,
    severity: PreflightFinding['severity'] = 'error',
  ) => {
    findings.push({ code, severity, message, targets, repair })
  }
  const grounds = [...world.nets.values()].filter((net) => net.type === 'ground')
  if (grounds.length === 0)
    add(
      'missing-reference',
      'No ground reference is declared.',
      [],
      'Connect a ground reference before running an electrical test.',
    )
  if (grounds.length > 1)
    add(
      'multiple-references',
      'Several nets are marked as ground; the engines may choose different references.',
      grounds.map((net) => ({ netId: asNetId(net.id) })),
      'Use one explicit reference net for a reproducible test.',
    )
  const adjacent = new Map([...world.nets.keys()].map((id) => [id, new Set<string>()]))
  for (const [key, instance] of world.instances) {
    const target = { blockId: asBlockId(instance.id) }
    if (key !== instance.id)
      add(
        'instance-key',
        'An instance map key differs from its ID.',
        [target],
        'Repair the instance identity before testing.',
      )
    const connects = instance.connects ?? []
    if (instance.kind_ref === 'primitive_device' && connects.length === 0)
      add(
        'unconnected-device',
        `${instance.id} has no connected terminals.`,
        [target],
        'Connect or remove the unused device before certifying the circuit.',
      )
    const seen = new Set<string>()
    for (const connection of connects) {
      const endpoint = {
        ...target,
        terminalId: asTerminalId(connection.terminal),
        netId: asNetId(connection.net),
      }
      if (seen.has(connection.terminal))
        add(
          'duplicate-terminal',
          `${instance.id}/${connection.terminal} is connected more than once.`,
          [endpoint],
          'Keep one net connection per terminal; join wires through a net instead.',
        )
      seen.add(connection.terminal)
      const net = world.nets.get(connection.net)
      if (!net)
        add(
          'missing-net',
          `${instance.id}/${connection.terminal} refers to a missing net.`,
          [endpoint],
          'Reconnect the terminal to an existing net.',
        )
      if (connection.of !== instance.id)
        add(
          'wrong-owner',
          'A terminal connection names a different owning device.',
          [endpoint],
          'Correct the terminal owner.',
        )
      if (
        net &&
        !net.members.some(
          (member) => member.instance === instance.id && member.terminal === connection.terminal,
        )
      )
        add(
          'missing-membership',
          'The device connection is absent from its net membership.',
          [endpoint],
          'Rebuild connectivity so device and net records agree.',
        )
      const terminals = world.definitions.get(instance.definition)?.terminals
      if (terminals && !Object.hasOwn(terminals, connection.terminal))
        add(
          'unknown-terminal',
          `${instance.id} has no declared terminal ${connection.terminal}.`,
          [endpoint],
          'Select a terminal declared by this device.',
        )
    }
    const first = connects[0]?.net
    if (first && adjacent.has(first)) {
      for (const connection of connects) {
        if (!adjacent.has(connection.net)) continue
        adjacent.get(first)?.add(connection.net)
        adjacent.get(connection.net)?.add(first)
      }
    }
    if (instance.definition === 'power_source') {
      const positive = connects.find((connection) => connection.terminal === 'terminal_positive')
      const negative = connects.find((connection) => connection.terminal === 'terminal_negative')
      if (!positive || !negative)
        add(
          'source-terminal',
          'A voltage source is missing a required terminal connection.',
          [target],
          'Connect both positive and negative terminals.',
        )
      else if (positive.net === negative.net)
        add(
          'source-shorted',
          'Both voltage-source terminals are on the same net.',
          [target, { netId: asNetId(positive.net) }],
          'Inspect the source wiring and remove the direct short.',
        )
    }
  }
  for (const [key, net] of world.nets) {
    const target = { netId: asNetId(net.id) }
    if (key !== net.id)
      add(
        'net-key',
        'A net map key differs from its ID.',
        [target],
        'Repair the net identity before testing.',
      )
    const seen = new Set<string>()
    for (const member of net.members) {
      const endpoint = `${member.instance}/${member.terminal}`
      if (seen.has(endpoint))
        add(
          'duplicate-member',
          `Net ${net.id} lists ${endpoint} twice.`,
          [target],
          'Remove duplicate net membership.',
        )
      seen.add(endpoint)
      const instance = world.instances.get(member.instance)
      if (
        !instance?.connects?.some(
          (connection) => connection.net === net.id && connection.terminal === member.terminal,
        )
      )
        add(
          'orphan-member',
          `Net ${net.id} lists a missing or inconsistent terminal ${endpoint}.`,
          [target],
          'Rebuild the net membership from existing device terminals.',
        )
    }
  }
  if (grounds.length === 1) {
    const reachable = new Set<string>()
    const queue = grounds.map((net) => net.id)
    for (let index = 0; index < queue.length; index++) {
      const net = queue[index]
      if (net === undefined || reachable.has(net)) continue
      reachable.add(net)
      for (const next of adjacent.get(net) ?? []) if (!reachable.has(next)) queue.push(next)
    }
    for (const net of world.nets.values()) {
      if (!reachable.has(net.id) && net.members.length > 0)
        add(
          'unreferenced-island',
          `Net ${net.id} has no structural path to ground.`,
          [{ netId: asNetId(net.id) }],
          'Connect a reference or test this island separately. Structural reachability does not prove conduction.',
        )
    }
  }
  return findings
}

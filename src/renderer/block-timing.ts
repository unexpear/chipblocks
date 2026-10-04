import type { Instance } from '../cross-fk-validator.ts'
import { readScalarParam } from '../instance-params.ts'
import type { TimingPath } from '../static-timing.ts'
import { blockSemanticProblems } from './block-semantics.ts'
import { type BlockData, type CanvasNodeLike, flattenBlocks } from './blocks.ts'
import { ANNOTATION_DEFINITIONS } from './part-defaults.ts'
import {
  characterizeGate,
  gateDelay,
  isClockedBlock,
  type TraceOptions,
  traceTimingPaths,
} from './timing-graph.ts'

export type BlockTimingOptions = TraceOptions & { externalPortsUnloaded: boolean }
export type BlockTimingReport = {
  state: 'estimated' | 'blocked' | 'unsupported'
  reasons: string[]
  paths: TimingPath[]
  longestLogicDelay: number | null
  gates: { id: string; referenceLoadDelay: number | null }[]
  registerIds: string[]
  assumptions: BlockTimingOptions
}

export function blockTiming(
  block: BlockData,
  instanceId: string,
  options: BlockTimingOptions,
): BlockTimingReport {
  const report: BlockTimingReport = {
    state: 'blocked',
    reasons: [],
    paths: [],
    longestLogicDelay: null,
    gates: [],
    registerIds: [],
    assumptions: { ...options },
  }
  report.reasons = blockSemanticProblems(block, instanceId)
  if (report.reasons.length) return report
  if (
    !Number.isFinite(options.supplyVoltage) ||
    options.supplyVoltage <= 0 ||
    !Number.isFinite(options.wireCapacitance) ||
    options.wireCapacitance < 0 ||
    !Number.isFinite(options.defaultInputCapacitance) ||
    options.defaultInputCapacitance <= 0
  ) {
    report.reasons.push(
      'Provide a positive supply and reference input capacitance, and nonnegative wire capacitance, in SI units.',
    )
    return report
  }
  if (!options.externalPortsUnloaded) {
    report.reasons.push(
      'External output loads are not included. Confirm an unloaded-port estimate or use a transient test with the real loads.',
    )
    return report
  }
  const leaf = (candidate: BlockData) => !candidate.nodes.some((node) => node.block)
  const nodes: CanvasNodeLike[] = [
    { id: instanceId, position: block.origin, data: { definition: 'block', block } },
  ]
  const flat = flattenBlocks(
    nodes,
    [],
    (candidate) => (candidate !== block && isClockedBlock(candidate)) || leaf(candidate),
  )
  if (flat.nodes.length > 2048) {
    report.reasons.push(
      'Internal timing is limited to 2,048 gate/register objects per block. Inspect a smaller sub-block.',
    )
    return report
  }
  for (const node of flat.nodes) {
    const internal = node.data.block
    if (!internal) {
      if (
        !['ground', 'power_source', 'junction'].includes(node.data.definition) &&
        !ANNOTATION_DEFINITIONS.has(node.data.definition)
      )
        report.reasons.push(
          `${node.id}: primitive ${node.data.definition} is not characterized by the gate timing model.`,
        )
      continue
    }
    if (isClockedBlock(internal)) {
      report.registerIds.push(node.id)
      continue
    }
    const supported = internal.nodes.every(
      (part) =>
        part.definition === 'transistor_mosfet_nmos' ||
        part.definition === 'transistor_mosfet_pmos',
    )
    const bothPullNetworks =
      internal.nodes.some((part) => part.definition === 'transistor_mosfet_nmos') &&
      internal.nodes.some((part) => part.definition === 'transistor_mosfet_pmos')
    const biased = internal.nodes.every((part) => {
      const instance = { parameters: part.parameters } as Instance
      const threshold = readScalarParam(instance, 'threshold_voltage')
      const transconductance = readScalarParam(instance, 'transconductance_parameter')
      const gateCapacitance = readScalarParam(instance, 'gate_capacitance')
      return (
        threshold !== undefined &&
        Number.isFinite(threshold) &&
        options.supplyVoltage > Math.abs(threshold) &&
        transconductance !== undefined &&
        Number.isFinite(transconductance) &&
        transconductance > 0 &&
        gateCapacitance !== undefined &&
        Number.isFinite(gateCapacitance) &&
        gateCapacitance > 0
      )
    })
    const characteristics = characterizeGate(internal, options.supplyVoltage)
    const inputCapsKnown =
      characteristics.inputCapacitance.size > 0 &&
      [...characteristics.inputCapacitance.values()].every(
        (capacitance) => Number.isFinite(capacitance) && capacitance > 0,
      )
    const delay =
      supported && bothPullNetworks && biased && inputCapsKnown
        ? gateDelay(
            internal,
            options.supplyVoltage,
            [options.defaultInputCapacitance],
            options.wireCapacitance,
          )
        : Number.POSITIVE_INFINITY
    report.gates.push({ id: node.id, referenceLoadDelay: Number.isFinite(delay) ? delay : null })
    if (!Number.isFinite(delay))
      report.reasons.push(
        `${node.id}: gate resistance or capacitance is not characterized at this supply.`,
      )
  }
  if (report.reasons.length) {
    report.state = 'unsupported'
    return report
  }
  try {
    report.paths = traceTimingPaths(flat.nodes, flat.edges, { ...options, maxVisits: 10000 })
  } catch (error) {
    report.reasons.push(
      error instanceof Error ? error.message : 'Internal timing could not complete.',
    )
    return report
  }
  if (report.paths.some((path) => !Number.isFinite(path.logicDelayMax) || path.logicDelayMax < 0)) {
    report.state = 'unsupported'
    report.reasons.push('At least one internal path has an uncharacterized delay.')
    return report
  }
  if (report.paths.length)
    report.longestLogicDelay = report.paths.reduce(
      (maximum, path) => Math.max(maximum, path.logicDelayMax),
      0,
    )
  report.state = report.paths.length || report.gates.length ? 'estimated' : 'unsupported'
  if (report.state === 'unsupported')
    report.reasons.push('No modeled gate or register-to-register path was found inside this block.')
  return report
}

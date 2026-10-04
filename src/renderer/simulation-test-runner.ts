import { acTestResponse } from '../ac-analysis.ts'
import type { World } from '../cross-fk-validator.ts'
import { solveTransientThermal } from '../electro-thermal.ts'
import { solveWithRelays } from '../relay.ts'
import { asBlockId } from '../runtime-contracts.ts'
import { worldWithShockleyStates } from '../shockley-diode.ts'
import {
  type AssertionReport,
  evaluateAssertions,
  type SimulationAssertion,
  type TestSeries,
} from '../simulation-assertions.ts'
import {
  type PreflightFinding,
  simulationPreflight,
  transientModelPreflight,
} from '../simulation-preflight.ts'
import { solveDeadline } from '../solver-budget.ts'
import { blockSemanticProblems } from './block-semantics.ts'
import type { BlockData } from './blocks.ts'
import { MAX_TRACE_CYCLES, runTrace } from './run-trace.ts'
import {
  acTestSignals,
  dcTestSignals,
  digitalTestSignals,
  transientTestSignals,
} from './simulation-test-results.ts'

export type ElectricalTestRun =
  | { kind: 'dc'; projectAmbientC: number }
  | { kind: 'transient'; projectAmbientC: number; timeStep: number; duration: number }
  | {
      kind: 'ac'
      projectAmbientC: number
      inputSource: string
      outputNet: string
      outputProbe?: { blockId: string; terminalId: string }
      frequenciesHz: number[]
    }

export type SimulationTestRunResult = {
  passed: boolean
  reports: AssertionReport[]
  findings: PreflightFinding[]
  signals: Map<string, TestSeries>
  warnings: string[]
  inputSnapshot: World | BlockData | null
}

const failure = (code: string, message: string): SimulationTestRunResult => ({
  passed: false,
  reports: [],
  signals: new Map(),
  warnings: [],
  inputSnapshot: null,
  findings: [
    {
      code,
      severity: 'error',
      message,
      targets: [],
      repair: 'Correct the test inputs and rerun on an isolated copy.',
    },
  ],
})

export function runElectricalTestCopy(
  liveWorld: World,
  requested: ElectricalTestRun,
  requestedAssertions: SimulationAssertion[],
): SimulationTestRunResult {
  let world: World
  let assertions: SimulationAssertion[]
  let request: ElectricalTestRun
  try {
    world = structuredClone(liveWorld)
    assertions = structuredClone(requestedAssertions)
    request = structuredClone(requested)
  } catch {
    return failure(
      'copy-failed',
      'The test inputs could not be copied; the live design was not simulated.',
    )
  }
  if (!Number.isFinite(request.projectAmbientC) || request.projectAmbientC < -273.15)
    return failure(
      'invalid-ambient',
      'Ambient temperature must be finite and not below absolute zero.',
    )
  const findings = simulationPreflight(world)
  const inputSnapshot = structuredClone(world)
  if (findings.some((finding) => finding.severity === 'error'))
    return { passed: false, reports: [], findings, signals: new Map(), warnings: [], inputSnapshot }
  for (const assertion of assertions) {
    if (!assertion.probe) continue
    const probe = assertion.probe
    const connection = world.instances
      .get(probe.blockId)
      ?.connects?.find((candidate) => candidate.terminal === probe.terminalId)
    if (!connection)
      return failure(
        'missing-probe',
        `The saved probe ${probe.blockId}/${probe.terminalId} no longer exists; reconnect or update this test.`,
      )
    const quantity =
      probe.kind === 'terminal-voltage'
        ? 'voltage'
        : probe.kind === 'net-kcl'
          ? 'kcl'
          : assertion.signal.split(':')[0]
    if (probe.kind === 'ac-output' && !['gain', 'gainDb', 'phaseDeg'].includes(quantity ?? ''))
      return failure('invalid-probe', 'An AC output probe must select gain, gainDb, or phaseDeg.')
    assertion.signal = `${quantity}:${connection.net}`
  }
  if (request.kind === 'ac' && request.outputProbe) {
    const probe = request.outputProbe
    const connection = world.instances
      .get(probe.blockId)
      ?.connects?.find((candidate) => candidate.terminal === probe.terminalId)
    if (!connection)
      return failure(
        'missing-probe',
        `AC output ${probe.blockId}/${probe.terminalId} no longer exists.`,
      )
    request.outputNet = connection.net
  }
  const inputs = JSON.stringify({
    request,
    instances: [...world.instances.values()],
    nets: [...world.nets.values()],
    activeVariables: [...world.activeVariables.values()],
  })
  let signals: Map<string, TestSeries>
  let warnings: string[]
  const deadline = solveDeadline(undefined)
  try {
    if (request.kind === 'dc') {
      const result = solveWithRelays(world, { projectAmbientC: request.projectAmbientC, deadline })
      warnings = [...result.solution.warnings, ...result.warnings]
      signals = dcTestSignals(
        world,
        result.solution,
        inputs,
        result.temperaturesC,
        result.thermalConverged,
      )
      if (!result.thermalConverged || !result.relaysSettled)
        for (const series of signals.values()) series.status = 'incomplete'
    } else if (request.kind === 'ac') {
      const bias = solveWithRelays(world, { projectAmbientC: request.projectAmbientC, deadline })
      const biasedWorld = worldWithShockleyStates(world, bias.shockleyStates)
      for (const [id, state] of bias.relayStates) {
        const instance = biasedWorld.instances.get(id)
        if (instance)
          biasedWorld.instances.set(id, {
            ...instance,
            parameters: { ...instance.parameters, coil_state: { value: state } },
          })
      }
      const result = acTestResponse(
        biasedWorld,
        {
          inputSource: request.inputSource,
          outputNet: request.outputNet,
          temperaturesC: bias.temperaturesC,
        },
        request.frequenciesHz,
        { deadline },
      )
      warnings = [...bias.solution.warnings, ...bias.warnings, ...result.warnings]
      for (const part of result.omitted)
        findings.push({
          code: 'unsupported-ac-model',
          severity: 'error',
          message: `${part.id}: ${part.reason}`,
          targets: [{ blockId: asBlockId(part.id) }],
          repair:
            'Use a supported model or a different analysis; this AC result cannot certify the omitted device.',
        })
      signals = acTestSignals(
        result.points,
        request.inputSource,
        request.outputNet,
        inputs,
        warnings,
        result.complete,
      )
      if (bias.solution.status !== 'solved' || !bias.thermalConverged || !bias.relaysSettled)
        for (const series of signals.values()) series.status = 'incomplete'
    } else {
      if (
        !Number.isFinite(request.timeStep) ||
        !Number.isFinite(request.duration) ||
        request.timeStep <= 0 ||
        request.duration < request.timeStep
      )
        return failure(
          'invalid-time-window',
          'Choose a positive finite time step and a duration of at least one time step.',
        )
      const result = solveTransientThermal(world, { ...request, deadline })
      const modelFindings = transientModelPreflight(world)
      findings.push(...modelFindings)
      warnings = [
        ...result.result.warnings,
        ...result.warnings,
        ...modelFindings.map((finding) => finding.message),
      ]
      signals = transientTestSignals(world, result.result, inputs)
      if (modelFindings.length > 0)
        for (const series of signals.values()) series.status = 'unsupported'
      if (!result.thermalConverged)
        for (const series of signals.values()) series.status = 'incomplete'
    }
    for (const series of signals.values())
      series.warnings = [...new Set([...series.warnings, ...warnings])]
  } catch (error) {
    return failure(
      'simulation-failed',
      error instanceof Error ? error.message : 'The isolated simulation failed.',
    )
  }
  return { ...evaluateAssertions(assertions, signals), findings, signals, warnings, inputSnapshot }
}

export function runDigitalTestCopy(
  liveBlock: BlockData,
  blockId: string,
  cycles: number,
  inputs: Map<string, number>,
  requestedAssertions: SimulationAssertion[],
): SimulationTestRunResult {
  if (
    !Number.isInteger(cycles) ||
    cycles < 1 ||
    cycles > MAX_TRACE_CYCLES ||
    [...inputs.values()].some((value) => !Number.isSafeInteger(value) || value < 0)
  )
    return failure(
      'invalid-digital-inputs',
      `Choose 1–${MAX_TRACE_CYCLES} whole cycles and non-negative safe-integer input values.`,
    )
  try {
    const block = structuredClone(liveBlock)
    const problems = blockSemanticProblems(block, blockId)
    if (problems.length) return failure('invalid-block-contract', problems.join(' '))
    const inputSnapshot = structuredClone(block)
    const held = structuredClone(inputs)
    const assertions = structuredClone(requestedAssertions)
    const provenance = JSON.stringify({
      blockId,
      cycles,
      inputs: [...held],
      initialState: 'cold all-low',
    })
    const trace = runTrace(block, cycles, held)
    if (!trace || trace.cycles.length !== cycles)
      return failure('incomplete-trace', 'The digital trace did not cover the requested run.')
    for (const [name, value] of inputs) {
      const signal = trace.inputs.find((input) => input.name === name)
      if (!signal || value >= 2 ** signal.bits.length)
        return failure(
          'invalid-digital-signal',
          `Input ${name} is absent or the value does not fit its unsigned bit width.`,
        )
    }
    const signals = digitalTestSignals(trace, blockId, provenance)
    return {
      ...evaluateAssertions(assertions, signals),
      findings: [],
      signals,
      warnings: trace.anomalies.map((anomaly) => anomaly.detail),
      inputSnapshot,
    }
  } catch (error) {
    return failure(
      'simulation-failed',
      error instanceof Error ? error.message : 'The isolated digital simulation failed.',
    )
  }
}

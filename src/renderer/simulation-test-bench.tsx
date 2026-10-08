import type { Edge, Node } from '@xyflow/react'
import { useMemo, useState, useSyncExternalStore } from 'react'
import type { RuntimeTarget } from '../runtime-contracts.ts'
import type { SimulationAssertion, TestUnit } from '../simulation-assertions.ts'
import type { BlockData } from './blocks.ts'
import type { Point } from './net-edge.tsx'
import { attachInternalCircuits } from './pipeline/canvas-world.ts'
import { importBlockTest } from './simulation-test-import.ts'
import {
  runDigitalTestCopy,
  runElectricalTestCopy,
  type SimulationTestRunResult,
} from './simulation-test-runner.ts'
import { type SavedSimulationTest, validateSimulationTests } from './simulation-test-suite.ts'
import { simulationTestInputKey, simulationTestWorld } from './simulation-test-world.ts'
import { HelpTip } from './tooltip.tsx'
import { getUserPartsSnapshot, subscribeUserParts } from './user-parts.ts'

const numeric = (value: string) => (value.trim() ? Number(value) : Number.NaN)

export function SimulationTestBench({
  nodes,
  edges,
  tests,
  ambientC,
  routedGeoms,
  onChange,
  onClose,
  onSelect,
}: {
  nodes: Node[]
  edges: Edge[]
  tests: SavedSimulationTest[]
  ambientC: number
  routedGeoms?: Map<string, Point[]> | undefined
  onChange: (tests: SavedSimulationTest[]) => void
  onClose: () => void
  onSelect: (ids: string[]) => void
}) {
  const userParts = useSyncExternalStore(
    subscribeUserParts,
    getUserPartsSnapshot,
    getUserPartsSnapshot,
  )
  const prepared = useMemo(() => {
    try {
      return {
        world: simulationTestWorld(nodes, edges, routedGeoms),
        inputKey: simulationTestInputKey(nodes, edges, routedGeoms, userParts),
        error: '',
      }
    } catch (error) {
      return {
        world: null,
        inputKey: null,
        error: error instanceof Error ? error.message : 'Could not snapshot this circuit.',
      }
    }
  }, [nodes, edges, routedGeoms, userParts])
  const terminals = [...(prepared.world?.instances.values() ?? [])].flatMap((instance) =>
    (instance.connects ?? []).map((connection) => ({
      blockId: instance.id,
      terminalId: connection.terminal,
      net: connection.net,
    })),
  )
  const sources = [...(prepared.world?.instances.values() ?? [])].filter(
    (instance) => instance.definition === 'power_source',
  )
  const blocks = attachInternalCircuits(nodes).filter((node) => node.data.block)
  const legacyTests = blocks.flatMap((node) => {
    const block = node.data.block as BlockData
    return (block.tests ?? []).map((test) => ({ node, block, test }))
  })
  const [kind, setKind] = useState<'dc' | 'transient' | 'ac' | 'digital'>('dc')
  const [terminalKey, setTerminalKey] = useState('')
  const terminal =
    terminals.find((candidate) => `${candidate.blockId}/${candidate.terminalId}` === terminalKey) ??
    terminals[0]
  const [sourceId, setSourceId] = useState('')
  const [blockId, setBlockId] = useState('')
  const [signalName, setSignalName] = useState('out')
  const [inputText, setInputText] = useState('{}')
  const [quantity, setQuantity] = useState('voltage')
  const [name, setName] = useState('New test')
  const [expected, setExpected] = useState('1')
  const [absolute, setAbsolute] = useState('0.001')
  const [coordinate, setCoordinate] = useState('0')
  const [duration, setDuration] = useState('0.01')
  const [step, setStep] = useState('0.00001')
  const [frequency, setFrequency] = useState('1000')
  const [cycles, setCycles] = useState('4')
  const [provenance, setProvenance] = useState('')
  const [editing, setEditing] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<{
    name: string
    testId: string
    definition: string
    inputKey: string | null
    run: SimulationTestRunResult
  } | null>(null)
  const units: Record<string, TestUnit> = {
    voltage: 'volt',
    current: 'ampere',
    power: 'watt',
    kcl: 'ampere',
    temperature: 'degree_celsius',
    gain: 'dimensionless',
    gainDb: 'decibel',
    phaseDeg: 'degree',
    'power-balance': 'watt',
  }
  const save = (candidate: unknown) => {
    const validated = validateSimulationTests([candidate])
    if (!validated.ok) {
      setError(validated.reason)
      return
    }
    const entry = validated.tests[0]
    if (!entry) return
    const suite = validateSimulationTests([...tests.filter((test) => test.id !== entry.id), entry])
    if (!suite.ok) {
      setError(suite.reason)
      return
    }
    onChange(suite.tests)
    setError('')
    setEditing('')
  }
  const create = () => {
    try {
      if (kind !== 'digital' && !terminal) {
        setError('Connect a device terminal first.')
        return
      }
      const id = `test-${Date.now()}`
      const selectedQuantity = kind === 'ac' ? 'gain' : quantity
      const assertion: SimulationAssertion = {
        id: `${id}-expected`,
        label: name,
        signal:
          kind === 'digital'
            ? signalName
            : `${selectedQuantity}:${selectedQuantity === 'voltage' || selectedQuantity === 'kcl' || kind === 'ac' ? terminal?.net : selectedQuantity === 'current' && kind === 'transient' ? `${terminal?.blockId}/${terminal?.terminalId}` : terminal?.blockId}`,
        unit: kind === 'digital' ? 'dimensionless' : (units[selectedQuantity] ?? 'unknown'),
        measurement: {
          kind: 'point',
          at: kind === 'dc' ? 0 : kind === 'ac' ? numeric(frequency) : numeric(coordinate),
        },
        expected: {
          kind: 'near',
          value: numeric(expected),
          absolute: numeric(absolute),
          relative: 0,
        },
        provenance: { kind: 'manual', description: provenance },
        ...(kind !== 'digital' &&
        terminal &&
        (selectedQuantity === 'voltage' || selectedQuantity === 'kcl' || kind === 'ac')
          ? {
              probe: {
                kind:
                  kind === 'ac'
                    ? ('ac-output' as const)
                    : selectedQuantity === 'voltage'
                      ? ('terminal-voltage' as const)
                      : ('net-kcl' as const),
                blockId: terminal.blockId,
                terminalId: terminal.terminalId,
              },
            }
          : {}),
      }
      const run: SavedSimulationTest['run'] =
        kind === 'digital'
          ? {
              kind,
              blockId: blockId || blocks[0]?.id || '',
              cycles: numeric(cycles),
              inputs: JSON.parse(inputText),
            }
          : kind === 'ac'
            ? {
                kind,
                projectAmbientC: ambientC,
                inputSource: sourceId || sources[0]?.id || '',
                outputNet: terminal?.net ?? '',
                ...(terminal
                  ? { outputProbe: { blockId: terminal.blockId, terminalId: terminal.terminalId } }
                  : {}),
                frequenciesHz: [numeric(frequency)],
              }
            : kind === 'transient'
              ? {
                  kind,
                  projectAmbientC: ambientC,
                  duration: numeric(duration),
                  timeStep: numeric(step),
                }
              : { kind, projectAmbientC: ambientC }
      save({ version: 1, id, name, run, assertions: [assertion] })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Invalid input settings.')
    }
  }
  const execute = (test: SavedSimulationTest) => {
    try {
      const request = test.run
      if (request.kind === 'digital') {
        const block = blocks.find((node) => node.id === request.blockId)?.data.block as
          | BlockData
          | undefined
        if (!block) {
          setError('The saved digital block no longer exists.')
          return
        }
        setResult({
          name: test.name,
          testId: test.id,
          definition: JSON.stringify(test),
          inputKey: prepared.inputKey,
          run: runDigitalTestCopy(
            block,
            request.blockId,
            request.cycles,
            new Map(Object.entries(request.inputs)),
            test.assertions,
          ),
        })
      } else {
        if (!prepared.world) {
          setError(prepared.error)
          return
        }
        setResult({
          name: test.name,
          testId: test.id,
          definition: JSON.stringify(test),
          inputKey: prepared.inputKey,
          run: runElectricalTestCopy(prepared.world, request, test.assertions),
        })
      }
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Test failed to run.')
    }
  }
  const select = (targets: RuntimeTarget[]) => {
    const ids = targets.flatMap((target) =>
      target.blockId
        ? [String(target.blockId)]
        : target.netId
          ? (prepared.world?.nets.get(target.netId)?.members.map((member) => member.instance) ?? [])
          : [],
    )
    onSelect(
      nodes
        .filter((node) => ids.some((id) => id === node.id || id.startsWith(`${node.id}.`)))
        .map((node) => node.id),
    )
  }
  const stale =
    result &&
    (prepared.inputKey === null ||
      result.inputKey !== prepared.inputKey ||
      result.definition !== JSON.stringify(tests.find((test) => test.id === result.testId)))
  return (
    <section
      aria-label="Simulation test bench"
      className="nodrag nopan cb-test-bench"
      style={{
        position: 'absolute',
        right: 16,
        top: 16,
        bottom: 16,
        left: 'auto',
        width: 'min(650px, calc(100% - 32px))',
        maxWidth: 'calc(100% - 32px)',
        minWidth: 0,
        boxSizing: 'border-box',
        overflow: 'auto',
        zIndex: 65,
        padding: 16,
        background: 'var(--surfacePanel)',
        color: 'var(--textPrimary)',
        border: '1px solid var(--borderStrong)',
        borderRadius: 8,
      }}
    >
      <HelpTip helpId="tests.close">
        <button type="button" onClick={onClose} style={{ float: 'right' }}>
          Close tests
        </button>
      </HelpTip>
      <h2>Tests and preflight</h2>
      <p>
        Tests run on independent copies. They do not change your live circuit. Expected values need
        an independent reference; matching a captured result alone does not prove the physics.
      </p>
      <p>
        Electrical checks expand blocks into their physical components and use the named DC, AC, or
        transient solver, not the live canvas logic shortcuts. Digital checks isolate the selected
        block, start registers low, and hold the saved inputs while clocking. They do not replay the
        current canvas state or certify mixed-signal timing.
      </p>
      {prepared.error ? <p role="alert">{prepared.error}</p> : null}
      <fieldset>
        <legend>Create a check</legend>
        <label>
          Name <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Analysis{' '}
          <HelpTip helpId="tests.analysis">
            <select
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as typeof kind)
                setCoordinate(event.target.value === 'digital' ? '1' : '0')
                setQuantity('voltage')
              }}
            >
              <option value="dc">Steady voltage/current</option>
              <option value="transient">Time response</option>
              <option value="ac">Frequency response</option>
              <option value="digital">Digital cycles</option>
            </select>
          </HelpTip>
        </label>
        {kind === 'digital' ? (
          <>
            <label>
              Block{' '}
              <select
                value={blockId || blocks[0]?.id || ''}
                onChange={(event) => setBlockId(event.target.value)}
              >
                {blocks.map((block) => (
                  <option key={block.id} value={block.id}>
                    {String(block.data.label ?? block.id)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Output signal{' '}
              <input value={signalName} onChange={(event) => setSignalName(event.target.value)} />
            </label>
            <label>
              Held inputs (name/value JSON){' '}
              <input value={inputText} onChange={(event) => setInputText(event.target.value)} />
            </label>
            <label>
              Cycles <input value={cycles} onChange={(event) => setCycles(event.target.value)} />
            </label>
          </>
        ) : (
          <label>
            Device terminal{' '}
            <select
              value={terminal ? `${terminal.blockId}/${terminal.terminalId}` : ''}
              onChange={(event) => setTerminalKey(event.target.value)}
            >
              {terminals.map((candidate) => (
                <option
                  key={`${candidate.blockId}/${candidate.terminalId}`}
                  value={`${candidate.blockId}/${candidate.terminalId}`}
                >
                  {candidate.blockId} / {candidate.terminalId}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === 'dc' || kind === 'transient' ? (
          <label>
            Quantity{' '}
            <select value={quantity} onChange={(event) => setQuantity(event.target.value)}>
              <option value="voltage">Voltage</option>
              <option value="current">Current</option>
              {kind === 'transient' ? <option value="power">Signed absorbed power</option> : null}
              <option value="kcl">Current balance at the net</option>
              {kind === 'dc' ? <option value="temperature">Temperature</option> : null}
            </select>
          </label>
        ) : null}
        {kind === 'ac' ? (
          <>
            <label>
              Input source{' '}
              <select
                value={sourceId || sources[0]?.id || ''}
                onChange={(event) => setSourceId(event.target.value)}
              >
                {sources.map((source) => (
                  <option key={source.id}>{source.id}</option>
                ))}
              </select>
            </label>
            <label>
              Frequency (Hz){' '}
              <input value={frequency} onChange={(event) => setFrequency(event.target.value)} />
            </label>
            <p>
              This quick check measures amplitude gain. Use Advanced definition for decibels, phase,
              or multiple frequencies.
            </p>
          </>
        ) : null}
        {kind === 'transient' ? (
          <>
            <label>
              Time step (s) <input value={step} onChange={(event) => setStep(event.target.value)} />
            </label>
            <label>
              Duration (s){' '}
              <input value={duration} onChange={(event) => setDuration(event.target.value)} />
            </label>
          </>
        ) : null}
        {kind === 'digital' || kind === 'transient' ? (
          <label>
            {kind === 'digital' ? 'Cycle' : 'Sample time (s)'}{' '}
            <input value={coordinate} onChange={(event) => setCoordinate(event.target.value)} />
          </label>
        ) : null}
        <label>
          Expected value{' '}
          <input value={expected} onChange={(event) => setExpected(event.target.value)} />
        </label>
        <label>
          Absolute tolerance{' '}
          <input value={absolute} onChange={(event) => setAbsolute(event.target.value)} />
        </label>
        <label>
          Reference or formula{' '}
          <input
            value={provenance}
            onChange={(event) => setProvenance(event.target.value)}
            placeholder="For example: divider formula, datasheet, or measured reference"
          />
        </label>
        <HelpTip helpId="tests.save">
          <button type="button" onClick={create}>
            Save check
          </button>
        </HelpTip>
      </fieldset>
      {error ? <p role="alert">{error}</p> : null}
      {legacyTests.length > 0 ? (
        <fieldset>
          <legend>Existing block waveforms</legend>
          <p>
            Copy a saved waveform into unified reports. The original block test stays unchanged.
          </p>
          {legacyTests.map(({ node, block, test }) => (
            <HelpTip key={JSON.stringify([node.id, test.id])} helpId="tests.importWaveform">
              <button
                type="button"
                onClick={() => {
                  const imported = importBlockTest(block, node.id, test)
                  if (imported.ok) save(imported.test)
                  else setError(imported.reason)
                }}
              >
                Import {node.id}: {test.name}
              </button>
            </HelpTip>
          ))}
        </fieldset>
      ) : null}
      <h3>Saved tests ({tests.length})</h3>
      {tests.map((test) => (
        <div key={test.id}>
          <strong>{test.name}</strong> — {test.run.kind}{' '}
          <HelpTip helpId="tests.run">
            <button type="button" onClick={() => execute(test)}>
              Run {test.name}
            </button>
          </HelpTip>{' '}
          <HelpTip helpId="tests.advanced">
            <button type="button" onClick={() => setEditing(JSON.stringify(test, null, 2))}>
              Advanced definition
            </button>
          </HelpTip>{' '}
          <HelpTip helpId="tests.remove">
            <button
              type="button"
              onClick={() => onChange(tests.filter((item) => item.id !== test.id))}
            >
              Remove {test.name}
            </button>
          </HelpTip>
        </div>
      ))}
      {editing ? (
        <fieldset>
          <legend>Advanced test definition</legend>
          <p>
            Edit tolerances, sampled windows, crossing/settling, signed power integrals, thermal
            ranges, or additional assertions. Only validated definitions are saved.
          </p>
          <textarea
            aria-label="Test definition JSON"
            rows={15}
            value={editing}
            onChange={(event) => setEditing(event.target.value)}
            style={{ width: '100%' }}
          />
          <HelpTip helpId="tests.saveDefinition">
            <button
              type="button"
              onClick={() => {
                try {
                  save(JSON.parse(editing))
                } catch {
                  setError('Invalid test definition JSON.')
                }
              }}
            >
              Save definition
            </button>
          </HelpTip>
          <HelpTip helpId="tests.cancelEdit">
            <button type="button" onClick={() => setEditing('')}>
              Cancel edit
            </button>
          </HelpTip>
        </fieldset>
      ) : null}
      {result ? (
        <div>
          <h3>
            {result.name}:{' '}
            {stale ? 'STALE — rerun required' : result.run.passed ? 'PASS' : 'NOT PASSED'}
          </h3>
          <p>
            {stale
              ? 'Circuit or test definition changed since this run; rerun before relying on this report.'
              : 'Snapshot of the last explicit test run.'}
          </p>
          {[
            ...new Map(
              result.run.findings.map((finding) => [JSON.stringify(finding), finding]),
            ).values(),
          ].map((finding) => (
            <div key={JSON.stringify(finding)}>
              <strong>{finding.code}</strong>: {finding.message}
              <p>{finding.repair}</p>
              <HelpTip
                helpId="tests.selectAffected"
                detail={
                  stale
                    ? 'The circuit or the check changed since this run. Run it again before selecting parts.'
                    : finding.targets.length === 0
                      ? 'This result does not point at a part on the sheet.'
                      : undefined
                }
              >
                <button
                  type="button"
                  disabled={stale || finding.targets.length === 0}
                  onClick={() => select(finding.targets)}
                >
                  Select affected parts
                </button>
              </HelpTip>
            </div>
          ))}
          {result.run.reports.map((report) => (
            <article key={report.assertion.id}>
              <h4>
                {report.assertion.label}: {report.status}
              </h4>
              <p>
                Requested{' '}
                {report.assertion.measurement.kind === 'point'
                  ? `sample at ${report.assertion.measurement.at}`
                  : `${report.assertion.measurement.kind} from ${report.assertion.measurement.from} to ${report.assertion.measurement.to}`}{' '}
                {report.axis ?? '(axis unavailable)'}.
              </p>
              <p>
                Expected{' '}
                {report.assertion.expected.kind === 'near'
                  ? `${report.assertion.expected.value} ± ${report.assertion.expected.absolute + report.assertion.expected.relative * Math.abs(report.assertion.expected.value)}`
                  : `${report.assertion.expected.minimum} to ${report.assertion.expected.maximum}`}
                ; actual {report.actual ?? 'unavailable'} {report.assertion.unit}. At{' '}
                {report.at ?? 'unavailable'} {report.axis}.
              </p>
              <p>
                {report.detail} {report.repair}
              </p>
              <p>Formula: {report.formula || report.provenance?.formula || 'Unavailable'}</p>
              <p>Reference: {report.assertion.provenance.description}</p>
              <HelpTip
                helpId="tests.selectAffected"
                detail={
                  stale
                    ? 'The circuit or the check changed since this run. Run it again before selecting parts.'
                    : report.targets.length === 0
                      ? 'This result does not point at a part on the sheet.'
                      : undefined
                }
              >
                <button
                  type="button"
                  disabled={stale || report.targets.length === 0}
                  onClick={() => select(report.targets)}
                >
                  Select affected parts
                </button>
              </HelpTip>
              <details>
                <summary>Inputs and affected targets</summary>
                <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {JSON.stringify(
                    { targets: report.targets, provenance: report.provenance },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </article>
          ))}
          {[...new Set(result.run.warnings)].map((warning) => (
            <p key={warning}>Warning: {warning}</p>
          ))}
        </div>
      ) : null}
    </section>
  )
}

import { useState } from 'react'
import { type BlockTimingReport, blockTiming } from './block-timing.ts'
import type { BlockData } from './blocks.ts'

export function BlockTiming({ block, instanceId }: { block: BlockData; instanceId: string }) {
  const [supply, setSupply] = useState('')
  const [load, setLoad] = useState('')
  const [wire, setWire] = useState('')
  const [unloaded, setUnloaded] = useState(false)
  const [saved, setSaved] = useState<{ key: string; report: BlockTimingReport } | null>(null)
  const key = JSON.stringify([instanceId, block, supply, load, wire, unloaded])
  const current = saved?.key === key ? saved.report : null
  const number = (value: string) => (value.trim() ? Number(value) : Number.NaN)
  return (
    <details>
      <summary>Internal timing estimate</summary>
      <p>
        Instance: {instanceId} · {block.name}
      </p>
      <p>
        First-order CMOS RC estimate, not a timing sign-off. Enter the assumed common supply,
        reference load per uncharacterized receiving input, and wire capacitance per output. No
        values are guessed.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          setSaved({
            key,
            report: blockTiming(block, instanceId, {
              supplyVoltage: number(supply),
              defaultInputCapacitance: number(load),
              wireCapacitance: number(wire),
              externalPortsUnloaded: unloaded,
            }),
          })
        }}
        style={{ display: 'grid', gap: 6 }}
      >
        <label>
          Supply (V)
          <input
            aria-label="Timing supply (V)"
            value={supply}
            onChange={(event) => setSupply(event.target.value)}
          />
        </label>
        <label>
          Reference input load (F)
          <input
            aria-label="Timing reference load (F)"
            value={load}
            onChange={(event) => setLoad(event.target.value)}
          />
        </label>
        <label>
          Wire capacitance per output (F)
          <input
            aria-label="Timing wire capacitance (F)"
            value={wire}
            onChange={(event) => setWire(event.target.value)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={unloaded}
            onChange={(event) => setUnloaded(event.target.checked)}
          />
          Estimate with external ports unloaded
        </label>
        <button type="submit">Estimate internal timing</button>
      </form>
      {saved && !current ? (
        <p role="status">STALE — block or assumptions changed; estimate again.</p>
      ) : null}
      {current ? (
        <div>
          <p role="status">{current.state.toUpperCase()}</p>
          {current.reasons.map((reason) => (
            <p key={reason}>{reason}</p>
          ))}
          <p>
            {current.gates.length} gate models · {current.registerIds.length} register boundaries ·{' '}
            {current.paths.length} internal register-to-register paths.
          </p>
          <p>
            Longest internal combinational path:{' '}
            {current.longestLogicDelay === null
              ? 'unavailable'
              : `${current.longestLogicDelay.toPrecision(5)} s`}
            . Register clock-to-Q, setup/hold and clock skew are not included; this is not a maximum
            clock rate.
          </p>
          <ul>
            {current.gates.slice(0, 200).map((gate) => (
              <li key={gate.id}>
                {gate.id}:{' '}
                {gate.referenceLoadDelay === null
                  ? 'unsupported'
                  : `${gate.referenceLoadDelay.toPrecision(5)} s`}{' '}
                driving one reference load plus the declared wire capacitance.
              </li>
            ))}
          </ul>
          {current.gates.length > 200 ? (
            <p>Showing the first 200 gate entries; the estimate includes all listed models.</p>
          ) : null}
          <p>
            Direction/register identification uses declared contracts and existing pin/clock
            conventions. Acyclic combinational paths only; asynchronous feedback and clock-domain
            behavior require separate tests. Reference load estimates are not added together as a
            block delay.
          </p>
        </div>
      ) : null}
    </details>
  )
}

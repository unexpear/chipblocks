import { useState } from 'react'
import {
  type BlockParameter,
  blockNodeAt,
  blockScalarParameters,
  overrideBlockParameter,
} from './block-parameters.ts'
import type { BlockData } from './blocks.ts'
import { THEME } from './theme.ts'

function ParameterRow({
  parameter,
  path,
  onCommit,
}: {
  parameter: BlockParameter
  path: string
  onCommit: (amount: number) => string | null
}) {
  const [draft, setDraft] = useState(String(parameter.value.amount))
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (draft.trim() === '') {
          setError('Enter a finite number.')
          return
        }
        setError(onCommit(Number(draft)))
      }}
      style={{ marginTop: 6 }}
    >
      <label style={{ display: 'block' }}>
        {parameter.key.replaceAll('_', ' ')}
        <input
          aria-label={`${path} ${parameter.key}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          style={{ width: 95 }}
        />
        <span> {parameter.value.unit}</span>
      </label>
      {parameter.origin === 'catalog-default' ? (
        <div>Catalog default; not set on this internal part.</div>
      ) : null}
      <button type="submit">Apply</button>
      {error ? (
        <div role="alert" style={{ color: THEME.statusDanger }}>
          {error}
        </div>
      ) : null}
    </form>
  )
}

export function BlockParameters({
  block,
  instanceId,
  onChange,
}: {
  block: BlockData
  instanceId: string
  onChange: (block: BlockData) => void
}) {
  const [parentPath, setParentPath] = useState<string[]>([])
  const [selectedId, setSelectedId] = useState('')
  const current = parentPath.length === 0 ? block : blockNodeAt(block, parentPath)?.block
  const selected = current?.nodes.find((node) => node.id === selectedId)
  const path = [...parentPath, selectedId]
  return (
    <details style={{ marginTop: 12, fontSize: 11, color: THEME.textSoft }}>
      <summary>Internal parameter overrides</summary>
      <p>
        Changes affect this instance only, not the library or other copies. Applying a value selects
        the full transistor-level simulation; fast logic does not model these physical changes.
      </p>
      <div>
        Inside: {instanceId} — {block.name}
        {parentPath.length ? ` / ${parentPath.join(' / ')}` : ''}
      </div>
      {parentPath.length ? (
        <button
          type="button"
          onClick={() => {
            setParentPath(parentPath.slice(0, -1))
            setSelectedId('')
          }}
        >
          Up one level
        </button>
      ) : null}
      {!current ? (
        <p role="alert">This internal path no longer exists. Go up and select it again.</p>
      ) : (
        <label>
          Internal part
          <select
            aria-label="Internal part"
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            <option value="">Choose a part</option>
            {current.nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.id} — {node.block?.name ?? node.definition}
              </option>
            ))}
          </select>
        </label>
      )}
      {selected?.block ? (
        <button
          type="button"
          onClick={() => {
            setParentPath(path)
            setSelectedId('')
          }}
        >
          Enter {selected.block.name}
        </button>
      ) : null}
      {selected && !selected.block ? (
        <>
          <p>
            Units stay fixed. Structural, named-material, and solver-derived values are not edited
            here. These checks validate typed values, not every device's physical limits.
          </p>
          {blockScalarParameters(selected).map((parameter) => (
            <ParameterRow
              key={JSON.stringify([
                path,
                parameter.key,
                parameter.value.amount,
                parameter.value.unit,
              ])}
              parameter={parameter}
              path={path.join(' / ')}
              onCommit={(amount) => {
                const result = overrideBlockParameter(
                  block,
                  path,
                  parameter.key,
                  amount,
                  parameter.value.unit,
                )
                if (!result.ok) return result.reason
                onChange(result.block)
                return null
              }}
            />
          ))}
          {blockScalarParameters(selected).length === 0 ? (
            <p>No editable scalar values for this part.</p>
          ) : null}
        </>
      ) : null}
    </details>
  )
}

import {
  Handle,
  Position,
  useReactFlow,
  type NodeProps,
  type Node,
} from '@xyflow/react'
import { useCallback, useEffect, useState, type ChangeEvent } from 'react'

export type ROMBlock = Node<{ contents: number[] }, 'rom'>

const ROM_DEPTH = 16

// Parse the comma-separated textarea into a 16-entry byte array. Returns
// either { ok: true, values } or { ok: false, error } so the component
// can show a single inline error without committing junk to the graph.
// Pads with zeros if fewer than 16 numbers were provided; truncates if
// more.
interface ParseOk { ok: true; values: number[] }
interface ParseErr { ok: false; error: string }

function parseContents(text: string): ParseOk | ParseErr {
  const trimmed = text.trim()
  if (trimmed === '') {
    return { ok: true, values: Array(ROM_DEPTH).fill(0) }
  }
  const tokens = trimmed.split(',').map((s) => s.trim()).filter((s) => s !== '')
  const out: number[] = []
  for (let i = 0; i < tokens.length; i++) {
    const v = parseInt(tokens[i], 10)
    if (!Number.isFinite(v)) {
      return { ok: false, error: `Entry ${i + 1} "${tokens[i]}" is not a number` }
    }
    if (v < 0 || v > 255) {
      return { ok: false, error: `Entry ${i + 1} (${v}) must be 0–255` }
    }
    out.push(v)
  }
  while (out.length < ROM_DEPTH) out.push(0)
  return { ok: true, values: out.slice(0, ROM_DEPTH) }
}

// Render the bound array as a comma-separated string the user can edit.
function formatContents(values: number[]): string {
  return values.join(', ')
}

export function ROMNode({ id, data }: NodeProps<ROMBlock>) {
  const { updateNodeData } = useReactFlow()

  const initialContents = Array.isArray(data.contents)
    ? data.contents
    : Array(ROM_DEPTH).fill(0)
  const [text, setText] = useState<string>(formatContents(initialContents))
  const [error, setError] = useState<string | null>(null)

  // Keep the local text in sync when the upstream contents change (e.g.
  // an AI tool call updates the array). Only resync when our current
  // text parses to a different array than the upstream one, so we don't
  // clobber the user's in-progress edits.
  useEffect(() => {
    const parsed = parseContents(text)
    if (parsed.ok) {
      const upstream = Array.isArray(data.contents) ? data.contents : []
      const same =
        parsed.values.length === upstream.length &&
        parsed.values.every((v, i) => v === upstream[i])
      if (!same) {
        setText(formatContents(upstream.length ? upstream : Array(ROM_DEPTH).fill(0)))
        setError(null)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.contents])

  const onChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const next = e.target.value
      setText(next)
      const parsed = parseContents(next)
      if (parsed.ok) {
        setError(null)
        updateNodeData(id, { contents: parsed.values })
      } else {
        setError(parsed.error)
      }
    },
    [id, updateNodeData],
  )

  const titleId = `block-${id}-title`
  return (
    <div className="block block-rom" role="group" aria-labelledby={titleId}>
      <Handle
        type="target"
        position={Position.Left}
        id="addr"
        aria-label="Address input"
      />
      <h3 id={titleId} className="block-title">ROM</h3>
      <div className="block-body">
        <textarea
          className={`block-input block-input-rom${error ? ' block-input-invalid' : ''}`}
          value={text}
          aria-label="ROM contents (comma-separated bytes, 0 to 255 each)"
          aria-invalid={error ? true : undefined}
          rows={3}
          onChange={onChange}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
        {error && (
          <div className="block-input-error" role="alert" aria-live="polite">{error}</div>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="data-out"
        aria-label="Data output"
      />
    </div>
  )
}

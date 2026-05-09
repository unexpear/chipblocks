/**
 * Shared validation hook for numeric block parameters.
 *
 * Today, every block input silently ignores out-of-range values: the
 * input visually freezes, which feels broken to keyboard users and
 * gives no hint about the valid range. This hook lets a block:
 *   - keep the user's literal text input even when out-of-range, so
 *     the input updates as they type
 *   - report `isInvalid` + `errorMessage` so the block can show a red
 *     border and an `aria-live` message
 *   - only commit valid values back to the React Flow node data
 *
 * Returns:
 *   - `displayValue`: the string to bind to the <input value=>
 *   - `onChange`: handler for the <input>'s onChange
 *   - `isInvalid`: true if the current text is out of range / not finite
 *   - `errorMessage`: human-readable range hint (e.g. "Must be 20–20000")
 *
 * The committed value flows back through the `commit` callback, which
 * the caller wires to React Flow's `updateNodeData`. When the user
 * leaves the field, if the text is invalid we revert to the last valid
 * value so the graph never carries a bad number.
 */

import { useCallback, useEffect, useState, type ChangeEvent, type FocusEvent } from 'react'

interface ValidatedNumberOptions {
  value: number
  min: number
  max: number
  commit: (next: number) => void
}

interface ValidatedNumberResult {
  displayValue: string
  isInvalid: boolean
  errorMessage: string
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
  onBlur: (e: FocusEvent<HTMLInputElement>) => void
}

export function useValidatedNumber({
  value,
  min,
  max,
  commit,
}: ValidatedNumberOptions): ValidatedNumberResult {
  const [displayValue, setDisplayValue] = useState<string>(String(value))

  // Keep the local text in sync when the upstream value changes (e.g. AI
  // tool call updates the node) — but only if our text is currently a
  // valid representation of a different number, to avoid clobbering an
  // in-progress edit.
  useEffect(() => {
    const parsed = parseInt(displayValue, 10)
    if (!Number.isFinite(parsed) || parsed !== value) {
      setDisplayValue(String(value))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const parsed = parseInt(displayValue, 10)
  const isInvalid =
    displayValue.trim() === '' ||
    !Number.isFinite(parsed) ||
    parsed < min ||
    parsed > max

  const errorMessage = `Must be ${min}–${max}`

  const onChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const text = e.target.value
      setDisplayValue(text)
      const v = parseInt(text, 10)
      if (Number.isFinite(v) && v >= min && v <= max) {
        commit(v)
      }
    },
    [commit, min, max],
  )

  const onBlur = useCallback(
    (_e: FocusEvent<HTMLInputElement>) => {
      // If the user leaves an invalid value, snap back to the last valid
      // committed value so the graph stays clean.
      const v = parseInt(displayValue, 10)
      if (!Number.isFinite(v) || v < min || v > max) {
        setDisplayValue(String(value))
      }
    },
    [displayValue, value, min, max],
  )

  return { displayValue, isInvalid, errorMessage, onChange, onBlur }
}

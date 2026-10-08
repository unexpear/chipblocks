/**
 * The side-panel pieces the canvas editors share — the footprint editor and the symbol editor — so the two
 * read as one tool: a titled section, a number field for an exact value, a small toggle button for the
 * canvas, and the input and button styles they all use.
 */

import type React from 'react'
import { THEME } from './theme.ts'
import { HelpTip } from './tooltip.tsx'

export function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: THEME.textPrimary }}>{title}</span>
        {hint ? <span style={{ fontSize: 10, color: THEME.textFaint }}>{hint}</span> : null}
      </div>
      {children}
    </div>
  )
}

export function NumberField({
  label,
  value,
  step,
  onChange,
}: {
  label: string
  value: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <label style={fieldLabel}>
      {label}
      <input
        style={textInput}
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => {
          const parsed = Number(e.target.value)
          if (Number.isFinite(parsed)) onChange(parsed)
        }}
      />
    </label>
  )
}

export function CanvasButton({
  active,
  onClick,
  children,
  helpId,
  detail,
  disabled = false,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  helpId?: string | undefined
  detail?: string | undefined
  disabled?: boolean | undefined
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '3px 9px',
        borderRadius: 6,
        border: `1px solid ${active ? THEME.accentBlue : THEME.borderStrong}`,
        background: active ? THEME.surfaceActive : THEME.surfaceRaised,
        color: THEME.textPrimary,
        fontSize: 11,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {children}
    </button>
  )
  if (helpId === undefined) return button
  return (
    <HelpTip helpId={helpId} detail={detail}>
      {button}
    </HelpTip>
  )
}

export const fieldRow: React.CSSProperties = { display: 'flex', gap: 6 }

export const fieldLabel: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  flex: 1,
  minWidth: 0,
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: THEME.textMuted,
}

export const textInput: React.CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  padding: '5px 7px',
  borderRadius: 6,
  border: `1px solid ${THEME.borderStrong}`,
  background: THEME.surfaceInput,
  color: THEME.textPrimary,
  fontSize: 12,
  outline: 'none',
}

export const primaryButton: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 6,
  border: `1px solid ${THEME.accentBlueDeep}`,
  background: THEME.surfaceActive,
  color: THEME.textBright,
  fontSize: 12,
  cursor: 'pointer',
}

export const subtleButton: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 6,
  border: `1px solid ${THEME.borderStrong}`,
  background: THEME.surfaceRaised,
  color: THEME.textPrimary,
  fontSize: 12,
  cursor: 'pointer',
}

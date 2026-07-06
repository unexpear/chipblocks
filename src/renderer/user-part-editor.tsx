import { useEffect, useRef, useState } from 'react'
import { UserPartGlyph } from './symbols.tsx'
import { THEME } from './theme.ts'
import { buildUserPartDraft } from './user-part-draft.ts'
import {
  PIN_ELECTRICAL_TYPES,
  type PinElectrical,
  type PinSide,
  registerUserPart,
  type UserPart,
} from './user-parts.ts'

/**
 * New-Part authoring dialog (user-made parts, slice 2). Define a custom part from scratch: a name,
 * a reference-designator letter, a list of pins (name / side / electrical role), and optional cited
 * default values. A live preview draws the exact symbol the canvas will place, and Save registers it
 * so it appears in the palette, drops, and wires like any built-in. Modelled on the PartPicker modal.
 *
 * It only assembles + registers a part — the solver still treats a custom part as a black box (it reads
 * a placed part's id + values + connections, never this definition), so nothing here can fake physics.
 */

const SIDES: PinSide[] = ['left', 'right', 'top', 'bottom']

type PinRow = { key: string; name: string; side: PinSide; electrical: PinElectrical }
type ParamRow = { key: string; name: string; amount: string; unit: string }

export function UserPartEditor({
  onClose,
  onCreated,
}: {
  onClose: () => void
  /** Called with the new part's definition id after a successful save (e.g. to hint the palette). */
  onCreated?: (part: UserPart) => void
}) {
  const [name, setName] = useState('')
  const [designator, setDesignator] = useState('U')
  const keyRef = useRef(0)
  const freshKey = (prefix: string) => `${prefix}-${keyRef.current++}`
  const [pins, setPins] = useState<PinRow[]>(() => [
    { key: 'pin-init-0', name: 'IN', side: 'left', electrical: 'input' },
    { key: 'pin-init-1', name: 'OUT', side: 'right', electrical: 'output' },
  ])
  const [params, setParams] = useState<ParamRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => nameRef.current?.focus(), [])

  const addPin = () =>
    setPins((ps) => [
      ...ps,
      { key: freshKey('pin'), name: '', side: 'left', electrical: 'passive' },
    ])
  const removePin = (key: string) => setPins((ps) => ps.filter((p) => p.key !== key))
  const updatePin = (key: string, patch: Partial<PinRow>) =>
    setPins((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)))

  const addParam = () =>
    setParams((ps) => [...ps, { key: freshKey('par'), name: '', amount: '', unit: '' }])
  const removeParam = (key: string) => setParams((ps) => ps.filter((p) => p.key !== key))
  const updateParam = (key: string, patch: Partial<ParamRow>) =>
    setParams((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)))

  // A best-effort preview part from the current fields — drawn even while the form is incomplete, so
  // the symbol takes shape as you type (uses throwaway pin ids; Save computes the real ones).
  const previewPart: UserPart = {
    id: '__preview__',
    name: name.trim() || 'New Part',
    designatorPrefix: designator.trim() || 'U',
    pins: pins.map((p, i) => ({
      id: `preview_${i}`,
      name: p.name,
      side: p.side,
      electrical: p.electrical,
    })),
  }

  const save = () => {
    const result = buildUserPartDraft({
      name,
      designatorPrefix: designator,
      pins: pins.map((p) => ({ name: p.name, side: p.side, electrical: p.electrical })),
      params: params.map((p) => ({ name: p.name, amount: p.amount, unit: p.unit })),
    })
    if (!result.ok) {
      setError(result.error)
      return
    }
    if (!registerUserPart(result.part)) {
      setError('That name is a built-in part’s id — pick another.')
      return
    }
    onCreated?.(result.part)
    onClose()
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a modal backdrop click-to-close, standard
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-close; Escape handled by the dialog keydown
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the dialog stops backdrop clicks + carries the key handler */}
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
        style={{
          width: 720,
          maxWidth: '94vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          background: THEME.surfacePanel,
          border: `1px solid ${THEME.borderStrong}`,
          borderRadius: 10,
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '11px 14px',
            borderBottom: `1px solid ${THEME.borderSubtle}`,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600, color: THEME.textPrimary }}>New part</span>
          <span style={{ marginLeft: 8, fontSize: 11.5, color: THEME.textMuted }}>
            a custom part — drawn from its pins
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              marginLeft: 'auto',
              border: 'none',
              background: 'transparent',
              color: THEME.textMuted,
              fontSize: 18,
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* Left: the form */}
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '12px 14px' }}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
              <label style={fieldLabel}>
                Name
                <input
                  ref={nameRef}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. My Sensor"
                  style={{ ...textInput, width: '100%' }}
                />
              </label>
              <label style={{ ...fieldLabel, width: 90, flex: 'none' }}>
                Designator
                <input
                  type="text"
                  value={designator}
                  onChange={(e) => setDesignator(e.target.value)}
                  placeholder="U"
                  title="The reference-designator letter — U for a chip, J for a connector, etc."
                  style={{ ...textInput, width: '100%' }}
                />
              </label>
            </div>

            <SectionHeader
              title="Pins"
              hint="each pin becomes a wire point on the symbol"
              onAdd={addPin}
              addLabel="+ Pin"
            />
            {pins.map((pin) => (
              <div
                key={pin.key}
                style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}
              >
                <input
                  type="text"
                  value={pin.name}
                  onChange={(e) => updatePin(pin.key, { name: e.target.value })}
                  placeholder="pin name"
                  style={{ ...textInput, flex: 1, minWidth: 0 }}
                />
                <select
                  value={pin.side}
                  onChange={(e) => updatePin(pin.key, { side: e.target.value as PinSide })}
                  title="Which edge of the box the pin sits on"
                  style={selectInput}
                >
                  {SIDES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <select
                  value={pin.electrical}
                  onChange={(e) =>
                    updatePin(pin.key, { electrical: e.target.value as PinElectrical })
                  }
                  title="The pin's electrical role (documentation for now)"
                  style={selectInput}
                >
                  {PIN_ELECTRICAL_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => removePin(pin.key)}
                  aria-label={`Remove pin ${pin.name}`}
                  title="Remove this pin"
                  style={iconButton}
                >
                  ×
                </button>
              </div>
            ))}

            <div style={{ height: 14 }} />
            <SectionHeader
              title="Default values"
              hint="optional — a rough typed value per parameter"
              onAdd={addParam}
              addLabel="+ Value"
            />
            {params.length === 0 ? (
              <div style={{ fontSize: 11, color: THEME.textFaint, padding: '2px 0 4px' }}>
                None — this part carries no default values (a black box until you add real
                behaviour).
              </div>
            ) : (
              params.map((param) => (
                <div
                  key={param.key}
                  style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}
                >
                  <input
                    type="text"
                    value={param.name}
                    onChange={(e) => updateParam(param.key, { name: e.target.value })}
                    placeholder="name (e.g. supply voltage)"
                    style={{ ...textInput, flex: 1, minWidth: 0 }}
                  />
                  <input
                    type="number"
                    value={param.amount}
                    onChange={(e) => updateParam(param.key, { amount: e.target.value })}
                    placeholder="value"
                    style={{ ...textInput, width: 76, flex: 'none' }}
                  />
                  <input
                    type="text"
                    value={param.unit}
                    onChange={(e) => updateParam(param.key, { unit: e.target.value })}
                    placeholder="unit"
                    title="Unit (e.g. V, A, ohm) — leave blank for a plain number"
                    style={{ ...textInput, width: 64, flex: 'none' }}
                  />
                  <button
                    type="button"
                    onClick={() => removeParam(param.key)}
                    aria-label="Remove value"
                    title="Remove this value"
                    style={iconButton}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Right: the live symbol preview */}
          <div
            style={{
              width: 240,
              flex: 'none',
              borderLeft: `1px solid ${THEME.borderSubtle}`,
              background: THEME.surfaceBase,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              padding: 16,
              textAlign: 'center',
            }}
          >
            <span
              style={{
                fontSize: 10.5,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                color: THEME.textMuted,
              }}
            >
              Preview
            </span>
            <UserPartGlyph part={previewPart} />
            <span style={{ fontSize: 11, color: THEME.textFaint }}>
              {pins.length} pin{pins.length === 1 ? '' : 's'} · {designator.trim() || 'U'}
            </span>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            borderTop: `1px solid ${THEME.borderSubtle}`,
          }}
        >
          {error ? (
            <span style={{ fontSize: 11.5, color: THEME.statusDanger }}>{error}</span>
          ) : (
            <span style={{ fontSize: 11, color: THEME.textFaint }}>
              Save adds it to the palette — drag it onto the canvas and wire it like any part.
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            style={{
              marginLeft: 'auto',
              padding: '7px 16px',
              borderRadius: 7,
              border: `1px solid ${THEME.borderStrong}`,
              background: 'transparent',
              color: THEME.textPrimary,
              fontSize: 12.5,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            style={{
              padding: '7px 18px',
              borderRadius: 7,
              border: `1px solid ${THEME.accentBlue}`,
              background: THEME.accentBlueDeep,
              color: THEME.white,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Save part
          </button>
        </div>
      </div>
    </div>
  )
}

function SectionHeader({
  title,
  hint,
  onAdd,
  addLabel,
}: {
  title: string
  hint: string
  onAdd: () => void
  addLabel: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: THEME.textPrimary }}>{title}</span>
      <span style={{ fontSize: 10.5, color: THEME.textFaint }}>{hint}</span>
      <button
        type="button"
        onClick={onAdd}
        style={{
          marginLeft: 'auto',
          padding: '3px 9px',
          borderRadius: 6,
          border: `1px solid ${THEME.borderStrong}`,
          background: THEME.surfaceRaised,
          color: THEME.textPrimary,
          fontSize: 11,
          cursor: 'pointer',
        }}
      >
        {addLabel}
      </button>
    </div>
  )
}

const fieldLabel: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  flex: 1,
  fontSize: 10.5,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: THEME.textMuted,
}

const textInput: React.CSSProperties = {
  boxSizing: 'border-box',
  padding: '6px 8px',
  borderRadius: 6,
  border: `1px solid ${THEME.borderStrong}`,
  background: THEME.surfaceInput,
  color: THEME.textPrimary,
  fontSize: 12.5,
  outline: 'none',
}

const selectInput: React.CSSProperties = {
  padding: '6px 4px',
  borderRadius: 6,
  border: `1px solid ${THEME.borderStrong}`,
  background: THEME.surfaceInput,
  color: THEME.textPrimary,
  fontSize: 11.5,
  flex: 'none',
}

const iconButton: React.CSSProperties = {
  flex: 'none',
  width: 26,
  height: 26,
  borderRadius: 6,
  border: `1px solid ${THEME.borderSubtle}`,
  background: 'transparent',
  color: THEME.textMuted,
  fontSize: 15,
  lineHeight: 1,
  cursor: 'pointer',
}

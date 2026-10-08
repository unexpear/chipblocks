import type { MathView } from './math-view.ts'
import { THEME } from './theme.ts'
import { HelpTip } from './tooltip.tsx'
import { formatEng } from './units.ts'

/**
 * The Math panel (S19-v3-63) — renders buildMathView's sections: how the
 * solver works, every part's governing equation with the real numbers in it,
 * and the re-computed KCL balance at every net. The ✓ is earned: it appears
 * only when the re-summed currents actually cancel.
 */

export function MathPanel({
  view,
  onClose,
  light,
}: {
  view: MathView
  onClose: () => void
  light: boolean
}) {
  const border = light ? `1px solid ${THEME.textPrimary}` : `1px solid ${THEME.borderSubtle}`
  const textColor = light ? THEME.borderSubtle : THEME.textPrimary
  const dimColor = light ? THEME.textFaint : THEME.textMuted
  return (
    <div
      className="nodrag nopan cb-hide-scrollbar"
      data-testid="math-panel"
      data-converged={view.converged ? 'true' : 'false'}
      style={{
        position: 'absolute',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 55,
        width: 620,
        maxHeight: 'calc(100% - 32px)',
        overflowY: 'auto',
        background: light ? THEME.textBright : THEME.surfaceBase,
        border,
        borderRadius: 8,
        boxShadow: '0 10px 32px rgba(0,0,0,0.5)',
        padding: '12px 16px 16px',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        color: textColor,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>The math behind this circuit</div>
        <HelpTip helpId="math.close">
          <button
            type="button"
            onClick={onClose}
            style={{
              marginLeft: 'auto',
              padding: '3px 10px',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 11,
              background: light ? THEME.white : THEME.surfaceRaised,
              border,
              color: textColor,
            }}
          >
            ✕ Close
          </button>
        </HelpTip>
      </div>
      <div style={{ color: dimColor, fontSize: 11, marginBottom: 8 }}>
        Recomputed live from the same solved state the canvas shows — these ARE the equations and
        numbers the engine used, not a description of them.
      </div>

      <HelpTip helpId="math.how">
        <div style={{ fontWeight: 700, color: dimColor, margin: '8px 0 4px' }}>How it solves</div>
      </HelpTip>
      {view.solver.map((line) => (
        <div key={line} style={{ padding: '2px 0' }}>
          {line}
        </div>
      ))}

      {view.parts.length > 0 ? (
        <HelpTip helpId="math.laws">
          <div style={{ fontWeight: 700, color: dimColor, margin: '12px 0 4px' }}>
            Each part’s law, with the real numbers in it
          </div>
        </HelpTip>
      ) : null}
      {view.parts.map((part) => (
        <div key={part.id} style={{ margin: '6px 0', padding: '6px 8px', border, borderRadius: 5 }}>
          <div style={{ fontWeight: 700 }}>
            {part.id} <span style={{ color: dimColor, fontWeight: 400 }}>— {part.title}</span>
          </div>
          {part.lines.map((line) => (
            <div key={line} style={{ padding: '1px 0' }}>
              {line}
            </div>
          ))}
        </div>
      ))}

      {view.nets.length > 0 ? (
        <>
          <HelpTip helpId="math.kcl">
            <div style={{ fontWeight: 700, color: dimColor, margin: '12px 0 2px' }}>
              Kirchhoff’s current law — the proof, net by net
            </div>
          </HelpTip>
          <div style={{ color: dimColor, fontSize: 11, marginBottom: 4 }}>
            Whatever current flows INTO a junction must flow OUT — charge can’t pile up at a point.
            Below, every current at every net is re-added; the sum must come out zero.
          </div>
        </>
      ) : null}
      {view.nets.map((net) => (
        <div key={net.id} style={{ padding: '2px 0' }}>
          <span style={{ color: dimColor }}>{net.id}: </span>
          {net.terms.join('  ')}
          {net.sumAmps !== null ? (
            <span style={{ marginLeft: 6 }}>
              → Σ = {formatEng(net.sumAmps, 'A')}{' '}
              {Math.abs(net.sumAmps) < 1e-9 ? (
                <HelpTip helpId="math.balanced">
                  <span style={{ color: THEME.statusOk }}>✓ balanced</span>
                </HelpTip>
              ) : (
                <HelpTip helpId="math.unbalanced">
                  <span style={{ color: THEME.statusDanger }}>⚠ NOT balanced</span>
                </HelpTip>
              )}
            </span>
          ) : (
            <span style={{ color: dimColor, marginLeft: 6 }}>({net.note})</span>
          )}
        </div>
      ))}

      {view.fields.length > 0 ? (
        <>
          <div style={{ fontWeight: 700, color: dimColor, margin: '12px 0 2px' }}>
            Where the energy really flows
          </div>
          <div style={{ color: dimColor, fontSize: 11, marginBottom: 4 }}>
            The numbers above are the circuit picture. Underneath, the energy is carried by the
            fields in the space around the wires — the same total, seen the deeper way.
          </div>
          {view.fields.map((line) => (
            <div key={line} style={{ padding: '2px 0' }}>
              {line}
            </div>
          ))}
        </>
      ) : null}

      {view.unitsKey.length > 0 ? (
        <>
          <div style={{ fontWeight: 700, color: dimColor, margin: '12px 0 4px' }}>
            Key — every unit used above, written out
          </div>
          {view.unitsKey.map((entry) => (
            <div key={entry} style={{ padding: '1px 0' }}>
              {entry}
            </div>
          ))}
        </>
      ) : null}
    </div>
  )
}

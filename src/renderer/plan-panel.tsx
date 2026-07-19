/**
 * The Plan dock — the Board manufacturing-readiness roadmap (BOARD_PLAN), tracked so nothing is lost as we
 * work the tiers. Renders the declarative plan: each tier a collapsible group, each item a status chip
 * (todo → doing → done, click to cycle) + its real cited number on expand. The authored `status` in
 * board-plan.ts is the source of truth (bumped to 'done' as each item ships); a user can also toggle status
 * here, stored per-id in localStorage so their marks survive a reload and layer over the authored state.
 */
import { type CSSProperties, type JSX, useState } from 'react'
import { BOARD_PLAN, type PlanItem, type PlanStatus } from './board-plan.ts'
import { THEME } from './theme.ts'

const STORAGE_KEY = 'chipblocks-plan-status'
const NEXT: Record<PlanStatus, PlanStatus> = { todo: 'doing', doing: 'done', done: 'todo' }
const GLYPH: Record<PlanStatus, string> = { todo: '○', doing: '◐', done: '●' }

/** Reset a <button> to look like inline text — used for the pointer toggles (which stay keyboard-accessible
 *  as real buttons, so no a11y suppression is needed). */
const PRESSABLE: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  padding: 0,
  cursor: 'pointer',
  textAlign: 'left',
}

function loadOverrides(): Record<string, PlanStatus> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, PlanStatus>) : {}
  } catch {
    return {}
  }
}

export function PlanPanel({ light }: { light: boolean }): JSX.Element {
  const [overrides, setOverrides] = useState<Record<string, PlanStatus>>(loadOverrides)
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({ 4: true })
  const [expanded, setExpanded] = useState<string | null>(null)

  const text = light ? THEME.borderSubtle : THEME.textPrimary
  const sub = light ? THEME.textFaint : THEME.textMuted
  const line = light ? THEME.textPrimary : THEME.borderStrong
  const statusColor: Record<PlanStatus, string> = {
    todo: sub,
    doing: THEME.statusWarn,
    done: THEME.statusOk,
  }

  const statusOf = (item: PlanItem): PlanStatus => overrides[item.id] ?? item.status
  const cycle = (item: PlanItem): void => {
    const next = { ...overrides, [item.id]: NEXT[statusOf(item)] }
    setOverrides(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // localStorage unavailable (private mode) — the in-memory state still tracks this session.
    }
  }

  const allItems = BOARD_PLAN.flatMap((t) => t.items)
  const done = allItems.filter((it) => statusOf(it) === 'done').length
  const pct = allItems.length > 0 ? Math.round((done / allItems.length) * 100) : 0

  return (
    <div style={{ padding: 8, fontSize: 11, color: text, minWidth: 260 }}>
      {/* Overall progress */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ fontWeight: 600 }}>Board manufacturing readiness</div>
        <div style={{ marginLeft: 'auto', color: sub, fontVariantNumeric: 'tabular-nums' }}>
          {done}/{allItems.length} · {pct}%
        </div>
      </div>
      <div
        style={{
          height: 5,
          borderRadius: 3,
          background: light ? THEME.surfaceInput : THEME.surfaceDeep,
          overflow: 'hidden',
          marginBottom: 10,
        }}
      >
        <div style={{ width: `${pct}%`, height: '100%', background: THEME.statusOk }} />
      </div>

      {BOARD_PLAN.map((tier) => {
        const tierDone = tier.items.filter((it) => statusOf(it) === 'done').length
        const isCollapsed = collapsed[tier.tier] === true
        return (
          <div key={tier.tier} style={{ marginBottom: 6 }}>
            <button
              type="button"
              onClick={() => setCollapsed((c) => ({ ...c, [tier.tier]: !isCollapsed }))}
              style={{
                ...PRESSABLE,
                display: 'flex',
                width: '100%',
                alignItems: 'baseline',
                gap: 6,
                padding: '3px 2px',
                borderBottom: `1px solid ${line}`,
              }}
            >
              <span style={{ color: sub, width: 10 }}>{isCollapsed ? '▸' : '▾'}</span>
              <span style={{ fontWeight: 600 }}>Tier {tier.tier}</span>
              <span style={{ color: sub, flex: 1, minWidth: 0 }}>{tier.name}</span>
              <span
                style={{
                  color: tierDone === tier.items.length ? THEME.statusOk : sub,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {tierDone}/{tier.items.length}
              </span>
            </button>
            {!isCollapsed &&
              tier.items.map((item) => {
                const st = statusOf(item)
                const open = expanded === item.id
                return (
                  <div key={item.id} style={{ paddingLeft: 16 }}>
                    <div
                      style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '2px 0' }}
                    >
                      <button
                        type="button"
                        onClick={() => cycle(item)}
                        title={`status: ${st} — click to cycle`}
                        style={{
                          ...PRESSABLE,
                          color: statusColor[st],
                          width: 12,
                          userSelect: 'none',
                        }}
                      >
                        {GLYPH[st]}
                      </button>
                      <button
                        type="button"
                        onClick={() => setExpanded(open ? null : item.id)}
                        style={{
                          ...PRESSABLE,
                          flex: 1,
                          minWidth: 0,
                          textDecoration: st === 'done' ? 'line-through' : 'none',
                          color: st === 'done' ? sub : text,
                        }}
                      >
                        {item.title}
                      </button>
                      <span
                        style={{
                          color: sub,
                          border: `1px solid ${line}`,
                          borderRadius: 3,
                          padding: '0 3px',
                          fontSize: 9,
                        }}
                      >
                        {item.size}
                      </span>
                    </div>
                    {open && (
                      <div
                        style={{ paddingLeft: 18, paddingBottom: 4, color: sub, lineHeight: 1.5 }}
                      >
                        <div>{item.what}</div>
                        <div style={{ marginTop: 2, color: text }}>{item.value}</div>
                        <div style={{ marginTop: 2, fontSize: 10 }}>{item.cite}</div>
                      </div>
                    )}
                  </div>
                )
              })}
          </div>
        )
      })}
      <div style={{ marginTop: 8, color: sub, fontSize: 10 }}>
        ○ to-do · ◐ in progress · ● done — click a dot to cycle. Numbers verified vs
        JLCPCB/PCBWay/IPC.
      </div>
    </div>
  )
}

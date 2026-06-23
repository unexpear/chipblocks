import { useEffect, useState } from 'react'
import type { ProjectChoice } from './project-browser.tsx'
import { isLight, loadTheme, THEME, type ThemeName } from './theme.ts'

/**
 * Project hub (the per-project home) — modeled on KiCad's project manager: the project's
 * files on the left, the TOOLS that work on it on the right. It sits HALFWAY between KiCad's
 * separate-app launcher and our integrated editor: the live tools all open the one Circuit
 * Editor (the parts catalog, instruments and math live inside it), while the rest are the road
 * on down the stack — board, manufacturing, silicon — shown honestly as still to come.
 *
 * TOOLS is a plain declarative list: reorder, rename, restyle, hide or add a card by editing
 * it — the same edit-one-list pattern as the toolbar (TOOLBAR_ACTIONS) and lenses (LENS_TABS).
 */

type HubTool = {
  id: string
  title: string
  desc: string
  /** A monochrome glyph painted white on the accent badge. */
  icon: string
  accent: string
  status: 'open' | 'soon'
}

const TOOLS: HubTool[] = [
  {
    id: 'circuit',
    title: 'Circuit Editor',
    desc: 'Draw a schematic and watch it simulate live — DC, transient and AC. The parts catalog, instruments and math all live in here.',
    icon: '▦',
    accent: THEME.accentBlueDeep,
    status: 'open',
  },
  {
    id: 'catalog',
    title: 'Parts Catalog',
    desc: 'Every part from raw materials up — each value real, cited and unit-checked.',
    icon: '▤',
    accent: THEME.accentPurple,
    status: 'open',
  },
  {
    id: 'bench',
    title: 'Instruments & Math',
    desc: 'Multimeter, oscilloscope and curve tracer on a real bench — and the equation behind every reading.',
    icon: '◷',
    accent: THEME.accentBlueBright,
    status: 'open',
  },
  {
    id: 'io',
    title: 'Import / Convert',
    desc: 'Bring SPICE and KiCad schematics in — and send them back out.',
    icon: '⇄',
    accent: THEME.accentLime,
    status: 'open',
  },
  {
    id: 'pcb',
    title: 'PCB Editor',
    desc: 'Place and route the board — copper, vias and footprints.',
    icon: '▥',
    accent: THEME.statusOk,
    status: 'soon',
  },
  {
    id: 'fab',
    title: 'Manufacturing',
    desc: 'Gerbers and the manufacturing ZIP — the files you hand a fab.',
    icon: '◆',
    accent: THEME.accentTimeline,
    status: 'soon',
  },
  {
    id: 'chip',
    title: 'Chip / IC',
    desc: 'Lay out silicon — the long game, all the way down the stack.',
    icon: '▣',
    accent: THEME.accentPink,
    status: 'soon',
  },
  {
    id: 'libs',
    title: 'Community Libraries',
    desc: 'Install community part packs and project templates.',
    icon: '◈',
    accent: THEME.accentLasso,
    status: 'soon',
  },
]

export function ProjectHub({
  project,
  onOpenEditor,
  onBack,
}: {
  project: ProjectChoice
  onOpenEditor: () => void
  onBack: () => void
}) {
  const [light, setLight] = useState(() => isLight(loadTheme()))
  useEffect(() => {
    const onThemeChange = (event: Event) =>
      setLight(isLight((event as CustomEvent<ThemeName>).detail))
    window.addEventListener('chipblocks:theme', onThemeChange)
    return () => window.removeEventListener('chipblocks:theme', onThemeChange)
  }, [])

  // Same light/dark token swap the editor + project browser do.
  const BG = light ? THEME.textBright : THEME.surfaceBase
  const PANEL = light ? THEME.white : THEME.surfaceRaised
  const BORDER = light ? THEME.textPrimary : THEME.borderSubtle
  const TEXT = light ? THEME.borderSubtle : THEME.textPrimary
  const MUTED = light ? THEME.borderStrong : THEME.textMuted
  const ACCENT = THEME.accentBlueDeep
  const ACCENT_TEXT = light ? THEME.accentBlueDeep : THEME.accentBlueSoft

  const files = [
    { key: 'project', label: `${project.name}.chipblocks`, glyph: '▣', open: false },
    { key: 'schematic', label: `${project.name} — schematic`, glyph: '▦', open: true },
    { key: 'board', label: `${project.name} — board  (soon)`, glyph: '▥', open: false },
  ]

  return (
    <div
      style={{
        height: '100vh',
        width: '100vw',
        background: BG,
        color: TEXT,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, sans-serif',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 18px',
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            border: `1.5px solid ${ACCENT}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: ACCENT_TEXT,
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          C
        </div>
        <span style={{ fontSize: 15, fontWeight: 600 }}>ChipBlocks</span>
        <span style={{ fontSize: 14, color: MUTED }}>— {project.name}</span>
        <button
          type="button"
          onClick={onBack}
          style={{
            marginLeft: 'auto',
            padding: '6px 12px',
            borderRadius: 7,
            border: `1px solid ${BORDER}`,
            background: 'transparent',
            color: MUTED,
            fontSize: 12.5,
            cursor: 'pointer',
          }}
        >
          ← New project
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div
          style={{
            width: 240,
            flex: 'none',
            borderRight: `1px solid ${BORDER}`,
            background: PANEL,
            padding: 14,
            overflowY: 'auto',
          }}
        >
          <div
            style={{
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              color: MUTED,
              marginBottom: 10,
            }}
          >
            Project files
          </div>
          {files.map((f) => (
            <button
              key={f.key}
              type="button"
              disabled={!f.open}
              onClick={f.open ? onOpenEditor : undefined}
              title={f.open ? 'Open in the Circuit Editor' : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                width: '100%',
                textAlign: 'left',
                padding: '7px 8px',
                borderRadius: 6,
                border: '1px solid transparent',
                background: 'transparent',
                color: f.open ? TEXT : MUTED,
                cursor: f.open ? 'pointer' : 'default',
                opacity: f.open ? 1 : 0.6,
                fontSize: 12.5,
              }}
            >
              <span style={{ color: f.key === 'schematic' ? ACCENT_TEXT : MUTED, fontSize: 13 }}>
                {f.glyph}
              </span>
              {f.label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 0, padding: '18px 22px', overflowY: 'auto' }}>
          <div style={{ fontSize: 13, color: MUTED, marginBottom: 14 }}>
            Open a tool to work on <strong style={{ color: TEXT }}>{project.name}</strong>.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 640 }}>
            {TOOLS.map((tool) => {
              const open = tool.status === 'open'
              return (
                <button
                  key={tool.id}
                  type="button"
                  disabled={!open}
                  onClick={open ? onOpenEditor : undefined}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    textAlign: 'left',
                    padding: 14,
                    borderRadius: 10,
                    border: `1px solid ${BORDER}`,
                    background: PANEL,
                    color: TEXT,
                    cursor: open ? 'pointer' : 'default',
                    opacity: open ? 1 : 0.62,
                  }}
                >
                  <span
                    style={{
                      width: 42,
                      height: 42,
                      flex: 'none',
                      borderRadius: 9,
                      background: open ? tool.accent : 'rgba(138,147,160,0.16)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 19,
                      color: open ? THEME.white : MUTED,
                    }}
                  >
                    {tool.icon}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14.5, fontWeight: 600, color: TEXT }}>
                        {tool.title}
                      </span>
                      {open ? null : (
                        <span
                          style={{
                            fontSize: 10.5,
                            padding: '1px 7px',
                            borderRadius: 5,
                            background: 'rgba(138,147,160,0.18)',
                            color: MUTED,
                          }}
                        >
                          Coming soon
                        </span>
                      )}
                    </span>
                    <span
                      style={{
                        display: 'block',
                        fontSize: 12.5,
                        color: MUTED,
                        marginTop: 3,
                        lineHeight: 1.5,
                      }}
                    >
                      {tool.desc}
                    </span>
                  </span>
                  {open ? (
                    <span style={{ color: ACCENT_TEXT, fontSize: 18, flex: 'none' }}>→</span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

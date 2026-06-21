import { useEffect, useMemo, useState } from 'react'
import { DeviceGlyph } from './symbols.tsx'
import { isLight, loadTheme, THEME, type ThemeName } from './theme.ts'
import { useShortcuts } from './use-shortcuts.tsx'

/**
 * Project browser (the startup screen) — the front door, modeled on Unreal's project
 * browser. You pick a PURPOSE (the left rail), a TEMPLATE (the middle grid), and for a
 * designable component a DESIGN DEPTH — use it as a black box, or design it from its
 * materials. Create opens the editor seeded for that goal.
 *
 * The "design depth" is recorded now and becomes functional when a part's design view
 * lands (the motor's stator/winding internals are the first); today it sets the intent.
 */

export type ProjectChoice = {
  template: string
  templateName: string
  name: string
  depth: 'block' | 'design'
}

type Template = {
  id: string
  name: string
  desc: string
  /** A representative part whose symbol is the card thumbnail (none = a blank start). */
  glyph?: string
  /** Designable parts show the use-as-a-block / design-it depth switch. */
  designable?: boolean
  featured?: boolean
  includes: string[]
}

type Category = {
  id: string
  label: string
  sub: string
  soon?: boolean
  templates: Template[]
}

const CATEGORIES: Category[] = [
  { id: 'recent', label: 'Recent projects', sub: 'Reopen recent work', templates: [] },
  {
    id: 'circuit',
    label: 'Circuit',
    sub: 'Schematic + live sim',
    templates: [
      {
        id: 'blank-circ',
        name: 'Blank circuit',
        desc: 'A clean canvas — drop in parts and wire them up.',
        includes: ['Empty schematic', 'Full parts palette', 'DC + transient sim'],
      },
      {
        id: 'amp',
        name: 'Amplifier',
        desc: 'A gain stage to tune and probe.',
        glyph: 'op_amp',
        includes: ['Transistor / op-amp stage', 'Bias network', 'Scope on the output'],
      },
      {
        id: 'psu',
        name: 'Power supply',
        desc: 'Rectify, smooth and regulate a DC rail.',
        glyph: 'diode_silicon_rectifier',
        includes: ['Transformer + bridge', 'Filter capacitor', 'Regulator + load'],
      },
    ],
  },
  {
    id: 'component',
    label: 'Component',
    sub: 'Design a real part',
    templates: [
      {
        id: 'blank-comp',
        name: 'Blank component',
        desc: 'Start from raw materials and build a part up.',
        designable: true,
        includes: ['Empty assembly', 'Materials catalog', 'Derived terminal behaviour'],
      },
      {
        id: 'dc-motor',
        name: 'DC motor',
        desc: 'A brushed motor — use it as a block, or open it up and design the stator, magnets and winding.',
        glyph: 'dc_motor',
        designable: true,
        featured: true,
        includes: ['Stator core + magnets', 'Armature winding', 'Rotor geometry'],
      },
      {
        id: 'transformer',
        name: 'Transformer',
        desc: 'Two coupled windings on a shared core.',
        glyph: 'transformer',
        designable: true,
        includes: ['Core material', 'Primary + secondary', 'Turns ratio'],
      },
      {
        id: 'electromagnet',
        name: 'Electromagnet',
        desc: 'A coil on a core — the field is the point.',
        glyph: 'electromagnet',
        designable: true,
        includes: ['Core + permeability', 'Winding turns', 'Field + pull force'],
      },
      {
        id: 'relay',
        name: 'Relay',
        desc: 'A coil that throws a switch.',
        glyph: 'relay',
        designable: true,
        includes: ['Coil (electromagnet)', 'Contacts', 'Pull-in / drop-out'],
      },
    ],
  },
  {
    id: 'digital',
    label: 'Digital / logic',
    sub: 'Gates to registers',
    templates: [
      {
        id: 'blank-log',
        name: 'Blank logic',
        desc: 'Build from real transistor gates up.',
        includes: ['Logic palette', 'Live truth tables', 'From-transistors view'],
      },
      {
        id: 'register',
        name: 'Register',
        desc: 'Flip-flops that latch a word.',
        glyph: 'logic_register_4bit',
        includes: ['D flip-flops', 'Clock', '4-bit word'],
      },
    ],
  },
  { id: 'board', label: 'Board / PCB', sub: 'Coming soon', soon: true, templates: [] },
  { id: 'chip', label: 'Chip / IC', sub: 'Coming soon', soon: true, templates: [] },
  { id: 'system', label: 'System', sub: 'Coming soon', soon: true, templates: [] },
]

const ACCENT = THEME.accentBlueDeep

function Thumb({
  glyph,
  size = 1,
  light,
}: {
  glyph?: string | undefined
  size?: number
  light: boolean
}) {
  return (
    <div
      style={{
        width: 40 * size,
        height: 40 * size,
        borderRadius: 6,
        background: light ? THEME.white : THEME.surfaceBase,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 'none',
        overflow: 'hidden',
      }}
    >
      {glyph ? (
        <div style={{ transform: `scale(${0.62 * size})` }}>
          <DeviceGlyph definition={glyph} />
        </div>
      ) : (
        <span
          style={{
            color: light ? THEME.borderStrong : THEME.textMuted,
            fontSize: 20 * size,
            lineHeight: 1,
          }}
        >
          +
        </span>
      )}
    </div>
  )
}

export function ProjectBrowser({ onCreate }: { onCreate: (choice: ProjectChoice) => void }) {
  const [catId, setCatId] = useState('component')
  const [tplId, setTplId] = useState('dc-motor')
  const [depth, setDepth] = useState<'block' | 'design'>('design')
  const [name, setName] = useState('MyMotor')
  const [light, setLight] = useState(() => isLight(loadTheme()))
  useEffect(() => {
    const onThemeChange = (event: Event) =>
      setLight(isLight((event as CustomEvent<ThemeName>).detail))
    window.addEventListener('chipblocks:theme', onThemeChange)
    return () => window.removeEventListener('chipblocks:theme', onThemeChange)
  }, [])
  // In a light theme the surfaces/borders use the light tokens and text uses the dark ones —
  // the same swap the editor does (the browser has no `light` flag of its own otherwise).
  const BG = light ? THEME.textBright : THEME.surfaceBase
  const PANEL = light ? THEME.white : THEME.surfaceRaised
  const BORDER = light ? THEME.textPrimary : THEME.borderSubtle
  const TEXT = light ? THEME.borderSubtle : THEME.textPrimary
  const MUTED = light ? THEME.borderStrong : THEME.textMuted
  const ACCENT_TEXT = light ? THEME.accentBlueDeep : THEME.accentBlueSoft
  // Settings ▸ Shortcuts works here too (not only in the editor).
  const { panel: shortcutsPanel } = useShortcuts(light)

  const category = useMemo(() => CATEGORIES.find((c) => c.id === catId), [catId])
  const template = useMemo(
    () => category?.templates.find((t) => t.id === tplId) ?? null,
    [category, tplId],
  )

  const pickCategory = (c: Category) => {
    setCatId(c.id)
    setTplId(c.templates[0]?.id ?? '')
    setDepth('design')
  }

  const create = () => {
    if (!template) return
    onCreate({ template: template.id, templateName: template.name, name, depth })
  }

  const depthFields =
    depth === 'design'
      ? [
          ['Stator core', 'Soft iron'],
          ['Magnets', 'Ferrite'],
          ['Winding', '500 turns · 26 AWG'],
        ]
      : [
          ['Torque constant k', '0.02 V·s/rad'],
          ['Winding R', '2 Ω'],
          ['No-load speed', '5,600 RPM'],
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
        <span style={{ fontSize: 14, color: MUTED }}>— new project</span>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div
          style={{
            width: 220,
            flex: 'none',
            borderRight: `1px solid ${BORDER}`,
            background: PANEL,
            padding: 10,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {CATEGORIES.map((c) => {
            const on = c.id === catId
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => pickCategory(c)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  textAlign: 'left',
                  padding: '9px 10px',
                  borderRadius: 7,
                  border: `1px solid ${on ? ACCENT : 'transparent'}`,
                  background: on ? 'rgba(90,134,216,0.16)' : 'transparent',
                  color: TEXT,
                  cursor: 'pointer',
                  opacity: c.soon ? 0.55 : 1,
                }}
              >
                <span>
                  <div style={{ fontSize: 13.5, color: on ? ACCENT_TEXT : TEXT }}>{c.label}</div>
                  <div style={{ fontSize: 11.5, color: MUTED }}>{c.sub}</div>
                </span>
              </button>
            )
          })}
        </div>

        <div
          style={{
            flex: 1,
            minWidth: 0,
            padding: 18,
            overflowY: 'auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
            gap: 14,
            alignContent: 'start',
          }}
        >
          {category && category.templates.length > 0 ? (
            category.templates.map((t) => {
              const on = t.id === tplId
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setTplId(t.id)
                    setDepth('design')
                  }}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    alignItems: 'flex-start',
                    padding: 12,
                    borderRadius: 8,
                    border: t.featured
                      ? `2px solid ${ACCENT}`
                      : `1px solid ${on ? ACCENT : BORDER}`,
                    background: on ? 'rgba(90,134,216,0.16)' : PANEL,
                    color: TEXT,
                    cursor: 'pointer',
                  }}
                >
                  <Thumb glyph={t.glyph} size={1.2} light={light} />
                  <span style={{ fontSize: 13, color: on ? ACCENT_TEXT : TEXT }}>{t.name}</span>
                </button>
              )
            })
          ) : (
            <div
              style={{
                gridColumn: '1 / -1',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
                color: MUTED,
                textAlign: 'center',
                padding: 40,
                fontSize: 13,
              }}
            >
              {catId === 'recent'
                ? 'No recent projects yet — your saved work will appear here.'
                : 'Coming soon — board, chip and system design arrive as ChipBlocks grows down the stack.'}
            </div>
          )}
        </div>

        <div
          style={{
            width: 280,
            flex: 'none',
            borderLeft: `1px solid ${BORDER}`,
            background: PANEL,
            padding: 16,
            overflowY: 'auto',
          }}
        >
          {template ? (
            <>
              <Thumb glyph={template.glyph} size={1.7} light={light} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 0' }}>
                <span style={{ fontSize: 17, fontWeight: 600 }}>{template.name}</span>
                {template.featured ? (
                  <span
                    style={{
                      fontSize: 11,
                      padding: '2px 8px',
                      borderRadius: 6,
                      background: 'rgba(90,134,216,0.18)',
                      color: ACCENT_TEXT,
                    }}
                  >
                    Featured
                  </span>
                ) : null}
              </div>
              <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.55, margin: '6px 0 14px' }}>
                {template.desc}
              </p>

              {template.designable ? (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>
                    Design depth
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      border: `1px solid ${BORDER}`,
                      borderRadius: 7,
                      overflow: 'hidden',
                    }}
                  >
                    {(['block', 'design'] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setDepth(d)}
                        style={{
                          flex: 1,
                          padding: '7px 4px',
                          fontSize: 12,
                          border: 'none',
                          cursor: 'pointer',
                          background: depth === d ? 'rgba(90,134,216,0.2)' : 'transparent',
                          color: depth === d ? ACCENT_TEXT : MUTED,
                          fontWeight: depth === d ? 600 : 400,
                        }}
                      >
                        {d === 'block' ? 'Use as a block' : 'Design it'}
                      </button>
                    ))}
                  </div>
                  <div style={{ marginTop: 8 }}>
                    {depthFields.map(([label, value]) => (
                      <div
                        key={label}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: 12,
                          color: MUTED,
                          padding: '3px 0',
                        }}
                      >
                        <span>{label}</span>
                        <span
                          style={{
                            color: TEXT,
                            background: light ? THEME.white : THEME.surfaceBase,
                            border: `1px solid ${BORDER}`,
                            borderRadius: 6,
                            padding: '3px 8px',
                          }}
                        >
                          {value}
                        </span>
                      </div>
                    ))}
                    <div style={{ fontSize: 11, color: ACCENT_TEXT, marginTop: 6 }}>
                      {depth === 'design'
                        ? '↓ torque, speed & resistance derive from these'
                        : 'Type the headline numbers; skip the internals.'}
                    </div>
                  </div>
                </div>
              ) : null}

              <div style={{ fontSize: 12.5, fontWeight: 600, margin: '4px 0 6px' }}>Includes</div>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {template.includes.map((i) => (
                  <li
                    key={i}
                    style={{
                      fontSize: 12,
                      color: MUTED,
                      padding: '3px 0',
                      display: 'flex',
                      gap: 7,
                    }}
                  >
                    <span style={{ color: ACCENT_TEXT }}>·</span>
                    {i}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p style={{ fontSize: 13, color: MUTED }}>Pick a template to see its details.</p>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 18px',
          borderTop: `1px solid ${BORDER}`,
        }}
      >
        <span style={{ fontSize: 13, color: MUTED }}>Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Project name"
          style={{
            width: 200,
            padding: '7px 10px',
            borderRadius: 7,
            border: `1px solid ${BORDER}`,
            background: light ? THEME.white : THEME.surfaceBase,
            color: TEXT,
            fontSize: 13,
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={create}
          disabled={!template}
          style={{
            marginLeft: 'auto',
            padding: '9px 20px',
            borderRadius: 7,
            border: `1px solid ${ACCENT}`,
            background: template ? ACCENT : BORDER,
            color: template ? THEME.surfaceDeep : MUTED,
            fontSize: 13.5,
            fontWeight: 600,
            cursor: template ? 'pointer' : 'default',
          }}
        >
          Create project
        </button>
      </div>
      {shortcutsPanel}
    </div>
  )
}

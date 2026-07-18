import { useEffect, useMemo, useState } from 'react'
import { type CircuitFile, deserializeCircuit } from './circuit-file.ts'
import {
  listRecentProjects,
  projectNameFromPath,
  type RecentProject,
  recordRecentProject,
  removeRecentProject,
} from './recent-projects.ts'
import { DeviceGlyph } from './symbols.tsx'
import { isLight, loadTheme, THEME, type ThemeName } from './theme.ts'
import { useShortcuts } from './use-shortcuts.tsx'
import type { WorkspaceMode } from './workspace.ts'

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
  /** When set, the tab opens from a SAVED project (this loaded circuit) instead of a template. */
  loaded?: CircuitFile
  /** The .chipblocks file this project was opened from (for Save reusing the path + the MRU). */
  path?: string
  /** Which workspace level the editor opens ON (Circuit ▸ Board ▸ Chip). Absent ⇒ Circuit (schematic). */
  initialWorkspace?: WorkspaceMode
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
  /** The design-depth preview (right rail) for a DESIGNABLE part — its own internals, so a transformer
   *  shows a core + windings and a relay shows a coil + contacts, NOT the motor's. `design` = the fields
   *  shown under "Design it" (build it from these), `block` = the headline numbers under "Use as a block",
   *  `note` = the line beneath the design fields. Absent ⇒ a generic materials-first preview. */
  design?: [string, string][]
  block?: [string, string][]
  note?: string
  /** Suggested project name when this template is picked, before the user types their own. */
  defaultName?: string
}

const GENERIC_DESIGN: [string, string][] = [
  ['Material', 'from the catalog'],
  ['Geometry', 'your dimensions'],
  ['Terminals', 'derived behaviour'],
]
const GENERIC_BLOCK: [string, string][] = [
  ['Headline values', 'typed'],
  ['Terminals', 'named'],
  ['Behaviour', 'black-box'],
]

type Category = {
  id: string
  label: string
  sub: string
  soon?: boolean
  templates: Template[]
}

const CATEGORIES: Category[] = [
  { id: 'recent', label: 'My Projects', sub: 'Open recent or saved work', templates: [] },
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
        defaultName: 'MyCircuit',
      },
      {
        id: 'amp',
        name: 'Amplifier',
        desc: 'A gain stage to tune and probe.',
        glyph: 'op_amp',
        includes: ['Transistor / op-amp stage', 'Bias network', 'Scope on the output'],
        defaultName: 'MyAmp',
      },
      {
        id: 'psu',
        name: 'Power supply',
        desc: 'Rectify, smooth and regulate a DC rail.',
        glyph: 'diode_silicon_rectifier',
        includes: ['Transformer + bridge', 'Filter capacitor', 'Regulator + load'],
        defaultName: 'MyPSU',
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
        defaultName: 'MyPart',
      },
      {
        id: 'dc-motor',
        name: 'DC motor',
        desc: 'A brushed motor — use it as a block, or open it up and design the stator, magnets and winding.',
        glyph: 'dc_motor',
        designable: true,
        featured: true,
        includes: ['Stator core + magnets', 'Armature winding', 'Rotor geometry'],
        defaultName: 'MyMotor',
        design: [
          ['Stator core', 'Soft iron'],
          ['Magnets', 'Ferrite'],
          ['Winding', '500 turns · 26 AWG'],
        ],
        block: [
          ['Torque constant k', '0.02 V·s/rad'],
          ['Winding R', '2 Ω'],
          ['No-load speed', '5,600 RPM'],
        ],
        note: '↓ torque, speed & resistance derive from these',
      },
      {
        id: 'transformer',
        name: 'Transformer',
        desc: 'Two coupled windings on a shared core — use it as a block, or design the core and windings.',
        glyph: 'transformer',
        designable: true,
        includes: ['Core material', 'Primary + secondary', 'Turns ratio'],
        defaultName: 'MyTransformer',
        design: [
          ['Core', 'Laminated Si-steel'],
          ['Primary', '230 V · 500 t'],
          ['Secondary', '23 V · 50 t'],
        ],
        block: [
          ['Turns ratio', '10 : 1'],
          ['Primary L', '2.2 H'],
          ['Rating', '5 VA'],
        ],
        note: '↓ turns ratio & regulation derive from these',
      },
      {
        id: 'electromagnet',
        name: 'Electromagnet',
        desc: 'A coil on a core — the field is the point. Use it as a block, or design the core and winding.',
        glyph: 'electromagnet',
        designable: true,
        includes: ['Core + permeability', 'Winding turns', 'Field + pull force'],
        defaultName: 'MyMagnet',
        design: [
          ['Core', 'Soft iron'],
          ['Winding', '300 turns · 26 AWG'],
          ['Drive', '0.5 A'],
        ],
        block: [
          ['MMF', '150 A·turns'],
          ['Pull force', '~5 N'],
          ['Coil R', '8 Ω'],
        ],
        note: '↓ field strength & pull force derive from these',
      },
      {
        id: 'relay',
        name: 'Relay',
        desc: 'A coil that throws a switch — use it as a block, or design the coil, contacts and spring.',
        glyph: 'relay',
        designable: true,
        includes: ['Coil (electromagnet)', 'Contacts', 'Pull-in / drop-out'],
        defaultName: 'MyRelay',
        design: [
          ['Coil', '400 turns · 30 AWG'],
          ['Contacts', 'SPDT · AgNi'],
          ['Return spring', '2 mN'],
        ],
        block: [
          ['Coil', '5 V · 40 mA'],
          ['Pull-in', '3.8 V'],
          ['Contact rating', '2 A · 30 V'],
        ],
        note: '↓ pull-in & drop-out voltages derive from these',
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
        defaultName: 'MyLogic',
      },
      {
        id: 'register',
        name: 'Register',
        desc: 'Flip-flops that latch a word.',
        glyph: 'logic_register_4bit',
        includes: ['D flip-flops', 'Clock', '4-bit word'],
        defaultName: 'MyRegister',
      },
    ],
  },
  {
    id: 'board',
    label: 'Board / PCB',
    sub: 'Place parts, route copper, export Gerbers',
    templates: [],
  },
  {
    id: 'chip',
    label: 'Chip / IC',
    sub: 'Standard cells, floorplan, timing sign-off',
    templates: [],
  },
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

  const [nameEdited, setNameEdited] = useState(false)
  const category = useMemo(() => CATEGORIES.find((c) => c.id === catId), [catId])
  const template = useMemo(
    () => category?.templates.find((t) => t.id === tplId) ?? null,
    [category, tplId],
  )

  // A sensible starting name for a template — its own `defaultName`, else "My" + the template name. Only
  // applied while the user hasn't typed their own, so switching Transformer ▸ Relay re-suggests, but a
  // hand-typed name is left alone.
  const defaultNameFor = (t?: Template | null) =>
    t?.defaultName ?? `My${(t?.name ?? 'Project').replace(/[^A-Za-z0-9]/g, '')}`
  const suggestName = (t?: Template | null) => {
    if (!nameEdited) setName(defaultNameFor(t))
  }

  const pickCategory = (c: Category) => {
    setCatId(c.id)
    const first = c.templates[0]
    setTplId(first?.id ?? '')
    setDepth('design')
    suggestName(first)
    if (c.id === 'recent') refreshProjects() // re-scan + pick up anything saved since mount
  }

  const create = () => {
    if (!template) return
    onCreate({ template: template.id, templateName: template.name, name, depth })
  }

  // "My Projects": the saved .chipblocks files, and opening one (or an arbitrary file) into a new tab.
  const [recents, setRecents] = useState<RecentProject[]>(() => listRecentProjects())
  const [scanning, setScanning] = useState(false)
  // Auto-discover saved projects on disk and merge them with the remembered list (an explicitly-saved
  // project keeps its name + save time; the rest come from the scan). Deduped by path, newest first.
  const refreshProjects = () => {
    setRecents(listRecentProjects())
    const scan = window.chipblocks?.scanProjects
    if (scan === undefined) return
    setScanning(true)
    void scan()
      .then((scanned) => {
        const byPath = new Map<string, RecentProject>()
        for (const p of scanned)
          byPath.set(p.path, { name: p.name, path: p.path, savedAt: p.savedAt })
        for (const p of listRecentProjects()) byPath.set(p.path, p) // remembered entry wins
        setRecents([...byPath.values()].sort((a, b) => b.savedAt - a.savedAt))
      })
      .finally(() => setScanning(false))
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-time scan on mount; refreshProjects is stable enough here
  useEffect(() => {
    refreshProjects()
  }, [])
  const openFromFile = (text: string, path: string) => {
    const result = deserializeCircuit(text)
    if (!result.ok) return
    const nm = projectNameFromPath(path)
    recordRecentProject({ name: nm, path, savedAt: Date.now() })
    onCreate({
      template: '',
      templateName: nm,
      name: nm,
      depth: 'design',
      loaded: result.file,
      path,
    })
  }
  const openDialog = async () => {
    const r = await window.chipblocks?.openCircuitDialog?.()
    if (r?.ok && typeof r.text === 'string' && typeof r.path === 'string') {
      openFromFile(r.text, r.path)
    }
  }
  const reopenRecent = async (rp: RecentProject) => {
    const r = await window.chipblocks?.readCircuitFile?.(rp.path)
    if (r?.ok && typeof r.text === 'string') {
      openFromFile(r.text, rp.path)
    } else {
      // the file moved or was deleted — prune the stale entry
      removeRecentProject(rp.path)
      setRecents(listRecentProjects())
    }
  }
  const dropRecent = (path: string) => {
    removeRecentProject(path)
    setRecents(listRecentProjects())
  }

  // The design-depth preview is THIS template's own internals (a transformer's core + windings, a relay's
  // coil + contacts, …) — not the motor's. Falls back to a generic materials-first preview.
  const depthFields =
    depth === 'design' ? (template?.design ?? GENERIC_DESIGN) : (template?.block ?? GENERIC_BLOCK)
  const depthNote =
    depth === 'design'
      ? (template?.note ?? '↓ the terminal behaviour derives from these')
      : 'Type the headline numbers; skip the internals.'

  return (
    <div
      style={{
        height: '100%',
        width: '100%',
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
          {catId === 'recent' ? (
            <div
              style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <button
                type="button"
                onClick={() => void openDialog()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 14px',
                  borderRadius: 8,
                  border: `1px dashed ${BORDER}`,
                  background: PANEL,
                  color: TEXT,
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                <span style={{ fontSize: 18, color: ACCENT }}>+</span>
                Open a saved project… <span style={{ color: MUTED }}>(.chipblocks file)</span>
              </button>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 11,
                  color: MUTED,
                }}
              >
                {scanning
                  ? 'Scanning your folders for saved projects…'
                  : `Found in Documents / Desktop / Downloads · ${recents.length} project${recents.length === 1 ? '' : 's'}`}
                <button
                  type="button"
                  onClick={() => refreshProjects()}
                  title="Scan again"
                  style={{
                    all: 'unset',
                    cursor: 'pointer',
                    color: ACCENT_TEXT,
                    textDecoration: 'underline',
                  }}
                >
                  rescan
                </button>
              </div>
              {recents.length === 0 ? (
                <div style={{ color: MUTED, fontSize: 13, padding: '20px 4px' }}>
                  {scanning
                    ? 'Looking for .chipblocks files…'
                    : 'No saved projects found. Create one from a template and save it (File ▸ Save), or use “Open a saved project…” above — it will appear here to reopen.'}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {recents.map((rp) => (
                    <div
                      key={rp.path}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 12px',
                        borderRadius: 6,
                        border: `1px solid ${BORDER}`,
                        background: PANEL,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => void reopenRecent(rp)}
                        style={{
                          all: 'unset',
                          cursor: 'pointer',
                          flex: 1,
                          minWidth: 0,
                          color: TEXT,
                        }}
                      >
                        <div
                          style={{
                            fontSize: 13,
                            color: TEXT,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {rp.name}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: MUTED,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {rp.path}
                        </div>
                      </button>
                      <button
                        type="button"
                        title="Remove from the list"
                        onClick={() => dropRecent(rp.path)}
                        style={{
                          all: 'unset',
                          cursor: 'pointer',
                          color: MUTED,
                          fontSize: 15,
                          padding: '0 4px',
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : category && category.templates.length > 0 ? (
            category.templates.map((t) => {
              const on = t.id === tplId
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setTplId(t.id)
                    setDepth('design')
                    suggestName(t)
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
          ) : category && (category.id === 'board' || category.id === 'chip') ? (
            <div
              style={{
                gridColumn: '1 / -1',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 14,
                padding: 28,
              }}
            >
              <div style={{ color: MUTED, fontSize: 13, maxWidth: 540, lineHeight: 1.6 }}>
                {category.id === 'board'
                  ? 'The Board workspace lays your circuit out as a real PCB — footprints, copper routing, DRC, and the manufacturing files. Start here, then build your circuit and move along Circuit ▸ Board with the breadcrumb at the top.'
                  : 'The Chip workspace projects your design onto silicon — a standard-cell library, area, and static-timing sign-off. Start here, then build your circuit and move along Circuit ▸ Chip with the breadcrumb at the top.'}
              </div>
              <button
                type="button"
                onClick={() =>
                  onCreate({
                    template: '',
                    templateName: category.label,
                    name: category.id === 'board' ? 'MyBoard' : 'MyChip',
                    depth: 'design',
                    initialWorkspace: category.id as WorkspaceMode,
                  })
                }
                style={{
                  padding: '10px 18px',
                  borderRadius: 8,
                  border: 'none',
                  background: ACCENT,
                  color: THEME.white,
                  fontSize: 13.5,
                  cursor: 'pointer',
                }}
              >
                Start a {category.label} project →
              </button>
            </div>
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
              Coming soon — system-level design arrives as ChipBlocks grows up the stack.
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
                      {depthNote}
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
          onChange={(e) => {
            setName(e.target.value)
            setNameEdited(true)
          }}
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

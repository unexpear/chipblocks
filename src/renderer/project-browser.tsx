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
import {
  deserializeUserTemplates,
  serializeUserTemplates,
  type UserTemplate,
} from './user-templates.ts'
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
  /** Designable parts show the use-as-a-block / design-it depth switch (a materials-first preview). */
  designable?: boolean
  featured?: boolean
  includes: string[]
  /** Suggested project name when this template is picked, before the user types their own. */
  defaultName?: string
  /** The workspace level the editor opens ON (Board / Chip start there instead of the schematic). */
  initialWorkspace?: WorkspaceMode
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
  { id: 'my-templates', label: 'My templates', sub: 'Your saved starters', templates: [] },
  {
    id: 'circuit',
    label: 'Circuit',
    sub: 'Schematic + live sim',
    templates: [
      {
        id: 'blank-circ',
        name: 'Blank circuit',
        desc: 'A clean canvas — drop parts from the palette and wire them up. DC + transient sim live.',
        includes: ['Empty schematic', 'Full parts palette', 'DC + transient sim'],
        defaultName: 'MyCircuit',
      },
      {
        id: 'led-resistor',
        name: 'LED + resistor',
        desc: 'The hello-world: a 5 V source lights an LED through a 150 Ω current-limiting resistor. Wired and lit.',
        glyph: 'led',
        includes: ['5 V source', '150 Ω limit resistor', 'LED (≈ 20 mA)'],
        defaultName: 'MyLED',
      },
      {
        id: 'voltage-divider',
        name: 'Voltage divider',
        desc: 'Two equal 10 kΩ resistors halve a 10 V rail — probe the tap and read 5 V. The most-used building block.',
        glyph: 'resistor',
        includes: ['10 V source', 'R1 = R2 = 10 kΩ', 'Tap at 5 V'],
        defaultName: 'MyDivider',
      },
      {
        id: 'rc-lowpass',
        name: 'RC low-pass filter',
        desc: 'A 1.6 kΩ / 100 nF low-pass — open the Bode panel and read the roll-off at the ≈ 1 kHz corner.',
        glyph: 'capacitor',
        includes: ['AC source', 'R = 1.6 kΩ, C = 100 nF', 'Corner ≈ 1 kHz'],
        defaultName: 'MyFilter',
      },
      {
        id: 'noninv-opamp',
        name: 'Non-inverting amp',
        desc: 'A non-inverting op-amp stage on ±15 V rails, gain = 1 + Rf/Rg = 2 — drive it and scope the output.',
        glyph: 'op_amp',
        includes: ['Op-amp on ±15 V', 'Rf = Rg = 10 kΩ (gain 2)', '1 kHz input tone'],
        defaultName: 'MyAmp',
      },
      {
        id: 'ce-amp',
        name: 'Common-emitter amp',
        desc: 'The classic single-transistor gain stage — divider bias, collector load, bypassed emitter. Biased in the active region (Vc ≈ 5.4 V); drive it and watch it amplify, then clip.',
        glyph: 'transistor_bjt_npn',
        includes: ['NPN + divider bias', 'Rc = 4.7 kΩ, Re = 1 kΩ', 'Bypass + coupling caps'],
        defaultName: 'MyBJTamp',
      },
      {
        id: 'bridge-rectifier',
        name: 'Bridge rectifier',
        desc: 'A full-wave bridge — four diodes + a 470 µF smoothing cap turn 12 V AC into a ≈ 10.6 V DC rail. Run the scope to watch the AC become DC.',
        glyph: 'diode_silicon_rectifier',
        includes: ['4-diode bridge', '470 µF filter cap', '1 kΩ load'],
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
        desc: 'Start from raw materials and build a part up — or drop a ready part (motor, transformer, relay…) from the palette and open it to design its internals.',
        designable: true,
        includes: ['Empty assembly', 'Materials catalog', 'Derived terminal behaviour'],
        defaultName: 'MyPart',
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
        desc: 'Build from real transistor gates up — drop gates, flip-flops and registers from the palette. Live truth tables.',
        includes: ['Logic palette', 'Live truth tables', 'From-transistors view'],
        defaultName: 'MyLogic',
      },
      {
        id: 'logic-gates',
        name: 'Logic gates',
        desc: 'AND, OR and XOR of the same two inputs, side by side — flip switch A and B and watch which LEDs light. A gate is just a function of its inputs.',
        glyph: 'logic_and',
        includes: ['Two switch inputs', 'AND · OR · XOR', 'One LED per gate'],
        defaultName: 'MyGates',
      },
      {
        id: 'full-adder',
        name: 'Full adder',
        desc: 'Sum and Carry of A + B + Cin, from two half-adders. Flip the three switches to walk the whole binary carry table — 1 + 1 + 0 lights the Carry LED.',
        glyph: 'logic_full_adder',
        includes: ['Three switch inputs', 'Real gates inside', 'Sum + Carry LEDs'],
        defaultName: 'MyAdder',
      },
      {
        id: 'adder-4bit',
        name: '4-bit adder → display',
        desc: 'Dial two 4-bit numbers on the switches; the sum shows as a hex digit on a 7-segment display and the Carry LED lights past 15. Starts at 3 + 5 = 8.',
        glyph: 'logic_adder_4bit',
        includes: ['Eight switch inputs', 'Ripple-carry adder', '7-segment sum + carry'],
        defaultName: 'MyAdder4',
      },
      {
        id: 'sr-latch',
        name: 'SR latch',
        desc: 'The first memory — two cross-coupled NOR gates. Tap SET and Q latches on and stays on; tap RESET to clear. No clock. It remembers one bit.',
        glyph: 'logic_sr_latch',
        includes: ['Set / Reset switches', 'Cross-coupled NORs', 'Q + Q̄ LEDs'],
        defaultName: 'MyLatch',
      },
      {
        id: 'd-flipflop',
        name: 'D flip-flop',
        desc: 'Edge-triggered memory — Q copies D only on the clock’s rising edge, then holds. Set D, flip the clock switch 0→1 to capture. The primitive every register is built from.',
        glyph: 'logic_d_flipflop',
        includes: ['Data + clock switches', 'Master–slave inside', 'Q + Q̄ LEDs'],
        defaultName: 'MyFlipFlop',
      },
      {
        id: 'register-4bit',
        name: '4-bit register → display',
        desc: 'Four flip-flops on one clock. Set a nibble on the switches, flip the clock and the whole word latches at once as a hex digit — change the inputs and it holds until the next edge.',
        glyph: 'logic_register_4bit',
        includes: ['Data + clock switches', 'Four D flip-flops', '7-segment stored value'],
        defaultName: 'MyRegister',
      },
      {
        id: 'decoder-2-4',
        name: '2-to-4 decoder',
        desc: 'Two address switches light exactly one of four outputs (one-hot): 00→Y0, 01→Y1, 10→Y2, 11→Y3. The selection front-end of memory, multiplexers and instruction decode.',
        glyph: 'logic_and',
        includes: ['Two address switches', 'One-hot decode', 'Four output LEDs'],
        defaultName: 'MyDecoder',
      },
      {
        id: 'mux-2-1',
        name: '2:1 multiplexer',
        desc: 'A select switch routes input A or B to the output — built from a NOT, two ANDs and an OR: out = (A and not SEL) or (B and SEL). Flip SEL to switch which input reaches the LED.',
        glyph: 'logic_or',
        includes: ['A · B · SEL switches', 'NOT + 2×AND + OR', 'Routed output LED'],
        defaultName: 'MyMux',
      },
      {
        id: 'd-latch',
        name: 'Gated D latch',
        desc: 'Level-sensitive memory — the rung between the SR latch and the flip-flop. While ENABLE is high Q follows D; drop ENABLE and Q freezes at its last value.',
        glyph: 'logic_d_latch',
        includes: ['Data + enable switches', 'Transparent when enabled', 'Q + Q̄ LEDs'],
        defaultName: 'MyLatch',
      },
      {
        id: 'up-counter',
        name: '4-bit up-counter → display',
        desc: 'A register feeds a +1 adder whose sum loops back in, so every clock it stores the next number and the 7-segment display counts 0, 1, 2, … up to F. Flip the clock to step it.',
        glyph: 'logic_adder_4bit',
        includes: ['One clock switch', 'Register + 1 feedback', '7-segment count'],
        defaultName: 'MyCounter',
      },
      {
        id: 'ripple-counter',
        name: '4-bit ripple counter',
        desc: 'Four toggle flip-flops chained: each flips every clock and clocks the next, so bit 0 toggles every clock, bit 1 every two, bit 2 every four — a binary count that ripples up the chain. Flip the clock and watch the LEDs.',
        glyph: 'logic_d_flipflop',
        includes: ['One clock switch', 'Toggle-FF chain', 'Four bit LEDs'],
        defaultName: 'MyRipple',
      },
      {
        id: 'decoder-3-8',
        name: '3-to-8 decoder',
        desc: 'Three address switches light exactly one of eight outputs (one-hot): 000→Y0 … 111→Y7. One more address line than the 2-to-4 decoder.',
        glyph: 'logic_and',
        includes: ['Three address switches', 'One-hot decode', 'Eight output LEDs'],
        defaultName: 'MyDecoder8',
      },
      {
        id: 'encoder-4-2',
        name: '4-to-2 priority encoder',
        desc: 'The reverse of a decoder — raise one of four inputs and read its 2-bit number; the GS “valid” LED lights when any input is active, and if several are on the highest wins.',
        glyph: 'logic_or',
        includes: ['Four input switches', 'Priority logic', '2-bit + valid LEDs'],
        defaultName: 'MyEncoder',
      },
      {
        id: 'encoder-8-3',
        name: '8-to-3 priority encoder',
        desc: 'The inverse of the 3-to-8 decoder — raise one of eight inputs and read its 3-bit number on the LEDs; GS lights when any input is active and the highest raised input wins.',
        glyph: 'logic_or',
        includes: ['Eight input switches', 'Priority logic', '3-bit + valid LEDs'],
        defaultName: 'MyEncoder8',
      },
      {
        id: 'sram-cell',
        name: 'SRAM cell (6T)',
        desc: 'The static memory bit — two cross-coupled inverters plus two access transistors. Raise the word line, drive the two complementary bit lines, and the cell writes it, snapping Q and Q̄ to solid rails. Descend to see the six real transistors.',
        glyph: 'logic_d_latch',
        includes: ['Word-line + bit-line switches', 'Cross-coupled inverters', 'Q + Q̄ LEDs'],
        defaultName: 'MySRAM',
      },
    ],
  },
  {
    id: 'board',
    label: 'Board / PCB',
    sub: 'Place parts, route copper, export Gerbers',
    templates: [
      {
        id: 'blank-board',
        name: 'Blank board',
        desc: 'An empty PCB — place footprints, route copper, run DRC and export the Gerbers. Draw the schematic first, then move Circuit ▸ Board with the breadcrumb.',
        includes: ['Footprint placement', 'Copper + via routing', 'DRC · Gerber / drill export'],
        initialWorkspace: 'board',
        defaultName: 'MyBoard',
      },
    ],
  },
  {
    id: 'chip',
    label: 'Chip / IC',
    sub: 'Standard cells, floorplan, timing sign-off',
    templates: [
      {
        id: 'blank-chip',
        name: 'Blank chip',
        desc: 'An empty silicon floorplan — standard cells, placement and static-timing sign-off. Build the logic first, then move Circuit ▸ Chip with the breadcrumb.',
        includes: ['Standard-cell library', 'Floorplan + area', 'Static-timing sign-off'],
        initialWorkspace: 'chip',
        defaultName: 'MyChip',
      },
    ],
  },
  { id: 'system', label: 'System', sub: 'Coming soon', soon: true, templates: [] },
]

const ACCENT = THEME.accentBlueDeep

// Built-in starters the user hid (they don't want them) — persisted per machine. Hiding a shipped
// template only removes it from view; "restore" brings them all back. (User templates + saved projects
// are deleted for real.)
const HIDDEN_TEMPLATES_KEY = 'chipblocks:hidden-templates'
function loadHiddenTemplates(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_TEMPLATES_KEY)
    const arr: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

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
    if (c.id === 'my-templates') refreshTemplates() // pick up anything saved since mount
  }

  const create = () => {
    if (!template) return
    onCreate({
      template: template.id,
      templateName: template.name,
      name,
      depth,
      ...(template.initialWorkspace ? { initialWorkspace: template.initialWorkspace } : {}),
    })
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

  // "My templates": the starters you saved with File ▸ Save as Template (~/.chipblocks/user-templates.json).
  // Picking one opens a FRESH project from its saved circuit (no path → a first Save asks where to put it).
  const [userTemplates, setUserTemplates] = useState<UserTemplate[]>([])
  const refreshTemplates = () => {
    const read = window.chipblocks?.readUserTemplates
    if (read === undefined) return
    void read().then((text) => {
      if (text === null) {
        setUserTemplates([])
        return
      }
      const result = deserializeUserTemplates(text)
      setUserTemplates(result.ok ? result.templates : [])
    })
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-time load on mount
  useEffect(() => {
    refreshTemplates()
  }, [])
  const startTemplate = (t: UserTemplate) => {
    onCreate({
      template: '',
      templateName: t.name,
      name: t.name,
      depth: 'design',
      loaded: t.circuit,
      ...(t.workspace !== 'schematic' ? { initialWorkspace: t.workspace } : {}),
    })
  }
  const deleteTemplate = (id: string) => {
    const write = window.chipblocks?.writeUserTemplates
    if (write === undefined) return
    const next = userTemplates.filter((t) => t.id !== id)
    setUserTemplates(next)
    void write(serializeUserTemplates(next))
  }
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

  // Delete confirmation — a guard against an accidental × click. The × buttons ASK; the real delete
  // (a saved project, a user template, or hiding a built-in starter) runs only on confirm.
  const [confirmDelete, setConfirmDelete] = useState<{
    name: string
    detail: string
    label: string
    onConfirm: () => void
  } | null>(null)

  // Built-in starters the user chose to remove — hidden (persisted), not deleted; a restore link
  // per category brings them back.
  const [hiddenTemplates, setHiddenTemplates] = useState<Set<string>>(() => loadHiddenTemplates())
  const persistHidden = (next: Set<string>) => {
    setHiddenTemplates(next)
    try {
      localStorage.setItem(HIDDEN_TEMPLATES_KEY, JSON.stringify([...next]))
    } catch {
      // a blocked localStorage just means hides don't persist across restarts — not worth failing over
    }
  }
  const hideTemplate = (id: string) => {
    const next = new Set(hiddenTemplates)
    next.add(id)
    persistHidden(next)
    if (tplId === id) setTplId('')
  }
  const restoreTemplates = (ids: string[]) => {
    const next = new Set(hiddenTemplates)
    for (const id of ids) next.delete(id)
    persistHidden(next)
  }

  // The design-depth preview is THIS template's own internals (a transformer's core + windings, a relay's
  // coil + contacts, …) — not the motor's. Falls back to a generic materials-first preview.
  const depthFields = depth === 'design' ? GENERIC_DESIGN : GENERIC_BLOCK
  const depthNote =
    depth === 'design'
      ? '↓ the terminal behaviour derives from these'
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
                        onClick={() =>
                          setConfirmDelete({
                            name: rp.name,
                            detail: 'It comes off this list — the saved file itself is kept.',
                            label: 'Remove',
                            onConfirm: () => dropRecent(rp.path),
                          })
                        }
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
          ) : catId === 'my-templates' ? (
            <div
              style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.5 }}>
                Saved from any project with <strong>File ▸ Save as Template</strong> — pick one to
                start a fresh project from it (your own blocks come along).
              </div>
              {userTemplates.length === 0 ? (
                <div style={{ color: MUTED, fontSize: 13, padding: '20px 4px', lineHeight: 1.6 }}>
                  No saved templates yet. Open a project, wire it up, then choose File ▸ Save as
                  Template — it will appear here to start new projects from.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {userTemplates.map((t) => (
                    <div
                      key={t.id}
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
                        onClick={() => startTemplate(t)}
                        style={{
                          all: 'unset',
                          cursor: 'pointer',
                          flex: 1,
                          minWidth: 0,
                          color: TEXT,
                        }}
                      >
                        <div style={{ fontSize: 13, color: TEXT }}>{t.name}</div>
                        <div style={{ fontSize: 11, color: MUTED }}>
                          {t.circuit.nodes.length} part{t.circuit.nodes.length === 1 ? '' : 's'} ·{' '}
                          {t.workspace}
                        </div>
                      </button>
                      <button
                        type="button"
                        title="Delete this template"
                        onClick={() =>
                          setConfirmDelete({
                            name: t.name,
                            detail: 'This removes it from My templates for good.',
                            label: 'Delete',
                            onConfirm: () => deleteTemplate(t.id),
                          })
                        }
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
            <>
              {category.templates.some((t) => hiddenTemplates.has(t.id)) ? (
                <div style={{ gridColumn: '1 / -1', fontSize: 11, color: MUTED }}>
                  {category.templates.filter((t) => hiddenTemplates.has(t.id)).length} hidden ·{' '}
                  <button
                    type="button"
                    onClick={() => restoreTemplates(category.templates.map((t) => t.id))}
                    style={{
                      all: 'unset',
                      cursor: 'pointer',
                      color: ACCENT_TEXT,
                      textDecoration: 'underline',
                    }}
                  >
                    restore
                  </button>
                </div>
              ) : null}
              {category.templates
                .filter((t) => !hiddenTemplates.has(t.id))
                .map((t) => {
                  const on = t.id === tplId
                  // The blank/empty starts stay — you always need a clean canvas to begin from.
                  const hideable = !t.id.startsWith('blank')
                  return (
                    <div key={t.id} style={{ position: 'relative' }}>
                      <button
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
                          width: '100%',
                          boxSizing: 'border-box',
                        }}
                      >
                        <Thumb glyph={t.glyph} size={1.2} light={light} />
                        <span style={{ fontSize: 13, color: on ? ACCENT_TEXT : TEXT }}>
                          {t.name}
                        </span>
                      </button>
                      {hideable ? (
                        <button
                          type="button"
                          title="Remove this starter"
                          onClick={() =>
                            setConfirmDelete({
                              name: t.name,
                              detail: 'It’s hidden from your starters — Restore brings it back.',
                              label: 'Hide',
                              onConfirm: () => hideTemplate(t.id),
                            })
                          }
                          style={{
                            position: 'absolute',
                            top: 6,
                            right: 6,
                            zIndex: 1,
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: MUTED,
                            fontSize: 15,
                            lineHeight: 1,
                            padding: '2px 6px',
                            borderRadius: 4,
                          }}
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                  )
                })}
            </>
          ) : (
            <div
              style={{
                gridColumn: '1 / -1',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
                color: MUTED,
                textAlign: 'center',
                padding: 40,
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 600, color: TEXT }}>System — coming soon</div>
              <div style={{ maxWidth: 460 }}>
                System-level design — assemblies, enclosures and firmware wired across several
                boards — arrives as ChipBlocks grows up the stack. For now, design at the Circuit,
                Component, Board and Chip levels and move between them with the breadcrumb.
              </div>
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
      {confirmDelete !== null ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setConfirmDelete(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 380,
              maxWidth: '90vw',
              background: PANEL,
              border: `1px solid ${BORDER}`,
              borderRadius: 12,
              padding: 20,
              color: TEXT,
              boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
              {confirmDelete.label} “{confirmDelete.name}”?
            </div>
            <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.5, marginBottom: 18 }}>
              {confirmDelete.detail}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 7,
                  border: `1px solid ${BORDER}`,
                  background: 'transparent',
                  color: TEXT,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  confirmDelete.onConfirm()
                  setConfirmDelete(null)
                }}
                style={{
                  padding: '8px 16px',
                  borderRadius: 7,
                  border: '1px solid #c0392b',
                  background: '#c0392b',
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {confirmDelete.label}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {shortcutsPanel}
    </div>
  )
}

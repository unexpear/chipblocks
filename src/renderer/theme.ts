/**
 * THE COLOUR THEMES — the palettes you can switch between (Settings ▸ Theme).
 *
 * Every `THEME.x` the app uses is the CSS variable `var(--x)`, so switching a theme just
 * re-points the variables on :root and the WHOLE app — panels, canvas, SVG — re-skins at
 * once. Each theme gives every token a value plus a `light` flag (light themes flip the
 * on-light-background styling the UI already knows how to do).
 *
 * TO ADD OR RESTYLE A THEME: edit THEMES below — copy a block, rename it, change the colours.
 * A new entry appears in the Settings ▸ Theme menu automatically (the renderer registers the
 * list with the native menu on start-up). Near-identical shades were already folded into one
 * canonical scale, so each token here means one thing.
 */

// The base dark palette — every token, grouped by role. Other dark themes start from this and
// override only what differs; the light theme reuses it (its `light` flag flips the styling).
const MIDNIGHT = {
  // surfaces — deepest void → most-raised control
  surfaceDeep: '#0c0c0e',
  surfaceBase: '#141417',
  surfacePanel: '#17171b',
  surfaceInput: '#1a1a1e',
  surfaceRaised: '#1b1b1f',
  surfaceActive: '#24405f',
  black: '#000000',
  // borders
  borderSubtle: '#2a2a2f',
  borderStrong: '#3a3a3f',
  // ink — brightest → faintest
  white: '#ffffff',
  textBright: '#e8eaed',
  textPrimary: '#cdd6e0',
  textSoft: '#9fb0c0',
  textMuted: '#8a93a0',
  textFaint: '#6b7589',
  // accents
  accentBlue: '#7ab8ff',
  accentBlueSoft: '#9fd0ff',
  accentBlueBright: '#6ec0ff',
  accentBlueDeep: '#5a86d8',
  accentPurple: '#a06ad8',
  accentLasso: '#c08ae0',
  accentTimeline: '#e0b070',
  accentPink: '#d85a9a',
  accentLime: '#9ad85a',
  // status
  statusOk: '#6ec06e',
  statusWarn: '#d6a23c',
  statusDanger: '#e0594f',
  // lens overlays
  lensTemp: '#e0a050',
  lensField: '#5ad8c8',
  lensEnergy: '#e8b84b',
}

export type Palette = typeof MIDNIGHT

// A cool blue dark — clearly blue-tinted surfaces, a bright cyan-blue accent.
const SLATE: Palette = {
  ...MIDNIGHT,
  surfaceDeep: '#070d18',
  surfaceBase: '#0c1422',
  surfacePanel: '#101c2e',
  surfaceInput: '#0c1421',
  surfaceRaised: '#142136',
  surfaceActive: '#1e4d86',
  borderSubtle: '#21324c',
  borderStrong: '#2d4366',
  textPrimary: '#cfdaea',
  textSoft: '#a0b5cf',
  textMuted: '#8694ab',
  accentBlue: '#5cb6ff',
  accentBlueSoft: '#93d4ff',
  accentBlueBright: '#48cbe8',
  accentBlueDeep: '#3a80d8',
}

// A warm violet dark — aubergine surfaces, a magenta-violet accent.
const DUSK: Palette = {
  ...MIDNIGHT,
  surfaceDeep: '#150a1b',
  surfaceBase: '#1e1128',
  surfacePanel: '#251732',
  surfaceInput: '#1d1229',
  surfaceRaised: '#2a1c39',
  surfaceActive: '#4f3072',
  borderSubtle: '#382945',
  borderStrong: '#4c395c',
  textPrimary: '#e3d7ea',
  textSoft: '#bfa8cc',
  textMuted: '#9e8bac',
  accentBlue: '#cb8cff',
  accentBlueSoft: '#ddb4ff',
  accentBlueBright: '#e07ad8',
  accentBlueDeep: '#9c5cdc',
}

// A green forest dark — moss-tinted surfaces, a green accent.
const FOREST: Palette = {
  ...MIDNIGHT,
  surfaceDeep: '#07120b',
  surfaceBase: '#0c1b11',
  surfacePanel: '#102317',
  surfaceInput: '#0c1911',
  surfaceRaised: '#142c1c',
  surfaceActive: '#1f6340',
  borderSubtle: '#20382a',
  borderStrong: '#2c4e38',
  textPrimary: '#d3e3d8',
  textSoft: '#a4c1ad',
  textMuted: '#86a18d',
  accentBlue: '#5fd28a',
  accentBlueSoft: '#93e4af',
  accentBlueBright: '#46d2b2',
  accentBlueDeep: '#3a9d66',
}

export type ThemeName = 'midnight' | 'daylight' | 'slate' | 'dusk' | 'forest'

export const THEMES: Record<ThemeName, { label: string; light: boolean; colors: Palette }> = {
  midnight: { label: 'Midnight', light: false, colors: MIDNIGHT },
  daylight: { label: 'Daylight', light: true, colors: MIDNIGHT },
  slate: { label: 'Slate', light: false, colors: SLATE },
  dusk: { label: 'Dusk', light: false, colors: DUSK },
  forest: { label: 'Forest', light: false, colors: FOREST },
}

/** The themes in order, for building the menu / picker. */
export const THEME_LIST = (Object.keys(THEMES) as ThemeName[]).map((id) => ({
  id,
  label: THEMES[id].label,
}))

// Every token as a CSS-variable reference — this is what the whole app reads.
export const THEME = Object.fromEntries(
  (Object.keys(MIDNIGHT) as (keyof Palette)[]).map((key) => [key, `var(--${key})`]),
) as Record<keyof Palette, string>

const STORAGE_KEY = 'chipblocks.theme'

/** Point the CSS variables at a theme's colours — the whole app re-skins instantly. */
export function applyTheme(name: ThemeName): void {
  if (typeof document === 'undefined') return
  const theme = THEMES[name] ?? THEMES.midnight
  const root = document.documentElement
  for (const [token, value] of Object.entries(theme.colors)) {
    root.style.setProperty(`--${token}`, value)
  }
}

/** Whether a theme is a light one (drives the on-light-background styling). */
export function isLight(name: ThemeName): boolean {
  return THEMES[name]?.light ?? false
}

/** The saved theme (or the default). */
export function loadTheme(): ThemeName {
  if (typeof localStorage === 'undefined') return 'midnight'
  const saved = localStorage.getItem(STORAGE_KEY)
  return saved && saved in THEMES ? (saved as ThemeName) : 'midnight'
}

/** Persist a theme choice. */
export function saveTheme(name: ThemeName): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, name)
}

// Apply the saved (or default) theme at import time — before first paint, so there is no
// flash of unstyled colour.
applyTheme(loadTheme())

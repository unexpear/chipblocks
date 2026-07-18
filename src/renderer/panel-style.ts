/**
 * Shared styling for the analysis panels (reflection / distortion / S-parameters): the light-aware colour
 * roles, the field/label styles, and the RF frequency-span presets. Extracted from three copies so the panels
 * read the same and a theme tweak lands in one place. Each panel keeps its own (structurally different) plot.
 */
import type { CSSProperties } from 'react'
import { THEME } from './theme.ts'

/** The panels' light-aware colour roles: primary text, muted sub-text, and the plot grid line colour. */
export const panelColors = (light: boolean) => ({
  text: light ? THEME.borderSubtle : THEME.textPrimary,
  sub: light ? THEME.textFaint : THEME.textMuted,
  gridCol: light ? THEME.textPrimary : THEME.surfaceRaised,
})

/** The shared input/select style; spread + override `maxWidth` where a panel wants a narrower box. */
export const panelFieldStyle = (light: boolean): CSSProperties => ({
  background: light ? THEME.white : THEME.surfaceInput,
  border: `1px solid ${light ? THEME.textPrimary : THEME.borderStrong}`,
  color: light ? THEME.borderSubtle : THEME.textPrimary,
  borderRadius: 3,
  fontSize: 11,
  padding: '2px 4px',
  maxWidth: 150,
})

/** The shared uppercase field-label style. */
export const panelLabelStyle = (light: boolean): CSSProperties => ({
  fontSize: 9,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: light ? THEME.textFaint : THEME.textMuted,
})

/** The RF frequency-span presets shared by the reflection + S-parameter sweeps (a decade-wide log span each). */
export const RF_FREQUENCY_RANGES: { label: string; lo: number; hi: number }[] = [
  { label: '1 Hz – 1 MHz', lo: 1, hi: 1e6 },
  { label: '1 kHz – 1 GHz', lo: 1e3, hi: 1e9 },
  { label: '1 MHz – 10 GHz', lo: 1e6, hi: 1e10 },
  { label: '10 MHz – 100 GHz', lo: 1e7, hi: 1e11 },
]

/**
 * THE COLOUR THEME — the whole app's palette in one place. Edit a value here and every
 * surface, border, button, label and accent that uses it re-skins at once: this is the
 * single edit that restyles the app.
 *
 * This is the CONSOLIDATED palette. The UI had drifted into dozens of near-identical shades
 * (a dozen barely-different greys, several almost-equal blues/ambers/reds); they are folded
 * here into one canonical scale, so a colour has exactly one name and one definition. A few
 * genuine one-offs (a single lime tint, one pink) stay inline where they appear — they are
 * used once and aren't part of the shared palette.
 *
 * Grouped by role: surfaces (backgrounds, deepest → most raised), borders, ink (text, brightest
 * → faintest), accents, status (ok / warn / danger), and the lens hues (the physics overlays).
 */
export const THEME = {
  // ── Surfaces — backgrounds, deepest void → most-raised control ──
  surfaceDeep: '#0c0c0e',
  surfaceBase: '#141417',
  surfacePanel: '#17171b',
  surfaceInput: '#1a1a1e',
  surfaceRaised: '#1b1b1f',
  surfaceActive: '#24405f', // a selected / active control (blue-tinted)
  black: '#000000',

  // ── Borders ──
  borderSubtle: '#2a2a2f',
  borderStrong: '#3a3a3f',

  // ── Ink — text, brightest heading → faintest label ──
  white: '#ffffff',
  textBright: '#e8eaed',
  textPrimary: '#cdd6e0',
  textSoft: '#9fb0c0',
  textMuted: '#8a93a0',
  textFaint: '#6b7589',

  // ── Accents ──
  accentBlue: '#7ab8ff', // the primary accent — active tool, links, Solve
  accentBlueSoft: '#9fd0ff',
  accentBlueBright: '#6ec0ff',
  accentBlueDeep: '#5a86d8',
  accentPurple: '#a06ad8', // Group
  accentLasso: '#c08ae0',
  accentTimeline: '#e0b070',
  accentPink: '#d85a9a', // a distinct scope-trace hue
  accentLime: '#9ad85a', // a distinct scope-trace hue

  // ── Status ──
  statusOk: '#6ec06e',
  statusWarn: '#d6a23c', // also the Voltage lens / Math / Margins amber
  statusDanger: '#e0594f', // errors, over-limit, the red meter probe

  // ── Lens hues (the physics overlays) ──
  lensTemp: '#e0a050',
  lensField: '#5ad8c8',
  lensEnergy: '#e8b84b',
}

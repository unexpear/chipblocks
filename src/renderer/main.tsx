import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { SYMBOL_STYLE_EVENT, SymbolStyleProvider } from './symbol-style.tsx'
import { applyTheme, loadTheme, saveTheme, THEME_LIST, type ThemeName } from './theme.ts'

const root = document.getElementById('root')
if (root === null) throw new Error('renderer root element not found')

// The colour-theme switcher (native Settings ▸ Theme menu) is wired HERE, at the entry point,
// so it works on every screen — including the project browser, before the editor mounts. The
// renderer hands the menu the theme list (from theme.ts); the menu hands back the chosen id;
// we re-point the CSS variables (applyTheme), remember it, and broadcast a window event so any
// mounted view can react (the editor flips its light/dark styling).
const bridge = window.chipblocks
if (bridge !== undefined) {
  bridge.registerThemes?.(THEME_LIST, loadTheme())
  bridge.onTheme((next) => {
    const name = next as ThemeName
    applyTheme(name)
    saveTheme(name)
    window.dispatchEvent(new CustomEvent('chipblocks:theme', { detail: name }))
  })
  // The native Settings ▸ Shortcuts item opens the keybinds panel; broadcast it so whichever
  // screen is mounted (project browser or editor) hears it and opens its panel.
  bridge.onShortcutsOpen?.(() => window.dispatchEvent(new Event('chipblocks:shortcuts')))
  bridge.onSymbolStyle?.((next) => {
    window.dispatchEvent(new CustomEvent(SYMBOL_STYLE_EVENT, { detail: next }))
  })
}

createRoot(root).render(
  <StrictMode>
    <SymbolStyleProvider>
      <App />
    </SymbolStyleProvider>
  </StrictMode>,
)

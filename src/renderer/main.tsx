import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { ErrorBoundary } from './error-boundary.tsx'
import { type HoverHelpMode, loadHoverHelpMode, setHoverHelpMode } from './hover-help-pref.ts'
import { SYMBOL_STYLE_EVENT, SymbolStyleProvider } from './symbol-style.tsx'
import { applyTheme, loadTheme, saveTheme, THEME_LIST, type ThemeName } from './theme.ts'
import { HoverHelpProvider } from './tooltip.tsx'

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
  // Settings ▸ Shortcuts and Tools ▸ Plugin & Content Manager. Every screen stays mounted and
  // hears the event; only the active one opens its panel (a background tab ignores it).
  bridge.onShortcutsOpen?.(() => window.dispatchEvent(new Event('chipblocks:shortcuts')))
  bridge.onContentManagerOpen?.(() => window.dispatchEvent(new Event('chipblocks:content-manager')))
  bridge.onSymbolStyle?.((next) => {
    window.dispatchEvent(new CustomEvent(SYMBOL_STYLE_EVENT, { detail: next }))
  })
  bridge.registerHoverHelp?.(loadHoverHelpMode())
  bridge.onHoverHelp?.((next) => {
    if (next === 'full' || next === 'brief' || next === 'off')
      setHoverHelpMode(next as HoverHelpMode)
  })
}

createRoot(root).render(
  <StrictMode>
    <HoverHelpProvider>
      <SymbolStyleProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </SymbolStyleProvider>
    </HoverHelpProvider>
  </StrictMode>,
)

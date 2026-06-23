import { createContext, type ReactNode, useEffect, useState } from 'react'

/**
 * Symbol-style setting — which schematic-symbol standard the glyphs draw in. ChipBlocks ships US /
 * IEEE-315 (zigzag resistors) as its standard; a user can switch to IEC (rectangular resistors, KiCad's
 * default look). Only the symbols that genuinely differ between the two standards react — mainly the
 * resistor family (resistor / potentiometer / thermistor / photoresistor), which all share one
 * `ResistorTrack`. Everything else (capacitor, diode, transistor, source, ground…) is identical in both.
 *
 * Mirrors the theme: a persisted choice + a default, re-applied via a context the glyphs read. The
 * native Settings ▸ Symbol Style menu broadcasts `chipblocks:symbol-style`, which this provider hears.
 */

export type SymbolStyle = 'ieee' | 'iec'

const STORAGE_KEY = 'chipblocks-symbol-style'
export const SYMBOL_STYLE_EVENT = 'chipblocks:symbol-style'

/** The saved symbol style, or the IEEE-315 default. */
export function loadSymbolStyle(): SymbolStyle {
  if (typeof localStorage === 'undefined') return 'ieee'
  return localStorage.getItem(STORAGE_KEY) === 'iec' ? 'iec' : 'ieee'
}

/** Persist a symbol-style choice. */
export function saveSymbolStyle(style: SymbolStyle): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, style)
}

export const SymbolStyleContext = createContext<SymbolStyle>('ieee')

/**
 * Holds the active symbol style, persists changes, and re-provides on change. Wrap the app in it (the
 * glyphs read the context); the Settings menu fires `chipblocks:symbol-style` to switch it.
 */
export function SymbolStyleProvider({ children }: { children: ReactNode }) {
  const [style, setStyle] = useState<SymbolStyle>(loadSymbolStyle)
  useEffect(() => {
    const handler = (event: Event) => {
      const next = (event as CustomEvent<SymbolStyle>).detail
      if (next === 'ieee' || next === 'iec') {
        setStyle(next)
        saveSymbolStyle(next)
      }
    }
    window.addEventListener(SYMBOL_STYLE_EVENT, handler)
    return () => window.removeEventListener(SYMBOL_STYLE_EVENT, handler)
  }, [])
  return <SymbolStyleContext.Provider value={style}>{children}</SymbolStyleContext.Provider>
}

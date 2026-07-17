/**
 * The in-app Verilog editor — write hardware in Verilog, see it highlighted, see LIVE what will and won't
 * synthesize, and drop the resulting real gates onto the canvas. There was no editor before (Verilog only came
 * in as an imported .v file); this closes the loop. It reuses the synthesizer itself for the diagnostics — the
 * same `importVerilog` that builds the gates reports, as you type, exactly what it can't build and why.
 *
 * Deliberately dependency-free (no CodeMirror/Monaco): a transparent <textarea> for editing over a syntax-
 * coloured <pre> layer, scroll-synced, with a line-number gutter. Colours are the theme's CSS variables, so it
 * re-skins with the app.
 */

import { type JSX, useEffect, useMemo, useRef, useState } from 'react'
import type { BlockData } from './blocks.ts'
import { importVerilog } from './verilog-import.ts'

const KEYWORDS = new Set([
  'module',
  'endmodule',
  'input',
  'output',
  'inout',
  'wire',
  'reg',
  'integer',
  'parameter',
  'localparam',
  'always',
  'assign',
  'initial',
  'begin',
  'end',
  'if',
  'else',
  'case',
  'casex',
  'casez',
  'endcase',
  'default',
  'for',
  'while',
  'posedge',
  'negedge',
  'signed',
  'generate',
  'endgenerate',
  'function',
  'endfunction',
  'task',
  'endtask',
])
const GATE_KEYWORDS = new Set(['and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor', 'buf'])

export type Tok = {
  type: 'ws' | 'comment' | 'string' | 'number' | 'keyword' | 'gate' | 'ident' | 'op'
  text: string
}

/** Tokenize Verilog for COLOURING (not parsing) — every character lands in exactly one span, so the coloured
 *  layer is a character-for-character copy of the text with class-per-token. */
export function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i] as string
    if (/\s/.test(c)) {
      let j = i
      while (j < n && /\s/.test(src[j] as string)) j++
      out.push({ type: 'ws', text: src.slice(i, j) })
      i = j
    } else if (c === '/' && src[i + 1] === '/') {
      let j = i
      while (j < n && src[j] !== '\n') j++
      out.push({ type: 'comment', text: src.slice(i, j) })
      i = j
    } else if (c === '/' && src[i + 1] === '*') {
      let j = i + 2
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++
      j = Math.min(j + 2, n)
      out.push({ type: 'comment', text: src.slice(i, j) })
      i = j
    } else if (c === '"') {
      let j = i + 1
      while (j < n && src[j] !== '"' && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1
      j = Math.min(j + 1, n)
      out.push({ type: 'string', text: src.slice(i, j) })
      i = j
    } else if (/[0-9]/.test(c) || (c === "'" && /[sSbBoOdDhH]/.test(src[i + 1] ?? ''))) {
      const m = /^(\d[\d_]*)?'[sS]?[bBoOdDhH][0-9a-fA-FxXzZ?_]+|^\d[\d_]*/.exec(src.slice(i))
      const t = m ? m[0] : c
      out.push({ type: 'number', text: t })
      i += t.length
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i))
      const t = m ? m[0] : c
      out.push({
        type: KEYWORDS.has(t) ? 'keyword' : GATE_KEYWORDS.has(t) ? 'gate' : 'ident',
        text: t,
      })
      i += t.length
    } else {
      const m = /^[-+*/%&|^~!<>=?:.,;(){}[\]@#']+/.exec(src.slice(i))
      const t = m ? m[0] : c
      out.push({ type: 'op', text: t })
      i += t.length
    }
  }
  return out
}

const COLOR: Record<Tok['type'], string> = {
  ws: 'inherit',
  comment: 'var(--textFaint)',
  string: 'var(--accentLime)',
  number: 'var(--accentTimeline)',
  keyword: 'var(--accentPurple)',
  gate: 'var(--accentBlue)',
  ident: 'var(--textPrimary)',
  op: 'var(--textSoft)',
}

const FONT =
  '13px "SF Mono", "JetBrains Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, monospace'
const PAD = 10
const LINE_HEIGHT = 20

/** The identifier prefix being typed just before the caret (what autocomplete matches on). */
export function prefixBefore(value: string, caret: number): string {
  const m = /[A-Za-z_$][A-Za-z0-9_$]*$/.exec(value.slice(0, caret))
  return m ? m[0] : ''
}

/** Completion candidates for a prefix: the language's keywords + gate primitives, plus every identifier
 *  already written in the buffer (so a module's own declared signals — inputs, outputs, wires, regs —
 *  autocomplete the moment they've been named once). Case-insensitive match, exact prefix excluded. */
export function completionsFor(prefix: string, value: string): string[] {
  const pool = new Set<string>([...KEYWORDS, ...GATE_KEYWORDS])
  for (const t of tokenize(value)) {
    if (t.type === 'ident' || t.type === 'keyword' || t.type === 'gate') pool.add(t.text)
  }
  const low = prefix.toLowerCase()
  return [...pool]
    .filter((w) => w !== prefix && w.toLowerCase().startsWith(low))
    .sort()
    .slice(0, 12)
}

type Autocomplete = { items: string[]; index: number; prefix: string; left: number; top: number }

export type SynthDiagnostics = {
  block: BlockData | null
  warnings: string[]
  moduleName: string | null
  gateCount: number
}

/** Synthesize the text and count the real cells the block lowered to (gates + flip-flops). */
function synthesize(text: string): SynthDiagnostics {
  if (!text.trim()) return { block: null, warnings: [], moduleName: null, gateCount: 0 }
  const { block, warnings, moduleName } = importVerilog(text)
  return { block, warnings, moduleName, gateCount: block ? block.nodes.length : 0 }
}

export function VerilogEditor({
  initialText,
  onSynthesize,
  onClose,
}: {
  initialText: string
  onSynthesize: (block: BlockData, moduleName: string) => void
  onClose: () => void
}): JSX.Element {
  const [text, setText] = useState(initialText)
  const [diag, setDiag] = useState<SynthDiagnostics>(() => synthesize(initialText))
  const [ac, setAc] = useState<Autocomplete | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const pendingCaret = useRef<number | null>(null)

  // One monospace character's width, measured once — the caret's pixel column is col × this, which is exact
  // for a fixed-pitch font and lets the autocomplete popup sit right under the word being typed.
  const charWidth = useMemo(() => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return 7.8
    ctx.font = FONT
    return ctx.measureText('MMMMMMMMMM').width / 10
  }, [])

  // Recompute the autocomplete popup from the current text + caret: the prefix under the caret, the matching
  // candidates, and where to float the list (below the caret line, offset by column × char width).
  const refreshAc = (value: string, caret: number) => {
    const prefix = prefixBefore(value, caret)
    const items = prefix.length >= 1 ? completionsFor(prefix, value) : []
    if (items.length === 0) {
      setAc(null)
      return
    }
    const before = value.slice(0, caret)
    const row = before.split('\n').length - 1
    const col = before.length - (before.lastIndexOf('\n') + 1)
    const ta = taRef.current
    const left = PAD + col * charWidth - (ta?.scrollLeft ?? 0)
    const top = PAD + (row + 1) * LINE_HEIGHT - (ta?.scrollTop ?? 0)
    setAc({ items, index: 0, prefix, left, top })
  }

  const acceptCompletion = (word: string) => {
    const ta = taRef.current
    if (!ta || !ac) return
    const caret = ta.selectionStart
    const start = caret - ac.prefix.length
    const next = text.slice(0, start) + word + text.slice(caret)
    pendingCaret.current = start + word.length
    setText(next)
    setAc(null)
  }

  // Live diagnostics: re-synthesize a short beat after typing stops, so the "what won't build" list is always
  // current without running the whole synthesizer on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDiag(synthesize(text)), 250)
    return () => clearTimeout(id)
  }, [text])

  // After accepting a completion the text changed programmatically; put the caret back just past the inserted
  // word (React resets it to the end on a controlled-value change otherwise).
  useEffect(() => {
    if (pendingCaret.current === null) return
    const ta = taRef.current
    if (ta) {
      const caret = Math.min(pendingCaret.current, text.length)
      ta.selectionStart = caret
      ta.selectionEnd = caret
      ta.focus()
    }
    pendingCaret.current = null
  }, [text])

  const onEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!ac) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setAc({ ...ac, index: (ac.index + 1) % ac.items.length })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setAc({ ...ac, index: (ac.index - 1 + ac.items.length) % ac.items.length })
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      acceptCompletion(ac.items[ac.index] as string)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setAc(null)
    }
  }

  const tokens = useMemo(() => tokenize(text), [text])
  const lineCount = useMemo(() => text.split('\n').length, [text])

  const syncScroll = () => {
    const ta = taRef.current
    if (!ta) return
    if (preRef.current) {
      preRef.current.scrollTop = ta.scrollTop
      preRef.current.scrollLeft = ta.scrollLeft
    }
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop
  }

  const ok = diag.block !== null && diag.warnings.length === 0
  const shared: React.CSSProperties = {
    margin: 0,
    border: 0,
    padding: PAD,
    font: FONT,
    lineHeight: `${LINE_HEIGHT}px`,
    whiteSpace: 'pre',
    tabSize: 2,
    boxSizing: 'border-box',
  }

  return (
    <div
      style={{
        // Anchored top AND bottom within its containing block (the canvas area) — NOT a 100vh-derived
        // height, which overflows on short windows and clips the footer (the Synthesize button + the
        // live "what won't build" report). This keeps the whole panel on-screen at any window height.
        position: 'absolute',
        top: 16,
        bottom: 16,
        right: 16,
        width: 620,
        maxWidth: 'calc(100vw - 32px)',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surfacePanel)',
        border: '1px solid var(--borderStrong)',
        borderRadius: 8,
        zIndex: 60,
        boxShadow: '0 8px 30px rgba(0,0,0,0.45)',
        overflow: 'hidden',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid var(--borderSubtle)',
          color: 'var(--textBright)',
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        <span>Verilog{diag.moduleName ? ` · ${diag.moduleName}` : ''}</span>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 0,
            color: 'var(--textSoft)',
            cursor: 'pointer',
            fontSize: 16,
          }}
        >
          ×
        </button>
      </header>

      <div style={{ display: 'flex', flex: 1, minHeight: 0, background: 'var(--surfaceInput)' }}>
        <div
          ref={gutterRef}
          aria-hidden
          style={{
            ...shared,
            padding: `${PAD}px 6px ${PAD}px 10px`,
            overflow: 'hidden',
            textAlign: 'right',
            color: 'var(--textFaint)',
            userSelect: 'none',
            background: 'var(--surfaceBase)',
            borderRight: '1px solid var(--borderSubtle)',
          }}
        >
          {Array.from({ length: lineCount }, (_, i) => `${i + 1}\n`).join('')}
        </div>
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <pre
            ref={preRef}
            aria-hidden
            style={{
              ...shared,
              position: 'absolute',
              inset: 0,
              overflow: 'hidden',
              color: 'var(--textPrimary)',
              pointerEvents: 'none',
            }}
          >
            {tokens.map((t, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: token stream is positional, re-rendered whole
              <span key={i} style={{ color: COLOR[t.type] }}>
                {t.text}
              </span>
            ))}
          </pre>
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              refreshAc(e.target.value, e.target.selectionStart)
            }}
            onKeyDown={onEditorKeyDown}
            onScroll={() => {
              syncScroll()
              setAc(null)
            }}
            onBlur={() => setAc(null)}
            spellCheck={false}
            style={{
              ...shared,
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              resize: 'none',
              background: 'transparent',
              color: 'transparent',
              caretColor: 'var(--textBright)',
              outline: 'none',
              overflow: 'auto',
            }}
          />
          {ac ? (
            <ul
              style={{
                position: 'absolute',
                left: ac.left,
                top: ac.top,
                margin: 0,
                padding: 4,
                listStyle: 'none',
                minWidth: 160,
                maxHeight: 220,
                overflowY: 'auto',
                background: 'var(--surfaceRaised)',
                border: '1px solid var(--borderStrong)',
                borderRadius: 6,
                boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
                zIndex: 2,
                font: FONT,
              }}
            >
              {ac.items.map((item, i) => (
                <li key={item}>
                  <button
                    type="button"
                    // Keep focus in the textarea (so the caret restores) — commit on mousedown, before blur.
                    onMouseDown={(e) => {
                      e.preventDefault()
                      acceptCompletion(item)
                    }}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '3px 8px',
                      border: 0,
                      borderRadius: 4,
                      cursor: 'pointer',
                      font: 'inherit',
                      background: i === ac.index ? 'var(--accentBlueDeep)' : 'transparent',
                      color: i === ac.index ? 'var(--white)' : 'var(--textPrimary)',
                    }}
                  >
                    {item}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      <footer
        style={{
          borderTop: '1px solid var(--borderSubtle)',
          padding: '8px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          maxHeight: 160,
        }}
      >
        <div style={{ overflowY: 'auto', fontSize: 12, lineHeight: 1.5 }}>
          {diag.block === null && diag.warnings.length === 0 ? (
            <span style={{ color: 'var(--textFaint)' }}>Write a module to synthesize it.</span>
          ) : ok ? (
            <span style={{ color: 'var(--statusOk)' }}>
              ✓ synthesizes to {diag.gateCount} real cells — every construct builds
            </span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {diag.block !== null && (
                <span style={{ color: 'var(--statusOk)' }}>
                  ✓ {diag.gateCount} cells built · {diag.warnings.length} not built:
                </span>
              )}
              {diag.warnings.map((w) => (
                <span key={w} style={{ color: 'var(--statusWarn)' }}>
                  • {w}
                </span>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            disabled={diag.block === null}
            onClick={() => {
              if (diag.block) onSynthesize(diag.block, diag.moduleName ?? 'module')
            }}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid var(--borderStrong)',
              background: diag.block ? 'var(--accentBlueDeep)' : 'var(--surfaceRaised)',
              color: diag.block ? 'var(--white)' : 'var(--textFaint)',
              cursor: diag.block ? 'pointer' : 'default',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Synthesize → canvas
          </button>
        </div>
      </footer>
    </div>
  )
}

/** A friendly starter so the editor isn't blank — highlights + synthesizes on open. */
export const STARTER_VERILOG = `module counter(input clk, input rst, output reg [3:0] count);
  // a 4-bit counter with synchronous reset — edit me, watch it synthesize live
  always @(posedge clk)
    if (rst) count <= 4'd0;
    else count <= count + 4'd1;
endmodule
`

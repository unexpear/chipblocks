/**
 * One hover tip for the whole app. It waits briefly on the first control, then
 * opens at once while you move across neighbours. Focus opens it immediately.
 * Escape, a click, or leaving the control closes it. The tip never takes the pointer.
 */

import {
  type CSSProperties,
  cloneElement,
  createContext,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'
import { resolveHelp } from './help-text.ts'
import { getHoverHelpMode, type HoverHelpMode, subscribeHoverHelp } from './hover-help-pref.ts'
import { createHoverSession, type HoverSession, type HoverTarget } from './hover-session.ts'
import { getKeybinds, subscribeKeybinds } from './keybind-store.ts'
import { THEME } from './theme.ts'

export const TOOLTIP_ID = 'cb-hover-help'

const GAP_PX = 8
const MARGIN_PX = 8

export function placeTooltip(
  anchor: { left: number; top: number; width: number; height: number },
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const tw = tip.width
  const th = tip.height
  const candidates = [
    {
      left: anchor.left + anchor.width / 2 - tw / 2,
      top: anchor.top + anchor.height + GAP_PX,
    },
    {
      left: anchor.left + anchor.width / 2 - tw / 2,
      top: anchor.top - th - GAP_PX,
    },
    {
      left: anchor.left + anchor.width + GAP_PX,
      top: anchor.top + anchor.height / 2 - th / 2,
    },
    {
      left: anchor.left - tw - GAP_PX,
      top: anchor.top + anchor.height / 2 - th / 2,
    },
  ]
  const fits = (box: { left: number; top: number }) =>
    box.left >= MARGIN_PX &&
    box.top >= MARGIN_PX &&
    box.left + tw <= viewport.width - MARGIN_PX &&
    box.top + th <= viewport.height - MARGIN_PX
  const chosen = candidates.find(fits) ?? candidates[0] ?? { left: MARGIN_PX, top: MARGIN_PX }
  const maxLeft = Math.max(MARGIN_PX, viewport.width - MARGIN_PX - tw)
  const maxTop = Math.max(MARGIN_PX, viewport.height - MARGIN_PX - th)
  return {
    left: Math.min(Math.max(chosen.left, MARGIN_PX), maxLeft),
    top: Math.min(Math.max(chosen.top, MARGIN_PX), maxTop),
  }
}

type HoverApi = {
  session: HoverSession
  mode: HoverHelpMode
  revision: number
}

const HoverContext = createContext<HoverApi | null>(null)

export function HoverHelpProvider({ children }: { children: ReactNode }) {
  const [revision, setRevision] = useState(0)
  const sessionRef = useRef<HoverSession | null>(null)
  if (sessionRef.current === null) {
    sessionRef.current = createHoverSession({
      now: () => Date.now(),
      schedule: (ms, fn) => {
        const id = window.setTimeout(fn, ms)
        return () => window.clearTimeout(id)
      },
      onChange: () => setRevision((n) => n + 1),
    })
  }
  const mode = useSyncExternalStore(subscribeHoverHelp, getHoverHelpMode, getHoverHelpMode)
  const session = sessionRef.current
  useEffect(() => {
    session.setEnabled(mode !== 'off')
  }, [session, mode])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') session.escape()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [session])
  const api = useMemo<HoverApi>(() => ({ session, mode, revision }), [session, mode, revision])
  return (
    <HoverContext.Provider value={api}>
      {children}
      <TooltipLayer session={session} mode={mode} />
    </HoverContext.Provider>
  )
}

function TooltipLayer({ session, mode }: { session: HoverSession; mode: HoverHelpMode }) {
  const shown = session.shown
  const tipRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ left: number; top: number }>({ left: MARGIN_PX, top: MARGIN_PX })
  const binds = useSyncExternalStore(subscribeKeybinds, getKeybinds, getKeybinds)
  const entry = shown === null ? undefined : resolveHelp(shown.helpId, shown.name)
  const detail = shown?.detail ?? entry?.detail
  const shortcut = entry?.shortcut !== undefined ? binds[entry.shortcut] : entry?.shortcutText
  // The sentence and the shortcut change how tall the tip is, so they are dependencies even
  // though the body only reads the measured box.
  // biome-ignore lint/correctness/useExhaustiveDependencies: detail and shortcut change the tip's size
  useLayoutEffect(() => {
    const anchor = shown?.anchor
    const tip = tipRef.current
    if (anchor === undefined || anchor === null || tip === null) return
    const anchorBox = anchor.getBoundingClientRect()
    const tipBox = tip.getBoundingClientRect()
    setBox(
      placeTooltip(anchorBox, tipBox, {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    )
  }, [shown, mode, detail, shortcut])
  if (shown === null || entry === undefined || mode === 'off' || typeof document === 'undefined') {
    return null
  }
  const full = mode === 'full'
  return createPortal(
    <div
      ref={tipRef}
      id={TOOLTIP_ID}
      role="tooltip"
      data-testid="tooltip"
      style={{
        position: 'fixed',
        left: box.left,
        top: box.top,
        zIndex: 5000,
        pointerEvents: 'none',
        maxWidth: 280,
        padding: '6px 8px',
        borderRadius: 6,
        background: THEME.surfaceRaised,
        color: THEME.textPrimary,
        border: `1px solid ${THEME.borderStrong}`,
        boxShadow: '0 8px 22px rgba(0,0,0,0.35)',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        lineHeight: 1.35,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span data-testid="tooltip-name" style={{ fontWeight: 700 }}>
          {entry.name}
        </span>
        {shortcut !== undefined && shortcut.length > 0 ? (
          <span
            data-testid="tooltip-shortcut"
            style={{
              marginLeft: 'auto',
              fontFamily: 'ui-monospace, monospace',
              fontSize: 11,
              color: THEME.accentBlue,
              whiteSpace: 'nowrap',
            }}
          >
            {shortcut}
          </span>
        ) : null}
      </div>
      {full ? (
        <div data-testid="tooltip-summary" style={{ marginTop: 2, color: THEME.textSoft }}>
          {entry.summary}
        </div>
      ) : null}
      {full && detail !== undefined && detail.length > 0 ? (
        <div data-testid="tooltip-detail" style={{ marginTop: 2, color: THEME.textMuted }}>
          {detail}
        </div>
      ) : null}
    </div>,
    document.body,
  )
}

type TipChildProps = {
  disabled?: boolean
  style?: CSSProperties
  title?: string
  'aria-describedby'?: string
  onPointerEnter?: (event: PointerEvent<HTMLElement>) => void
  onPointerLeave?: (event: PointerEvent<HTMLElement>) => void
  onMouseEnter?: (event: MouseEvent<HTMLElement>) => void
  onMouseLeave?: (event: MouseEvent<HTMLElement>) => void
  onFocus?: (event: FocusEvent<HTMLElement>) => void
  onBlur?: (event: FocusEvent<HTMLElement>) => void
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void
  ref?: Ref<HTMLElement>
}

function joinDescribed(existing: string | undefined, extra: string): string {
  if (existing === undefined || existing.length === 0) return extra
  return `${existing} ${extra}`
}

function mergeRef(ours: (node: HTMLElement | null) => void, theirs: Ref<HTMLElement> | undefined) {
  return (node: HTMLElement | null) => {
    ours(node)
    if (typeof theirs === 'function') theirs(node)
    else if (theirs !== undefined && theirs !== null) theirs.current = node
  }
}

/**
 * Wrap one control. Pass `detail` for a live second line — a disabled button’s
 * reason lives there, and the wrapper still receives the hover when the button
 * itself will not.
 */
export function HelpTip({
  helpId,
  name,
  detail,
  children,
}: {
  helpId: string
  name?: string | undefined
  detail?: string | undefined
  children?: ReactElement
}) {
  const api = useContext(HoverContext)
  const key = useId()
  const anchorRef = useRef<HTMLElement | null>(null)
  const entry = resolveHelp(helpId, name)
  const props = (children?.props ?? {}) as TipChildProps
  const session = api?.session
  // The provider hands out a new context value whenever a tip opens or closes. This
  // cleanup must follow the session, not that value, or the open would immediately leave.
  useEffect(() => {
    if (session === undefined) return
    return () => session.leave(key)
  }, [session, key])
  if (children === undefined) return null
  if (api === null || entry === undefined || api.mode === 'off') return children

  const target = (): HoverTarget | null => {
    const anchor = anchorRef.current
    if (anchor === null) return null
    const next: HoverTarget = { key, helpId, anchor }
    if (name !== undefined) next.name = name
    if (detail !== undefined) next.detail = detail
    return next
  }
  const enter = () => {
    const next = target()
    if (next !== null) api.session.enter(next)
  }
  const focus = () => {
    const next = target()
    if (next !== null) api.session.focus(next)
  }
  const disabled = props.disabled === true
  const shown = api.session.shown?.key === key
  const described = shown ? joinDescribed(props['aria-describedby'], TOOLTIP_ID) : undefined
  const patchedStyle: CSSProperties | undefined = disabled
    ? { ...props.style, pointerEvents: 'none' }
    : props.style
  const child = cloneElement(children as ReactElement<TipChildProps>, {
    ref: mergeRef((node) => {
      if (!disabled) anchorRef.current = node
    }, props.ref),
    ...(described !== undefined ? { 'aria-describedby': described } : {}),
    ...(patchedStyle !== undefined ? { style: patchedStyle } : {}),
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      props.onPointerEnter?.(event)
      enter()
    },
    onPointerLeave: (event: PointerEvent<HTMLElement>) => {
      props.onPointerLeave?.(event)
      api.session.leave(key)
    },
    onMouseEnter: (event: MouseEvent<HTMLElement>) => {
      props.onMouseEnter?.(event)
      enter()
    },
    onMouseLeave: (event: MouseEvent<HTMLElement>) => {
      props.onMouseLeave?.(event)
      api.session.leave(key)
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      props.onFocus?.(event)
      focus()
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      props.onBlur?.(event)
      api.session.blur(key)
    },
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      props.onPointerDown?.(event)
      api.session.dismiss(key)
    },
  })
  if (!disabled) return child
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a disabled button does not receive hover; this wrapper does, and it never takes the click
    <span
      ref={anchorRef}
      data-help-id={helpId}
      style={{ display: 'inline-flex', maxWidth: '100%', pointerEvents: 'auto' }}
      onPointerEnter={enter}
      onPointerLeave={() => api.session.leave(key)}
      onMouseEnter={enter}
      onMouseLeave={() => api.session.leave(key)}
      onPointerDown={() => api.session.dismiss(key)}
    >
      {child}
    </span>
  )
}

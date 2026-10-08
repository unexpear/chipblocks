/**
 * When a hover tip appears. The first one waits a short beat. Once a tip has been
 * shown, moving onto the next control opens its tip immediately, and that "warm"
 * window stays open briefly after the pointer leaves so a hop between neighbours
 * does not pay the delay again. Focus opens at once. Escape, a click, and leaving
 * the control all close it.
 */

export const HOVER_SHOW_DELAY_MS = 450
export const HOVER_WARM_MS = 450

export type HoverTarget = {
  key: string
  helpId: string
  anchor: HTMLElement
  name?: string
  detail?: string
}

export type HoverSession = {
  enter: (target: HoverTarget) => void
  leave: (key: string) => void
  focus: (target: HoverTarget) => void
  blur: (key: string) => void
  dismiss: (key: string) => void
  escape: () => void
  setEnabled: (on: boolean) => void
  readonly shown: HoverTarget | null
  readonly pendingKey: string | null
}

export function createHoverSession(opts: {
  now: () => number
  schedule: (ms: number, fn: () => void) => () => void
  onChange: () => void
}): HoverSession {
  let shown: HoverTarget | null = null
  let pendingKey: string | null = null
  let cancelTimer: (() => void) | null = null
  let warmUntil = 0
  let suppressedKey: string | null = null
  let focusedKey: string | null = null
  let enabled = true

  const clearTimer = () => {
    cancelTimer?.()
    cancelTimer = null
    pendingKey = null
  }

  const showNow = (target: HoverTarget) => {
    clearTimer()
    shown = target
    opts.onChange()
  }

  const arm = (target: HoverTarget, immediate: boolean) => {
    if (!enabled) return
    if (suppressedKey === target.key) return
    if (shown?.key === target.key) {
      shown = target
      opts.onChange()
      return
    }
    if (pendingKey === target.key && !immediate) return
    const warm = shown !== null || opts.now() < warmUntil
    clearTimer()
    if (immediate || warm) {
      showNow(target)
      return
    }
    pendingKey = target.key
    cancelTimer = opts.schedule(HOVER_SHOW_DELAY_MS, () => {
      pendingKey = null
      cancelTimer = null
      shown = target
      opts.onChange()
    })
    opts.onChange()
  }

  return {
    enter: (target) => arm(target, false),
    leave: (key) => {
      if (suppressedKey === key) suppressedKey = null
      if (pendingKey === key) {
        clearTimer()
        opts.onChange()
      }
      if (shown?.key === key && focusedKey !== key) {
        shown = null
        warmUntil = opts.now() + HOVER_WARM_MS
        opts.onChange()
      }
    },
    focus: (target) => {
      focusedKey = target.key
      arm(target, true)
    },
    blur: (key) => {
      if (focusedKey === key) focusedKey = null
      if (suppressedKey === key) suppressedKey = null
      if (shown?.key === key) {
        shown = null
        warmUntil = opts.now() + HOVER_WARM_MS
        opts.onChange()
      }
    },
    dismiss: (key) => {
      if (pendingKey !== key && shown?.key !== key) return
      suppressedKey = key
      clearTimer()
      if (shown?.key === key) {
        shown = null
        warmUntil = opts.now() + HOVER_WARM_MS
      }
      opts.onChange()
    },
    escape: () => {
      const key = shown?.key ?? pendingKey
      if (key === null && shown === null) return
      clearTimer()
      if (key !== null) suppressedKey = key
      shown = null
      warmUntil = 0
      opts.onChange()
    },
    setEnabled: (on) => {
      enabled = on
      if (on) return
      clearTimer()
      shown = null
      opts.onChange()
    },
    get shown() {
      return shown
    },
    get pendingKey() {
      return pendingKey
    },
  }
}

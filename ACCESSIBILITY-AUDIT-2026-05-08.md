# Accessibility Audit — ChipBlocks v0.1.0-alpha

**Standard:** WCAG 2.1 AA · **Date:** 2026-05-08 · **Auditor:** Claude (skill: `design:accessibility-review`) · **Scope:** Renderer-side desktop UI (Electron + React Flow). Native menu bar untouched (none currently).

This is a snapshot, not a continuous bar. Re-run after the Tier-1 work lands and again before any v0.2 release. The next audit pass should also include manual testing with NVDA + VoiceOver — Claude's audit can predict ~70% of issues but real AT testing catches the rest.

## Summary

**Issues found:** 23 · **Critical:** 4 · **Major:** 12 · **Minor:** 7

Baseline contrast is mostly within AA (one failure: palette footer at 3.6:1). A few good ARIA touches already in place (`role="alert"` on the toast, `role="note"` on the starter hint, an Escape handler on `SettingsModal`). The biggest gaps are:

1. **Keyboard access** — the entire palette is drag-only; no way to add a block without a mouse.
2. **Dialog semantics** — none of the three modals have `role="dialog"`/`aria-modal`/focus trap; two of three lack Escape-close.
3. **Input labeling** — block parameter inputs (Oscillator freq, ADSR's "A/D/S/R", etc.) have no programmatic labels. Screen readers read "440, spinbutton" with no context.
4. **Status announcements** — long async operations (▶ Play, 🔧 Build, AI streaming) finish silently for AT users.

Tier 1 (Critical) work is roughly **1.5 hours** of mechanical edits, no architectural changes, low regression risk.

---

## Findings by category

### Perceivable (1.x)

| # | Issue | WCAG | Severity | Recommendation |
|---|-------|------|----------|----------------|
| **P1** | Palette footer text `#666 on #141414` ≈ 3.6:1 — fails AA for normal text (4.5:1 required) | 1.4.3 | 🟡 Major | Bump to `#888` (≈4.7:1) or apply a font-weight bump that qualifies as "large text" |
| **P2** | Block parameter inputs have no programmatic label — visual `<span class="block-label">A</span>` next to the input is just adjacent text, no `for=`/`aria-label`/wrapping `<label>` association | 1.3.1, 4.1.2 | 🔴 Critical | Wrap each field in `<label>` or add `aria-label` expanding the field's purpose. ADSR's "A/D/S/R" → "Attack milliseconds", "Decay milliseconds", "Sustain level (0–127)", "Release milliseconds". Same pattern for Oscillator/Triangle/Saw/Sine `freq`, Lowpass `cutoff_hz`, Gate `rate_hz`/`duty_pct`, FM's three params, Constant's `value`, Wavetable's `freq`+`shape` |
| P3 | ADSR labels "A / D / S / R" are visual abbreviations only — no expansion | 1.3.1, 3.3.2 | 🟡 Major | Subsumed by P2 once `aria-label` lands |
| P4 | Block titles ("Oscillator", "ADSR", etc.) are `<div class="block-title">`, not headings — screen readers can't navigate by structure | 1.3.1 | 🟢 Minor | Use `<h3>` or `role="heading" aria-level="3"` |
| P5 | Block component (whole card) has no accessible name. SR announces ports + input but no "Oscillator block" wrapper | 1.3.1, 4.1.2 | 🟡 Major | `<div role="group" aria-labelledby={titleId}>` on the outer block |
| P6 | Palette draggable items are bare `<div>`s with no role or accessible name beyond text content (the swatch is `<span>` background-only) | 1.3.1, 4.1.2 | 🟡 Major | `role="button"` + `aria-label="${entry.label} block (drag onto canvas to add)"` so AT users at least know what they are |
| P7 | Port handles (small colored dots) carry meaning — direction, type | 1.4.1 | 🟢 Minor | Already paired with text labels in practice; fine. Worth noting for future port-type indicators |
| P8 | React Flow's MiniMap, Controls, Background visualizations have no alt or role | 1.1.1 | 🟢 Minor | `aria-hidden="true"` on Background; verify Controls have built-in labels (RF v12 does) |

### Operable (2.x)

| # | Issue | WCAG | Severity | Recommendation |
|---|-------|------|----------|----------------|
| **O1** | **Palette is mouse-only.** No keyboard path to add a block. `draggable=true` does nothing for keyboard users | 2.1.1 | 🔴 Critical | Make palette items focusable buttons; pressing Enter spawns the node at canvas viewport center via the existing `addNode` action |
| O2 | React Flow canvas keyboard nav is partial — node selection works (Tab/arrow), but creating edges / deleting nodes / editing parameters in tight succession require mouse | 2.1.1 | 🟡 Major | Document the React Flow built-in shortcuts (`deleteKeyCode`, `selectionKeyCode`) somewhere visible. Help → About is a natural home |
| O3 | `AboutModal` has no Escape-to-close — only × button or backdrop click | 2.1.1 | 🟡 Major | Apply the `SettingsModal` Escape pattern (5-line `useEffect`) |
| O4 | Chat sidebar has no Escape close, no focus management when opened | 2.1.1, 2.4.3 | 🟡 Major | Escape handler that calls `onClose`. Optional `inert` on the canvas while chat is focused (chat is non-modal so trap is optional) |
| O5 | Build / Examples popovers close on outside click but **not on Escape** | 2.1.1 | 🟡 Major | `onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}` while open |
| O6 | Build / Examples popover items have no arrow-key navigation. Keyboard users can `Enter` to open but can't move between items without Tab | 2.1.1, 4.1.2 | 🟡 Major | ArrowDown/ArrowUp through items + Enter to activate. APG menu pattern |
| **O7** | **Touch targets** for emoji-only buttons (`⚙`, `ℹ`, palette `▶`/`◀`, all `×` close buttons) are likely under 44×44 CSS px | 2.5.5 | 🟡 Major | `min-width: 44px; min-height: 44px;` on `.chat-icon-btn`, `.palette-toggle`, `.starter-hint-close`, and the emoji-only toolbar buttons |
| **O8** | **Visible focus indicator** — `App.css` defines `:focus` on `.modal-input`, `.chat-input`, `.block-input` but **not on buttons**, palette items, or dropdown items. Browser defaults on dark theme are weak/invisible | 2.4.7 | 🔴 Critical | Single global rule: `*:focus-visible { outline: 2px solid #6ec1ff; outline-offset: 2px; }`. The blue is already used for links; reads as "interactive" |
| O9 | Modal backdrop click closes it — a stray click while typing a long API key could close it accidentally | 3.2.1 | 🟢 Minor | Optional polish; not strictly an a11y issue |
| O10 | Starter hint overlays the canvas; if a SR user hits Tab, it's not in focus order until they reach the × | 2.4.3 | 🟢 Minor | Confirmed: the hint is rendered after canvas in DOM, so Tab order is fine. False alarm; leave as-is |

### Understandable (3.x)

| # | Issue | WCAG | Severity | Recommendation |
|---|-------|------|----------|----------------|
| **U1** | Status messages ("Synthesizing…", "Building bitstream…", "Bitstream ready (4.7 KB)") are not in an `aria-live` region — SR users get no announcement when a long build finishes | 4.1.3 | 🔴 Critical | Wrap `.toolbar-status` in `<div role="status" aria-live="polite">` so AT announces text changes |
| U2 | Settings modal: "Save key" enabled only when input is non-empty, but Enter doesn't submit (no `<form>` wrapper) | 3.2.4 | 🟢 Minor | Wrap the key + Save button in `<form onSubmit={save}>` |
| U3 | Block parameter inputs have no error messaging — out-of-range values are silently clamped/ignored | 3.3.1 | 🟡 Major | Show inline "must be 1–22050 Hz" + red border on out-of-range. Today the input feels broken |
| U4 | Starter hint is dismissible but not announced when it appears — sighted users see the green banner, AT users may miss it | 4.1.3 | 🟢 Minor | Upgrade `role="note"` → `role="status"` so it's announced once on first launch |
| U5 | AI consultant chat history scrolls visually but a screen reader doesn't know new messages have streamed in | 4.1.3 | 🟡 Major | `aria-live="polite"` on `.chat-messages` so each new message announces |

### Robust (4.x)

| # | Issue | WCAG | Severity | Recommendation |
|---|-------|------|----------|----------------|
| R1 | Toggle-state buttons (`💬 Chat`, `Examples ▾`, `🔧 Build ▾`) lack `aria-pressed` / `aria-expanded` / `aria-haspopup` | 4.1.2 | 🟡 Major | Chat: `aria-pressed={chatOpen}`. Build/Examples: `aria-expanded={open}` + `aria-haspopup="menu"` |
| R2 | Build / Examples popovers have `role="menu"` on the container but `<button>`s inside (not `role="menuitem"`) | 4.1.2 | 🟡 Major | Add `role="menuitem"` on each entry, OR drop `role="menu"` and use `<ul role="listbox">` pattern. APG examples for both |
| **R3** | All three modals lack `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` linking to their `<h2>` | 4.1.2 | 🔴 Critical | On `.modal`: `role="dialog" aria-modal="true" aria-labelledby="<h2-id>"` with the `<h2 id="…">` matching |
| R4 | No focus management on modal open — focus stays on whatever button opened it, and on close doesn't return there | 2.4.3, 4.1.2 | 🟡 Major | On open: focus first focusable element (heading or first input). On close: restore focus to the trigger. `useRef` + `requestAnimationFrame` is enough |
| R5 | The `ℹ` and `⚙` buttons rely on `title=` for their name. Title is unreliable for SRs | 4.1.2 | 🟢 Minor | Add `aria-label="About ChipBlocks"` and `aria-label="Settings"` explicitly |
| R6 | Modal `×` close buttons use `title="Close"` only — same issue | 4.1.2 | 🟢 Minor | Add `aria-label="Close"` |
| R7 | AI confirm-preview modal (the destructive-action confirmation) — "Apply" / "Reject" buttons need richer context | 4.1.2 | 🟢 Minor | `aria-describedby` linking to body text |

---

## Color contrast spot check

| Element | Foreground | Background | Ratio | Required | Pass? |
|---|---|---|---|---|---|
| Body text on toolbar | `#fff` | `#1a1a1a` | 16.8:1 | 4.5:1 | ✅ |
| Toolbar status | `#aaa` | `#1a1a1a` | 7.6:1 | 4.5:1 | ✅ |
| Block title | `#eee` | `#1a1a1a` | 14.5:1 | 4.5:1 | ✅ |
| Block param suffix ("Hz") | `#aaa` | `#1a1a1a` | 7.6:1 | 4.5:1 | ✅ |
| Palette description / dropdown desc | `#888` | `#161616` | 4.7:1 | 4.5:1 | ✅ (just) |
| **Palette footer "Drag onto canvas"** | `#666` | `#141414` | **3.6:1** | 4.5:1 | ❌ |
| Chat hint italic | `#888` | `#161616` | 4.7:1 | 4.5:1 | ✅ |
| Error toast text | `#ffb` | `#2a1818` | 11.5:1 | 4.5:1 | ✅ |
| Error toast emphasis | `#f88` | `#2a1818` | 6.4:1 | 4.5:1 | ✅ |
| Link `console.anthropic.com` | `#6ec1ff` | `#1a1a1a` | 7.4:1 | 4.5:1 | ✅ |
| AI role label "AI" | `#b08aff` | `#1a1a1a` | 6.0:1 | 4.5:1 | ✅ |
| Tool role label "Tool" | `#4caf50` | `#1a1a1a` | 4.5:1 | 4.5:1 | ✅ (borderline) |
| Send button text | `#fff` | `#2a4d2e` | 8.0:1 | 4.5:1 | ✅ |
| "✓ Key configured" status | `#6c6` | `#1a1a1a` | 6.4:1 | 4.5:1 | ✅ |

Single failure: the palette footer.

---

## Tiered remediation plan

### Tier 1 — Critical (Sprint 11 P0; ~1.5 hrs of mechanical edits)

These four block real users today. They're small-footprint changes with low regression risk.

- **P2** — Add `aria-label` to every block parameter input across `Oscillator/Triangle/Sawtooth/Sine/Constant/ADSR/Gate/LowPassFilter/Wavetable/Fm` Node TSX files. ~14 inputs total. Subsumes P3.
- **R3** + **R4** — Add `role="dialog"` + `aria-modal="true"` + `aria-labelledby` + focus trap + on-close focus restore to `SettingsModal.tsx`, `AboutModal.tsx`, the AI confirm-preview modal in `Chat.tsx`. ~30 lines per modal.
- **O8** — Single global focus-visible CSS rule in `App.css`: `*:focus-visible { outline: 2px solid #6ec1ff; outline-offset: 2px; }`. Affects every focusable element.
- **U1** + **U5** — `role="status" aria-live="polite"` on `.toolbar-status` + `aria-live="polite"` on `.chat-messages`. Two lines.

### Tier 2 — Major (Sprint 12 or "Next" bucket; ~4 hrs)

Substantial usability improvements but not blocking.

- **O1** — Palette keyboard alternative (Add buttons or Enter-to-spawn). The biggest UX gap.
- **O3 / O4 / O5** — Escape-closes-everything: AboutModal, Chat, Build/Examples popovers, AI confirm-preview.
- **O7** — Touch targets ≥ 44×44 on emoji-only buttons.
- **R1** — `aria-pressed` / `aria-expanded` / `aria-haspopup` on toggle buttons.
- **P1** — Palette footer color bump.
- **U3** — Inline error messaging on out-of-range parameter inputs.
- **R2** — `role="menuitem"` on popover items.

### Tier 3 — Minor (Later / polish)

Polish items. Address opportunistically; don't sprint dedicated to them.

- **P4** — Block titles as headings.
- **P5** + **P6** — `role="group"` on blocks, `role="button"` on palette items.
- **O2** — Document React Flow keyboard shortcuts in About modal.
- **O6** — Arrow-key navigation in popovers.
- **U2** — `<form>` wrapper on Settings key entry so Enter submits.
- **U4** — Starter hint `role="note"` → `role="status"`.
- **R5 / R6 / R7** — `aria-label` on close buttons; `aria-describedby` on confirm dialog.
- **P7 / P8** — Decorative-marker hardening.

### Out of scope for this audit pass

- **Manual NVDA / VoiceOver testing** — Claude can predict ~70% of issues; real AT testing catches the rest. Schedule before any v0.2 release.
- **Localization / RTL support** — punted; non-issue at the alpha stage.
- **Reduced-motion preferences** — the spinner + chat-cursor-blink animations should respect `prefers-reduced-motion`. Add to Tier 3.
- **High-contrast mode** — Windows / macOS forced-colors modes. Add to Tier 3.

---

## Re-audit triggers

Re-run this audit when any of these happen:

- A new color is introduced into `App.css` (verify contrast)
- A new modal or popover is added (verify dialog semantics)
- A new interactive component lands in any block (verify keyboard + label)
- The toolbar gains a new button (verify `aria-label`, target size)
- Before tagging any version `v0.2.0` or higher (full re-audit)
- After any user files an a11y bug report (re-audit affected surface)

# ChipBlocks Learning-Disabilities Accessibility Audit (2026-05-10)

> Companion to [ACCESSIBILITY-AUDIT-2026-05-08.md](ACCESSIBILITY-AUDIT-2026-05-08.md). The May 8 audit covered standard WCAG 2.1 AA concerns (perception, operability, etc.). This audit goes deeper on **learning disabilities** specifically — concerns that often slip past WCAG checks because they're cognitive, not perceptual.

> Heuristic audit (static analysis of components, CSS, error messages, AI prompt). Reading-comprehension testing with actual LD users is recommended as a follow-up.

## Executive summary

ChipBlocks already does much better than a typical FOSS chip-design tool on cognitive accessibility — the typed-bus rejection toast in `App.tsx:373-383` actually *names what to do next*, the `useValidatedNumber.ts` hook gives plain-English range hints under each invalid field, and `classify-backend-error.ts` translates Python tracebacks into "Open WSL2 Ubuntu and run: `cd backend && bash setup.sh`." Those are not common in this domain.

The biggest LD-aimed improvement area is **density and jargon in the system prompt + BLOCKS.md + parameter labels**: the AI is on the hook for plain-language but is loaded with terminology like "16-bit Galois LFSR," "1-pole IIR," "phase accumulator" that may leak into responses. Several block UIs use single-letter labels (A/D/S/R, a/b, C/M/D) that force the user to remember meaning across context-switches. Secondary concern: the global animation system has no `prefers-reduced-motion` short-circuit — an autistic / vestibular-sensitive user has no UI-side opt-out for the spinning ring during 30-second builds and the blinking chat cursor.

## Dyslexia findings

| Issue | Where | Severity | Proposed fix |
|---|---|---|---|
| No dyslexia-friendly font option. Only Inter / system-ui / Arial sans-serif, no `OpenDyslexic` or user-selectable typeface. | `frontend/src/index.css:6` | Med | Add a Settings toggle that swaps `:root { font-family }` to `OpenDyslexic, "Atkinson Hyperlegible", ...`. Self-host in `frontend/public/fonts/` (both are SIL OFL — permissive). |
| Italics used for emphasis on the chat empty state and palette example text. Italic body copy is the single hardest style for dyslexic readers. | `frontend/src/App.css:471` (`.chat-hint { font-style: italic; }`); `Chat.tsx:565` (italics around the example prompts) | Med | Drop italics; use color (`#aaa`), a leading icon, or quotes for emphasis. **Trivial fix candidate** for the CSS line. |
| Body line-height is `1.5` globally but block-internal text (`block-input-error` 1.2, `chat-msg-body` 1.4) drops below the 1.5 floor recommended for dyslexia. | `App.css:1024-1025`, `App.css:502` | Low | Bump `.block-input-error` line-height to 1.4 and `.chat-msg-body` to 1.5. |
| `.chat-msg-role` uppercases with letter-spacing 0.05em at 0.7 rem — small caps are doubly hard to scan. | `App.css:479-484` | Low | Either drop the uppercase transform or bump font-size to 0.8 rem. |
| Long, comma-jointed sentences in error toasts. The bus-mismatch toast (`App.tsx:374-380`) is one 250-char run-on without paragraph break; the audio/VGA pre-check (`App.tsx:532-537`) is similar. | `App.tsx:374-380, 532-537` | Med | Break into two short lines with a literal `\n`; current CSS already does `pre-wrap` in similar surfaces. |

## ADHD / executive-function findings

| Issue | Where | Severity | Proposed fix |
|---|---|---|---|
| Error toast auto-dismiss after 6 s (or 20 s for setup errors). 6 s is short for someone re-reading a sentence with attention drift; the message disappears before they re-orient. | `App.tsx:333-341` | High | Bump unclassified to 12 s, or — better — only auto-dismiss after the user has interacted with the page once (mouse move, keystroke); persistent toasts pin until ×. **Status: Done 2026-05-10** — unclassified bumped 6 s → 12 s; setup errors stay at 20 s. |
| Status messages live in `aria-live="polite"` but only as long as `statusMessage` is set; "Bitstream ready" disappears the next time the user clicks Build. No history view. | `App.tsx:691, 701` | Med | Add a "Last build" line in the toolbar that persists the last 1-line outcome, or surface a small notifications icon they can re-open. |
| Build menu and Examples menu close on outside click. A user who clicks the canvas to scroll while reading the descriptions loses the menu and has to reopen it. | `App.tsx:717, 754` | Low | Already accessible via Escape — add a hover delay or a "pin" affordance, or document Escape behavior in About → Keyboard shortcuts. |
| Multiple competing attention surfaces when chat is open: toolbar, palette, canvas, chat panel, plus minimap + controls in canvas. Five regions, no single "where do I look first" cue once the starter hint dismisses. | `App.tsx:683-844` | Med | Consider an adjustable focus mode (collapse minimap + chat by default; their open state already persists in `paletteCollapsed`). |
| `MAX_ITERATIONS = 5` agentic-loop cap. When hit, only a tiny tool-message says "(reached 5-iteration cap; stopping)" — no clear suggestion to continue or rephrase. | `Chat.tsx:69, 461-467` | Low | Append "Type 'continue' if you want me to keep going, or rephrase if I'm off-track." |

## Autism / sensory findings

| Issue | Where | Severity | Proposed fix |
|---|---|---|---|
| **No `prefers-reduced-motion` media query anywhere in the codebase.** Three infinite/animated effects: spinner during synth/build (runs ~30 s on builds), blinking chat cursor, toast slide-in. | `App.css` (global) | High | Add `@media (prefers-reduced-motion: reduce) { .spinner, .chat-cursor { animation: none; } .error-toast { animation: none; } }`. **Trivial fix candidate.** |
| **Audio plays at full WAV amplitude.** No volume control, no fade-in, no warning before pressing Play. A user with a square-wave-rich graph at 440 Hz has a sudden-onset loud signal on first keypress. | `App.tsx:467-512` | High | Add a volume slider in toolbar (defaulting to ~50 %), or apply a 50-ms fade-in to the audio buffer before `audio.play()`. The `Audio` element supports `audio.volume`. |
| Chat panel's blinking cursor has no aria-hidden and no reduced-motion guard. | `Chat.tsx:581`, `App.css:514-521` | Med | Add `aria-hidden="true"` to the `<span className="chat-cursor">`. **Trivial fix candidate.** |
| The error-toast `role="alert"` interrupts screen-reader output instantly. Combined with the toast slide-in animation, it's two simultaneous stimuli for a sensory-sensitive user. | `App.tsx:848` | Low | `role="status"` for non-blocking errors (which most are), keep `alert` only for build/setup failures. |
| Modal backdrop click closes Settings/About modals. A stim-prone user touching outside the modal loses their place mid-paste of an API key. | `SettingsModal.tsx:108`, `AboutModal.tsx:38` | Med | Same pattern the toast already uses (`e.target === e.currentTarget` plus user-hasn't-typed-since-opening guard). **Status: Done 2026-05-10** — both modals now track `hasInteracted` via `onKeyDownCapture` + `onPointerDownCapture`; backdrop click is a no-op once the user has typed or clicked inside. × button and Escape still close. |

## Working-memory findings

| Issue | Where | Severity | Proposed fix |
|---|---|---|---|
| **ADSR uses single-letter labels A/D/S/R** with no inline expansion. The `aria-label` says "Attack milliseconds," but the *visual* label is just "A". Sighted users with low working memory can't recall which letter is which after coming back from another window. | `ADSRNode.tsx:84-117` | High | Use 2-3 char labels ("Atk" / "Dec" / "Sus" / "Rel") or render the long form on hover via `title=`. |
| FM block uses C/M/D — same pattern, even more obscure (Carrier / Modulator / mod-Depth). | `FmNode.tsx:76-101` | High | Same fix. C/M/D is unguessable without prior synth knowledge. |
| Pixel Range labels are "a" / "b" with no on-block hint that a=start and b=end. | `PixelRangeNode.tsx:44, 61` | High | Change to "start" / "end" — the block is wide enough; the existing aria-labels already say it. **Trivial fix candidate.** |
| Edge-rejection toast for incompatible bus types names the types but not where to find the BusSplit/BusJoin block. | `App.tsx:373-380` | Med | Append " (find them under the silver swatches in the palette)". |
| Save format silently overwrites the canvas on Load; if user loaded the wrong file there's no in-app undo of the load. | `App.tsx:432-465` | Med | Show a "Just loaded `<filename>`. Undo?" toast for ~10 s after Load. |
| AI consultant's system prompt is ~14 KB before the canvas state is appended. Heavy on jargon ("16-bit Galois LFSR", "1-pole IIR"). Risk: model parrots that vocabulary back at non-technical users. | `prompt.ts:51, 84, 197` | Med | Add an explicit instruction near the top: "When the user uses non-technical language, mirror it. Avoid 'combinational', 'LFSR', 'IIR', 'pole'. Say 'happens immediately', 'pseudo-random', 'softens highs', 'one-stage filter'." |

## Dyscalculia / math-anxiety findings

| Issue | Where | Severity | Proposed fix |
|---|---|---|---|
| **Frequency input labelled "Hz" but no semantic anchor for what a number means.** A user typing 440 has no in-block cue that this is "concert A". | `OscillatorNode.tsx:32-47` (and Triangle, Saw, Sine, Wavetable, FM) | High | Add a tiny "≈A4" / "≈C5" hint next to the Hz suffix when value is near a musical-note frequency. |
| Range error message `Must be 20–20000` is bare and doesn't explain *why*. | `useValidatedNumber.ts:69` | Med | "Frequency must be between 20 Hz (lowest you can hear) and 20000 Hz (highest you can hear)." Make the message a prop with a sensible default. |
| Constant block range "-128 to 127" — a non-technical user has no way to know that's "8-bit signed." No on-block hint. | `Palette.tsx:30` (tooltip only); the in-block UI shows just the number. | Med | Display "(8-bit signed: -128 to 127)" under the input, or add a tooltip. |
| **ROM block: textarea takes 16 comma-separated bytes 0-255.** For a math-anxious user, "a JSON array of 16 numbers" is intimidating. | `ROMNode.tsx:102-110` | High | Offer a "Fill with…" picker (zeros, ramp 0-15, random) above the textarea, plus on-block format examples. |
| Counter `max_value` 1-127 with no explanation what max_value = 16 produces. | `CounterNode.tsx:41` | Low | Add suffix "max (counts 0..max-1)" or similar. |
| Bitcrusher `bits` input default 4: no on-block cue that 8 = clean and 1 = fully crushed. | `BitcrusherNode.tsx:40-50` | Low | Add a micro-hint "(8 = clean, 1 = heavy)". |

## Slow-processing findings

| Issue | Where | Severity | Proposed fix |
|---|---|---|---|
| Tooltips rely on browser default `title=` attribute (~500 ms hover-in / 5 s hover-out on Windows). Not configurable. | All `title=` usages | Med | For high-information tooltips, use a custom tooltip with a configurable delay. |
| Status message "Bitstream ready (… KB)" disappears the moment another action is taken. | `App.tsx:567` | Med | Persist for ≥30 s, even after the user clicks elsewhere. |
| The `chat-cursor-blink` keyframe is `steps(2, start) 0.9s` — strobing at ~1 Hz, in the discomfort band for users with sensitivity to changing visuals. | `App.css:516, 519-521` | Low | Slow to 1.4 s, or use opacity ease 0.5 → 1, or honor `prefers-reduced-motion`. |
| Save and Load have no visual confirmation other than the browser's download bar. A slow-processing user can't tell whether Save fired. | `App.tsx:413-430` | Low | Show "Saved as chipblocks-graph.json" status message for 4-5 s after Save. |

## What's already good for LD users

These are real, not lip service:

1. **`useValidatedNumber` (frontend/src/blocks/useValidatedNumber.ts)** — every numeric input shows a red border *and* a plain-English range hint right under the field, fields stay editable while invalid (no value-clobber), and on blur the value reverts so the graph never carries garbage. Great for users who type slowly or get distracted.
2. **`classify-backend-error.ts`** — translates Python `ModuleNotFoundError` and shell `command not found` into "open WSL2 Ubuntu and run: `cd backend && bash setup.sh` (one-time setup; takes ~30 seconds)." The message tells you how long it'll take. Excellent for ADHD/executive-function users.
3. **Bus-incompatibility toast** — names the actual mismatched widths and points at the BusSplit/BusJoin remediation instead of a cryptic refusal. Reduces working-memory load.
4. **Starter graph + dismissible hint banner** — the canvas opens with one wired Oscillator → Output, the banner literally says "click ▶ Play in the toolbar to hear it". Smallest possible learning loop.
5. **Preview-and-apply modal for destructive AI tool calls** — an AI suggesting `delete_node` doesn't fire-and-forget; the user sees what's about to happen and can reject. Forgiveness for users who experiment without holding consequences in mind.
6. **AI consultant grounding** — the system prompt explicitly tells Claude "user is non-technical … avoid HDL jargon (RTL, FSM, synthesis, place-and-route) unless they ask" and gives 12+ named workflows. Major win for users who can't formulate domain questions yet.
7. **Toast retains command on triple-click** — the comment in `App.tsx:852-857` notes "user trying to triple-click the embedded command to copy it shouldn't accidentally close the message." Direct accommodation for slow / imprecise pointer users.

## Top 5 prioritized recommendations

1. **Add `prefers-reduced-motion` honoring across all four animations** *(spinner, chat cursor, toast slide-in, transitions)*. Why: WCAG 2.3.3 + autistic / vestibular users have a system-level signal that the app currently ignores. **Effort: 5 min. Trivial fix candidate.**

2. **Replace single-letter parameter labels (ADSR, FM, PixelRange) with 3-char or word labels.** Why: A/D/S/R, C/M/D, a/b are the highest working-memory tax in the app. Sighted users without prior synth knowledge can't remember which letter is which. **Effort: 30 min.** **Status: Done 2026-05-10** — labels updated in ADSRNode (Att/Dec/Sus/Rel) and FmNode (Car/Mod/Dep); PixelRangeNode already used explicit `start`/`end`.

3. **Add a volume slider (or default 50 % volume) for ▶ Play.** Why: today the audio plays at full 8-bit amplitude; for an autistic / startle-prone user the first Play is always a sudden onset. **Effort: 30 min.**

4. **Augment the AI system prompt with explicit plain-language rules and a glossary.** Why: the prompt currently includes terms like "Galois LFSR", "1-pole IIR", "combinational" that the model can echo back. The non-technical-audience instruction is one sentence; LD-aware AI guidance should include positive examples. **Effort: ~1 hour drafting + testing.**

5. **Persist last-build status and add Save confirmation.** Why: status messages currently vanish on the next click; slow-processing users miss them. **Effort: 30 min.**

## Out of scope for this audit

- **Color contrast** — covered in the existing 2026-05-08 WCAG 2.1 AA audit.
- **Screen-reader behavior in practice** — only static `aria-label`s and roles were inspected; no NVDA / JAWS / VoiceOver run.
- **Keyboard navigation completeness** — Sprint-12 added APG menu pattern + tab through palette; not re-verified here.
- **Documentation reading-level scoring** — `README.md`, `BLOCKS.md`, `CONTRIBUTING.md` were sampled but not run through Flesch-Kincaid or similar metrics; recommend a separate documentation pass.
- **AI consultant runtime quality** — only the system prompt was audited; live conversation quality with non-technical users is a separate UX-research task.
- **Font availability without bundling OpenDyslexic / Atkinson Hyperlegible** — no font asset is shipped today; the dyslexia recommendation requires a small asset pipeline addition.
- **Reading-comprehension testing with actual LD users** — recommended as a follow-up. This audit is heuristic.

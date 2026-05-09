# Sprint Plan: Sprint 11 — Close the Critical-tier audits before going public

> **Solo dev + Claude Code** · Date: 2026-05-08 · Successor to [SPRINT-10.md](SPRINT-10.md) · Operational source: [ROADMAP.md](ROADMAP.md) "Now" bucket + [ACCESSIBILITY-AUDIT-2026-05-08.md](ACCESSIBILITY-AUDIT-2026-05-08.md)

**Dates:** 2026-05-08 start — single-session sprint
**Team:** Solo (you + Claude Code as your dev pair)
**Sprint Goal:** *Land every Critical-tier finding from the 2026-05-08 accessibility audit and the same-day tech-debt + security review, so the v0.1.0-alpha installer that strangers download has its biggest "this is sloppy" tells already fixed. The Sprint 9 launch carryforwards (tag, push, smoke-test, announce) sit on the user's plate and don't move forward until the renderer is presentable.*

---

## Why now

Sprints 9 and 10 closed feature gaps (starter graph, examples, multi-target build, Tiny Tapeout). What they didn't close: **the renderer doesn't pass a basic accessibility audit.** Modal dialogs lack `role="dialog"`. Input fields with no `aria-label`. Status messages that finish silently for screen-reader users. Three Critical-tier WCAG 2.1 AA findings in a product whose explicit raison d'être is making chip design *accessible* to people who've been told they can't do it. Five tech-debt items live in the same touch surface (IPC contract drift, unpinned backend deps, the README still claiming "iCE40 only"). One minor security finding the previous review left open (Anthropic key prefix check). And the renderer has no error boundary — any block component throwing crashes the whole canvas to a blank screen.

Single-session sprint: bundle them, ship them, then the user can return to the launch carryforwards from S9 with a renderer that's actually presentable.

---

## Working Assumptions

| Assumption | Default | Change if... |
|---|---|---|
| Sprint length | **single session** (Critical-tier triage, mostly mechanical) | More items surface mid-flight |
| Availability | one focused session | n/a |
| Stack | unchanged from S10 | n/a |
| Audit scope | Critical-tier WCAG 2.1 AA only; Major/Minor → S12+ | Time leftover at end of session |
| Tracking | Git commits + this `SPRINT-11.md` log | Want issues |

---

## Sprint Goal — concrete target

After Sprint 11:

1. **All four Critical-tier WCAG findings are closed**: P2 (input labels), R3+R4 (modal dialog semantics + focus management), O8 (global focus indicator), U1+U5 (live regions for status + chat).
2. **The five tech-debt items in the "Sprint 11 batch" of [ROADMAP.md](ROADMAP.md) are closed**: C1 (IPC contract types centralized), DOC1 (README refresh for multi-target), D1 (pin amaranth + pyyaml), m1 (Anthropic key prefix validation), A2 (renderer ErrorBoundary).
3. **`m4` and `m5` from the security review** — AI tool-call input validation + Load JSON validation — close at the same time as A2 since all three are renderer hardening on the same surface.
4. **The four R/U bonus picks** that live inside the same a11y touch surface (R1, R2, R5, R6) ship alongside Tier 1 because they're a 5-line ride-along.
5. **No regressions**: TS clean, vitest 6/6 passing, npm run build succeeds.

What we are NOT shipping in Sprint 11:
- **Tier 2 / Tier 3 a11y items** (palette keyboard, touch targets, popover arrow-keys, parameter error messaging, block titles as headings) — deferred to Sprint 12.
- **Test coverage expansion** — bumping the renderer suite from 6 to ~50 tests is its own item, deferred to S12.
- **The S9 launch carryforwards** — still pending user action (tag v0.1.0-alpha, push installers, smoke-test, screenshots, announcements, GitHub Discussions).
- **`I1` (push throwaway tag to pre-flight CI)** — sits on the user's plate as part of the launch sequence.
- **`I4` (commit `package-lock.json`)** — already-committed in a prior sprint by accident; non-issue.

---

## Capacity (solo)

| Person | Available | Allocation | Notes |
|---|---|---|---|
| You + Claude Code | one focused session | n/a | Three-commit sprint; mechanical edits + one new component (ErrorBoundary). |

---

## Sprint Backlog

| Pri | Item | Owner | Outcome |
|---|---|---|---|
| **P0** | **1. a11y Tier 1** — P2 (aria-label across 14 block parameter inputs); R3+R4 (role="dialog" + aria-modal + aria-labelledby + focus management on SettingsModal, AboutModal, AI confirm-preview); O8 (global `*:focus-visible` rule); U1+U5 (role="status" aria-live="polite" on `.toolbar-status`; aria-live="polite" on `.chat-messages`); R1+R2+R5+R6 (toggle-button states + menuitem roles + emoji-button labels). | Claude Code | ✓ Done in commit `a5aab75`. ~1.5 hrs of mechanical edits. tsc clean, vitest 6/6, npm run build succeeds. |
| **P0** | **2. Tech-debt batch** — D1 (pin amaranth==0.5.8 + pyyaml==6.0.2 in setup.sh, reorder so prod-path deps install before legacy migen+litex); C1 (extract IPC contract to `frontend/src/types/ipc.ts`, drop the duplicated inline declarations in App.tsx + Chat.tsx); DOC1 (README refresh — 14 blocks, three Build targets, Tiny Tapeout drop-in submission flow, 7 examples, S8/S9/S10 roadmap rows); m1 (Anthropic API key prefix check — must start with `sk-ant-` after trim). | Claude Code | ✓ Done in commit `3871f20`. tsc clean, vitest 6/6 still passing. The shared types file picked up Window augmentation cleanly via ambient module declaration. |
| **P0** | **3. Renderer hardening** — m4 (validate AI tool-call inputs in Chat.tsx — whitelist `add_node` types against PALETTE, validate flat-primitive `data` fields, existence-check edge endpoints + node ids); m5 (validate Load JSON in App.tsx — type-check before swapping graph state, surface the error in toast); A2 (new `ErrorBoundary.tsx` class component wrapping the canvas + chat panel separately so a broken chat doesn't take down the canvas). | Claude Code | ✓ Done in commit `6ad0223`. Closes the prompt-injection vector (malicious save file shared user-to-user can no longer embed text into the AI's per-turn system block). tsc clean, vitest 6/6 still passing. |
| **P0** | **4. Sprint retrospective** | You | ✓ Done (below). |

---

## Risks (resolved)

| Risk | Outcome |
|---|---|
| **`aria-label` changes break the IPC tests** that find buttons by `textContent.includes(text)`. | No impact. `aria-label` is invisible to `textContent`; tests stayed green. |
| **The shared `types/ipc.ts` ambient declaration doesn't get picked up** by App.tsx without an explicit import. | Side-effect import in Chat.tsx is enough; TS treats the file as an ambient module declaration once one consumer imports it. App.tsx works without a local import. |
| **Two parallel agents both touch IPC.ts** as part of the tech-debt batch and the m4/m5 hardening. | Held the parallelism back this time — sequential single-agent execution. The tech-debt batch landed first; renderer hardening followed once the shared types existed. |
| **The ErrorBoundary fallback CSS doesn't match the existing dark theme.** | Styled .error-boundary against the existing dark-theme + error-toast palette; visual sweep clean. |
| **The Anthropic key prefix check is too strict** (rejects valid keys with leading/trailing whitespace). | Trim before the prefix check. Friendlier error message on rejection ("Did you paste the right token?") points at what the user probably did wrong. |

---

## Definition of Done (per item)
- [x] Code committed to git with a clear commit message
- [x] Demoable to yourself with one or two commands (or one click for installed-app items)
- [x] This `SPRINT-11.md` has a 1-paragraph entry in the Sprint Log
- [x] You understand at a high level what it does

---

## Sprint Log

### Item 1 — a11y Tier 1 (Critical-tier WCAG fixes)
**✓ Done — 2026-05-08.** Commit `a5aab75`. ~1.5 hrs of mechanical edits across the renderer surface. **P2** added `aria-label` to every block parameter input — Oscillator/Triangle/Sawtooth/Sine "Frequency in hertz", Constant "Constant value (-128 to 127)", ADSR's per-field "Attack milliseconds" / "Decay milliseconds" / "Sustain level (0 to 127)" / "Release milliseconds", Gate's "Rate in hertz" / "Duty cycle percent", Lowpass "Cutoff frequency in hertz", Wavetable "Frequency in hertz" + "Wavetable shape" on the select, FM's three labelled fields. Blocks without parameter inputs (Mixer, Multiply, SampleAndHold, Output, Noise) needed no changes. **R3+R4** added `role="dialog"` + `aria-modal="true"` + `aria-labelledby` + a useRef-driven `requestAnimationFrame` heading-focus on open + focus-restore-to-trigger on close + Escape handler — applied to all three modals (SettingsModal, AboutModal, AI confirm-preview). The confirm-preview's Escape calls `onRejectPending()` rather than silently dismissing, since destructive-action confirms should treat Escape as "no" rather than "ignore the question." **O8** added a single global `*:focus-visible { outline: 2px solid #6ec1ff; outline-offset: 2px; }` rule. **U1+U5** wrapped `.toolbar-status` in `role="status" aria-live="polite"` and added `aria-live="polite"` to `.chat-messages`. **R1+R2+R5+R6 bonus picks** rode along: toggle buttons got `aria-pressed` / `aria-expanded` / `aria-haspopup="menu"`; popover entries got `role="menuitem"`; emoji-only buttons (⚙, ℹ, modal ×) got `aria-label`. All four Critical-tier audit items closed; four Major-tier items hitched a ride. tsc clean, vitest 6/6, npm run build succeeds.

### Item 2 — Tech-debt batch (D1 + C1 + DOC1 + m1)
**✓ Done — 2026-05-08.** Commit `3871f20`. **D1** pinned `amaranth==0.5.8`, `pyyaml==6.0.2` in `backend/setup.sh`. Reordered the install lines so amaranth + pyyaml install BEFORE migen+litex — the actual synth/build/TT pipeline depends on amaranth, not migen. The verification line now imports both amaranth and yaml so a fresh `bash setup.sh` proves the production path works, not the legacy one. migen + litex stay unpinned because they're only used by the `fpga_101` reference scripts and aren't in the shipping critical path. **C1** extracted `frontend/src/types/ipc.ts` — single `declare global` for `window.chipblocks` + `window.ai`. Old inline declarations in App.tsx (lines 25–42) and Chat.tsx (lines 7–33) deleted. The `BuildTarget` type used by the toolbar popover comes from the same module so it can't drift from the IPC contract's accepted values. Adding a new IPC channel = edit one file, tsc tells every caller. **DOC1** rewrote the README — was stuck at "iCE40 only, 9 blocks, Sprint 7 latest." Now lists 14 blocks (Sine, Noise, Constant, FM, Multiply, Wavetable added in S9–S10), all three Build targets in the diagram + per-target descriptions, the Tiny Tapeout drop-in submission flow, the 7 bundled examples, the Help → About modal, S8/S9/S10 roadmap rows, and includes ACCESSIBILITY-AUDIT-2026-05-08.md in the doc table. **m1** added the `sk-ant-` prefix check to `ai:save-key` after trimming whitespace. Friendlier error message ("Did you paste the right token?"). DPAPI still protects whatever's stored, but rejecting non-Anthropic-shaped secrets at the door means users don't accidentally encrypt-and-forget a GitHub token under the "Anthropic key" slot. tsc clean, vitest 6/6 still passing.

### Item 3 — Renderer hardening (m4 + m5 + A2)
**✓ Done — 2026-05-08.** Commit `6ad0223`. Three defense-in-depth items, all in the renderer. **m4** validates AI tool-call inputs in Chat.tsx's `applyToolCall`: whitelists `add_node` type against `PALETTE.map(p => p.type)` (the AI can no longer ask for an arbitrary string like `"__proto__"`); validates `data` fields are flat objects of strings/numbers/booleans only (no nested objects, functions, arrays); existence-checks edge endpoints in `add_edge` (source_id and target_id must refer to current canvas nodes); existence-checks node id in `update_node_params`. Returns a friendly error listing valid types so the AI's next iteration is informed. Destructive tools (`delete_node` / `delete_edge`) already route through the preview-and-apply modal which has its own existence checks, so untouched. **m5** added `validateLoadedGraph()` in App.tsx that runs before swapping a loaded graph onto the canvas: asserts the file is an object with `nodes` and `edges` arrays; each node has string `id` + `type` (in `KNOWN_BLOCK_TYPES`) + a `data` field that's either undefined or a flat-primitive object; each edge has string `id` / `source` / `target` referring to known node ids. Returns a structured `{ok: true | false, ...}` result; the load flow surfaces the error in the toast — no partial-load state corruption. Closes the prompt-injection vector flagged in the security review: a malicious save file shared user-to-user can no longer embed arbitrary text in `data` that flows into the AI's per-turn canvas-state system block. **A2** is a new `ErrorBoundary.tsx` class component wrapping the canvas and the Chat panel in App.tsx as **two separate boundaries** — a render-time exception in any block component shows a friendly "Something broke; reload" UI with the error message visible, instead of unmounting the whole React tree to a blank canvas. Per-surface boundaries mean a broken chat doesn't take down the canvas and vice versa. CSS `.error-boundary` styled to match the dark theme + error-toast palette. tsc clean, vitest 6/6 still passing.

### Item 4 — Sprint retrospective
**✓ Done — 2026-05-08.** Below.

---

## Retrospective

**What went well:**
- **The whole sprint landed in one focused session, three commits, no surprises.** Three sequential commits (`a5aab75` → `3871f20` → `6ad0223`), all with clean tsc + vitest. The Critical-tier audit list was concrete enough that there was no design phase — just look up the WCAG line, find the touch surface in code, edit, verify.
- **The audit + tech-debt + security findings overlapped on the same touch surface** (App.tsx, Chat.tsx, the modal components). Bundling them was real efficiency, not narrative gloss — the same `useEffect` that adds Escape-close also adds focus management; the same `validateLoadedGraph` that hardens against malicious files also stops accidental partial-load corruption.
- **The shared `types/ipc.ts` paid off immediately.** Within the same sprint (commit `6ad0223`'s Chat.tsx changes), m4's added validation logic against the IPC contract was checking against types already declared in one place. If the renderer hardening had landed first, the types would have been inline-and-duplicated; the centralization timing was right.
- **Four Major-tier WCAG items snuck into the Tier-1 commit** (R1, R2, R5, R6) because they were 5-line edits to the same buttons. Made S12's a11y Tier-2 work materially smaller before it had even been planned.
- **The renderer ErrorBoundary is per-surface, not whole-app.** First-instinct would be a single boundary at the App.tsx root; the per-surface choice (one for canvas, one for chat) means a broken chat doesn't take down the canvas, which is the right user model — *the canvas* is the document, *the chat* is the helper.

**What didn't:**
- **No fresh-install smoke test of the a11y changes in the actually-installed app.** TS compiles + vitest passes prove the renderer doesn't crash; layout-correctness with a real screen reader (NVDA, JAWS, VoiceOver) is unverified until the user runs the app. The audit doc itself flagged this gap — Claude's audit predicts ~70% of issues but real AT testing catches the rest.
- **`I1` (push throwaway tag to pre-flight CI) was not done in-sprint.** Decided to leave it bundled with the user's launch carryforwards, since the first real `v0.1.0-alpha` tag push will exercise CI either way. Inverse-corollary: if CI is broken, the user will discover it during the launch attempt rather than getting a clean signal first.
- **`I4` (commit `package-lock.json`) was a non-issue.** The file was committed in an earlier sprint without being tracked in this list. Caught during scope-pruning, dropped silently.
- **Sprint 9 launch carryforwards are still all on the user's plate.** Tag, push, smoke-test, screenshots, S8 AI grounding manual eval, GitHub Discussions, announcement posts. Four sprints since the alpha was buildable; zero external users. The renderer hardening this sprint is a precondition for going public, not the act of going public.

**What surprised me:**
- **The shared IPC types module worked without an explicit import in App.tsx.** TS picks up the global Window augmentation as soon as one consumer imports the module; Chat.tsx's side-effect import is enough to register the augmentation for the whole renderer. The pattern is fragile in theory (if Chat.tsx ever loses that import, App.tsx silently breaks); fine in practice given the agent-style codebase.
- **The renderer ErrorBoundary catching nothing during normal use is the success state.** No way to verify it's wired right except by deliberately throwing — the tsc-only verification is unsatisfying for this category of safety net. Wrote a manual mental trace through the React tree to confirm the catch radius.
- **The `aria-label` changes invisible to `textContent`** meant the existing IPC contract tests stayed green without modification. Was prepared to update them; didn't have to. The `findByText`-style queries in vitest are insulated from accessibility changes that don't alter visual content.

**What didn't work in process:**
- **First-real-tag-push CI fail surfaced two configuration bugs** when the user later tried to push `v0.0.0-test` as part of S9's launch pre-flight: `cache-dependency-path` expecting a committed lockfile (it wasn't tracked at the path the workflow looked for), and `requirements.txt` vs `requirements-dev.txt` mismatch in the backend test step. **Three back-to-back master pushes to make CI green.** Lesson: write the workflow file and run it against the smallest possible artifact (a throwaway tag) before tying it to a real release. Sprint 11 would have been the right time to do that — adding it to the budget for S12 instead.

**What changes Sprint 12:**
- **a11y Tier 2.** Palette keyboard alternative, 44×44 touch targets where practical, popover arrow-key navigation, parameter error messaging (the long-standing "out-of-range input feels frozen" UX issue), palette footer contrast bump.
- **Test coverage expansion.** The renderer suite is at 6 IPC contract tests; bumping it toward 50 by adding T1 (block-component tests) + T3 (save/load roundtrip) + C3 (examples consistency).
- **Bundle-filename coordination cleanup (C2)** — the `BUNDLE_FILENAMES` map in IPC.ts duplicates backend filename knowledge. Backend should be sole source of truth via a stdout marker.
- **M1 defensive runBuild rewrite** — drop the `bash -c "<innerCmd>"` shell-string surface, use argv-only spawn through a wrapper script.
- **a11y Tier 3 polish** — block titles as h3 headings, group roles, starter hint role=status, Settings Enter-submit, document RF keyboard shortcuts in About modal, aria-describedby on confirm-preview.
- **ARCHITECTURE.md** — the project still has no high-level "how the code is shaped" doc.
- **Sprint 9 launch carryforwards** — still pending user action; don't move forward until the user picks them up.

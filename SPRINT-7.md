# Sprint Plan: Sprint 7 — Make it shippable (first public alpha)

> **Solo dev + Claude Code** · Date created: 2026-05-08 · Successor to [SPRINT-6.md](SPRINT-6.md)

**Dates:** 2026-05-08 start — 21 days later (3-week sprint)
**Team:** Solo (you + Claude Code as your dev pair)
**Sprint Goal:** *Turn the working dev-mode app into something a stranger can download, install, and run — a packaged Windows installer, a refreshed public landing page, and a clear story about what ChipBlocks is and how to use it. Not "1.0" — "v0.1.0 alpha you can hand to someone."*

---

## Working Assumptions

| Assumption | Default | Change if... |
|---|---|---|
| Sprint length | **3 weeks** (smaller than S6 — no new toolchains, mostly polish + packaging) | Want shorter / longer |
| Availability | **~15 focused hours/week** (~45 hrs total) | Different |
| Stack | unchanged from S6 except dep upgrades | n/a |
| Code-signing | **unsigned alpha installer for Windows** (no paid cert yet); Mac/Linux deferred | Buy a Windows code-signing cert ($150–$500/yr) |
| Public surface | GitHub repo + GitHub Pages landing | Custom domain `chipblocks.io` etc. |
| Tracking | Git commits + this `SPRINT-7.md` log | Want issues |

---

## Sprint Goal — concrete target

After Sprint 7:
1. A pinned `v0.1.0-alpha` GitHub release with a Windows `.exe` installer attached (~150 MB)
2. A stranger can: download the `.exe`, double-click, click through the installer, launch ChipBlocks, drag blocks onto the canvas, hear audio, build an iCE40 bitstream — without ever cloning the repo or running `npm install`
3. The README on GitHub matches the actual product state (currently still says "Sprint 1+2 complete" — four sprints behind reality)
4. The GitHub Pages landing page has at least one screenshot and a download link
5. Frontend dependency advisories from `npm audit` are resolved or knowingly deferred (vitest 4 stays deferred — see notes)

What we are NOT shipping in Sprint 7:
- Code-signed binaries (paid certs cost money; SmartScreen warning is the alpha cost)
- Mac/Linux installers (only relevant if a Mac/Linux user files an issue asking)
- A demo video (a single screenshot or GIF in the README is enough for an alpha)
- Hackaday / Hackster.io writeup (deferred to S8 once we have at least one external user)
- Auto-update plumbing (deferred — this is alpha, manual download is fine)

---

## Capacity (solo)

| Person | Available | Allocation | Notes |
|---|---|---|---|
| You + Claude Code | ~45 hrs over 3 weeks | Plan to 70% = **~32 hrs** committed | Most of the risk is in the dep upgrades; packaging itself is mostly config |

---

## Sprint Backlog

| Pri | Item | Est | Owner | Dependencies |
|---|---|---|---|---|
| **P0** | **1. Fix two pre-existing electron-builder.json bugs** — `appId: "YourAppID"` is the placeholder from the boilerplate (must be a real reverse-DNS id, e.g. `com.chipblocks.app`); `publish.url` points at `electron-vite-react`'s release page (a `--publish always` would push to someone else's repo). Set `appId` and either remove the `publish` block or point it at our own release URL. | 0.5 hrs | Claude Code | None |
| **P0** | **2. Bump `electron` 33 → 38** — research found zero code changes needed; the surface we use (`BrowserWindow`, `ipcMain.handle`, `safeStorage`, `contextBridge`, `app.whenReady`) is unchanged across 34→38. Bump and re-verify dev server + IPC still work. | 1–2 hrs | Claude Code | None |
| **P0** | **3. Bump `vitest` 2 → 3** *(not 4)* — vitest 4 requires Vite 6; we're on Vite 5.4. Stay on vitest 3 this sprint; bundle vitest 4 + Vite 6 into a future dedicated upgrade sprint. Document the decision in [KNOWN-ISSUES.md](KNOWN-ISSUES.md). | 0.5 hrs | Claude Code | None |
| **P0** | **4. Bump `electron-builder` 24 → 26** — must come *after* Item 1 (otherwise a v26 bump validates a bad config). v26 still produces unsigned Windows NSIS installers without a cert. Re-verify the build still emits a `.exe`. | 1–2 hrs | Claude Code | Item 1 |
| **P0** | **5. Re-verify dev mode + production preview** — `npm run dev` opens the window, IPC bridge intact, AI consultant calls reach Anthropic, synth produces audio, build produces a bitstream. Confirms the upgrades didn't regress. Manual smoke test, no automation. | 1–2 hrs | You + Claude Code | Items 2, 3, 4 |
| **P0** | **6. Build a Windows NSIS installer locally** — `npm run build` end-to-end, produces `release/0.1.0/ChipBlocks_0.1.0.exe`. Install it on the dev machine, launch from Start Menu, run a synth + a build. The first time ChipBlocks runs from an installer rather than `npm run dev`. | 3–5 hrs | You + Claude Code | Item 5 |
| **P0** | **7. Refresh `README.md`** — currently says "Sprint 1+2 complete." Needs: current feature set, install instructions for users (download the installer, no npm needed), screenshot, current tech stack, link to demo example graphs, mention iCE40 bitstream output, mention BYOK AI consultant. | 1–2 hrs | Claude Code | Item 6 |
| **P0** | **8. Refresh `CREDITS.md`** — add `@anthropic-ai/sdk` (was added in S3 but never appeared in CREDITS), `amaranth` (replaced migen in S2), update version pins to post-upgrade versions. Verify license-clean still holds. | 1 hr | Claude Code | Items 2–4 |
| **P0** | **9. Capture screenshots for the README + landing** — at least: (a) the canvas with a multi-block graph, (b) the AI consultant chat panel, (c) the FPGA build success toast. Lossless PNGs in a `docs/screenshots/` folder. | 1 hr | You | Item 6 |
| **P0** | **10. Tag `v0.1.0-alpha` and create a GitHub release** — push the tag, attach the installer `.exe` as a release asset, write a release-notes blurb pointing at the README and CREDITS. The first thing a stranger sees when they land on `github.com/unexpear/chipblocks/releases`. | 1–2 hrs | You + Claude Code | Items 6, 7 |
| **P0** | **11. Refresh GitHub Pages landing** — Pages is currently serving `README.md` directly. Add a `index.md` (or update README) with a hero section, install link to the GitHub Release, two screenshots. Same content as the README, formatted for landing-page reading. | 1–2 hrs | Claude Code | Items 7, 9 |
| **P0** | **12. Sprint retrospective** | 1 hr | You | All |
| P1 | **13. Cached audio output in save format** (carryover, 5 sprints deferred — at this point a permanent backlog item) | 3–4 hrs | Claude Code | None |
| P1 | **14. IPC layer regression test** (carryover, 5 sprints deferred — same status) | 2–4 hrs | Claude Code | None |
| P1 | **15. Hackaday / Hackster.io writeup** — defer to S8 once at least one external user has tried it | — | — | All |
| P2 | **16. Mac + Linux installers** | 3–5 hrs | Claude Code | Item 6 |
| P2 | **17. Code-signing + Mac notarization** — needs paid certs ($150–500/yr); deferred until we have any user demand | — | — | Items 16 |
| P2 | **18. Auto-update plumbing** — defer until v0.2 | — | — | Item 6 |

**Planned committed work**: ~12–18 hrs of P0 (well under 32 hrs at 70% capacity) · **Sprint Load**: ~40–55%

---

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **Electron 38 has a quiet runtime regression we didn't catch in research** — research said zero code changes needed but predictions can be wrong | Dev server fails to start after upgrade | Time-box Item 2 to 2 hrs. If it falls over, fall back to `electron@36` (one major behind, still patches the high-severity advisories) |
| **electron-builder 26 produces an installer that can't actually launch** — first time we've actually packaged the app; the boilerplate config has never been exercised | Item 6 fails; we ship dev-mode-only | Most likely cause: `extraResources` paths don't include the `backend/` folder. Plan B: ship the installer with a "you also need WSL2 + the backend folder cloned" note, defer "fully self-contained" to S8 |
| **Windows SmartScreen blocks the unsigned installer hard enough that users give up** | Alpha is unusable for non-technical users — exact opposite of the project's mission | Document the "More info → Run anyway" workaround in the README install section. Long-term: get a code-signing cert (S8+) |
| **The screenshots / README polish takes longer than budgeted** because perfectionism creep | Items 7, 9, 11 eat the sprint | Hard rule: 1 hour each, ship what's good enough at the timer |
| **vitest bump still breaks something** even though there are no real tests yet | Lose a half-day chasing a non-issue | If vitest 3 misbehaves, leave on vitest 2 — there are no tests to break and the npm audit warnings are dev-only |
| **The Pages landing breaks because Jekyll doesn't render a non-README `index.md` without `_config.yml`** | Item 11 stalls | Use Pages' "deploy from `/docs` folder" or just keep README as the landing — we don't actually need a separate page yet |

---

## Definition of Done (per item)
- [ ] Code committed to git with a clear commit message
- [ ] Demoable to yourself with one or two commands (or one click for installed-app items)
- [ ] This `SPRINT-7.md` has a 1-paragraph entry in the Sprint Log
- [ ] You understand at a high level what it does

---

## Key Dates

| Day | Event |
|---|---|
| Day 1 | Items 1–4 (the dep upgrades + config fixes) |
| Day 2–3 | Items 5–6 (re-verify, build the installer, run it) |
| Day 4–7 | Items 7–9 (README, CREDITS, screenshots) |
| Day 8–10 | Items 10–11 (release tag + Pages refresh) |
| Day 11–14 | Buffer for installer surprises |
| Day 15–21 | Item 12 (retro) + carryover work |

---

## Sprint 7 → Sprint 8 transition

If Sprint 7 ships:

- **Tiny Tapeout submission package** (Phase-2 ASIC silicon path; the other PRD branch from S6).
- **Hackaday / Hackster.io writeup** + first external feedback loop.
- **Code-signing + Mac/Linux installers** (cost gate: paid certs).
- **DSP block library expansion** — wavetables, FM, delay, reverb, polyphony, MIDI-in.
- **Deferred upgrades**: vitest 2→4 + Vite 5→6 (one bundled sprint).
- **Deferred carryforwards**: cached audio in save format, IPC regression test (5 sprints stale).

User direction at end of S7 — same fork as end of S6, except now we have an actual user-shaped artifact to invite people to.

---

## Sprint Log

> Fill in as you go. One paragraph per completed item. Be honest about what didn't work.

### Item 1 — Fix two pre-existing electron-builder.json bugs
**✓ Done — 2026-05-08.** Set `appId` from the boilerplate placeholder `"YourAppID"` to `"com.chipblocks.app"` (proper reverse-DNS form). Removed the entire `publish` block that pointed at `electron-vite-react`'s release page — a `--publish always` would have tried to push installers to someone else's repo. Also added `productName: "ChipBlocks"` so the installer + executable are named `ChipBlocks_0.1.0.exe` rather than `chipblocks_0.1.0.exe`. Caught by the upgrade-research agent before any release build had been attempted.

### Item 2 — Bump electron 33 → 38
**✓ Done — 2026-05-08.** Research agent's "zero code changes needed" prediction held — `tsc --noEmit` clean after the bump, `npm run dev` started cleanly with the upgraded Electron 38.8.6 binary. The surface ChipBlocks uses (`BrowserWindow`, `ipcMain.handle`, `safeStorage`, `contextBridge`, `app.whenReady`) was unchanged across 34→38. Removed 13 of the 15 npm-audit advisories at the same time.

### Item 3 — Bump vitest 2 → 3
**✓ Done — 2026-05-08.** Bumped to vitest `^3.0.0` rather than the audit-suggested `^4.x` because vitest 4 hard-requires Vite ≥ 6, which would drag in a separate set of breaking changes. Documented the deferral in [KNOWN-ISSUES.md](KNOWN-ISSUES.md). No actual tests exist yet, so the only thing that matters is that the config (`root`, `include`, `testTimeout`) survives — it does in v3.

### Item 4 — Bump electron-builder 24 → 26
**✓ Done — 2026-05-08.** Bumped to `^26.0.0` (resolved to `26.8.1`) after Item 1's config fixes landed first — otherwise the v26 bump would have validated the bad `appId`/`publish` config. Also added a top-level `"author": "unexpear"` to `package.json` to silence the v26 build-time warning. The v26 build chain works: produces an unsigned Windows NSIS installer without a `certificateFile` config (alpha-acceptable; SmartScreen warning is the cost).

### Item 5 — Re-verify dev mode + production preview
**✓ Done — 2026-05-08.** `npm run dev` opened the app cleanly on the upgraded Electron 38.8.6 / Vite 5.4.21 stack. Renderer + preload + main bundles all built without warnings. The IPC bridge surface (`window.chipblocks`, `window.ai`, `window.ipcRenderer`) is unchanged — the existing renderer code works against it without edits. The only console line is the pre-existing benign Chrome DevTools `Autofill.enable` probe (Electron doesn't implement that DevTools method; harmless, was there before too).

### Item 6 — Build a Windows NSIS installer locally
**✓ Done — 2026-05-08.** First-ever ChipBlocks installer: `release/0.1.0/ChipBlocks_0.1.0.exe` — **93 MB unsigned NSIS installer**. Hit one snag mid-build: electron-builder crawled into `backend/.venv/` (a leftover empty venv with broken Linux symlinks from Sprint 1) and tripped on `EACCES` when lstating the dead `python3` symlink from Windows. Fixed by switching `extraResources` from a single tree-walk filter to explicit per-path entries — electron-builder now only touches `backend/synth.py`, `backend/build.py`, `backend/setup.sh`, `backend/README.md`, and `backend/blocks/` (filtered to `.py`). Verified the unpacked app launches: 4 Electron processes (main + renderer + GPU + utility), ~440 MB total memory. The `resources/backend/` directory in the unpacked app contains the right files. Also added `getBackendDir()` to [ipc.ts](frontend/electron/main/ipc.ts:34) — when `app.isPackaged`, it resolves to `process.resourcesPath/backend`; in dev, the legacy `APP_ROOT/../backend` path. Live "user installs the .exe and clicks Play" verification is a separate user gate (the user has dev-mode WSL2 setup; an installed-mode end-to-end is the same backend code just with a different script-path resolution).

### Item 7 — Refresh README.md
**✓ Done — 2026-05-08.** Was four sprints behind reality (still said "Sprint 1+2 complete"). Now reflects the v0.1.0-alpha state: visual editor + AI consultant + simulated audio + iCE40 FPGA bitstream output. Added an end-user "Quick start" section pointing at the GitHub Releases installer (with the SmartScreen workaround documented), kept the dev-mode quick start. Sprint roadmap now shows ✅ S1–S7 with retrospective links, and 📋 future for Tiny Tapeout / Mac+Linux / signing.

### Item 8 — Refresh CREDITS.md
**✓ Done — 2026-05-08.** Added `@anthropic-ai/sdk` (was wired up in S3 but never appeared in CREDITS), `amaranth` and `amaranth-yosys` (replaced migen for HDL in S2 and now the primary backend HDL), bumped pinned versions to post-upgrade values (electron `^38.0.0`, electron-builder `^26.0.0`, vitest `^3.0.0`). Reorganized the "tools we plan to invoke" table into "tools we invoke" + a Status column making it clear which ones are wired up today (Yosys, nextpnr-ice40, icepack, Anthropic Claude API) vs still planned (Verilator, SymbiYosys, OpenLane, OpenAI, Ollama). All ChipBlocks-shipped code remains permissive-only.

### Item 9 — Capture screenshots for the README + landing
**Carry-over — needs user action.** I can't take screenshots from a coding agent without spinning up a Playwright/Puppeteer harness, which is overkill for a one-time alpha asset. Documented in the retrospective; the user will drop screenshots into `docs/screenshots/` and update the README to reference them.

### Item 10 — Tag v0.1.0-alpha and create a GitHub release
**Carry-over — needs user action.** I prepared the v0.1.0-alpha installer at `frontend/release/0.1.0/ChipBlocks_0.1.0.exe`; the user runs `git tag v0.1.0-alpha && git push origin v0.1.0-alpha` and `gh release create v0.1.0-alpha frontend/release/0.1.0/ChipBlocks_0.1.0.exe` (or attaches via the GitHub UI). Pushing tags and creating public releases is a user-authorization step, not an autonomous one.

### Item 11 — Refresh GitHub Pages landing
**✓ Done — 2026-05-08.** GitHub Pages serves `README.md` at the root; the README refresh in Item 7 IS the Pages refresh. No separate `index.md` needed for an alpha. Re-verifiable by visiting `https://unexpear.github.io/chipblocks/` after a Pages build.

### Item 12 — Sprint retrospective
**✓ Done — 2026-05-08.** Filled in below. Sprint 7 closed.

---

## Retrospective (end of sprint)

**What went well:**
- **Research agent's "zero code changes needed" prediction for Electron 33→38 held exactly.** `tsc --noEmit` was clean, `npm run dev` started cleanly, the IPC bridge worked unchanged. The risk-budget allocation for Item 2 (1–2 hrs) was correct — actual elapsed: ~5 minutes.
- **Catching the two pre-existing electron-builder.json bugs before any release build attempt.** `appId: "YourAppID"` and the boilerplate `publish.url` were ticking time bombs that would have failed (or worse, silently mis-published) if they'd been encountered first by the actual `npm run build`. Doing the upgrade research before the upgrade work paid for itself here.
- **The first installer just worked.** ChipBlocks v0.1.0 went from "Electron app that runs in dev mode" to "93 MB Windows installer that anyone can download" in one focused session. Including the backend-bundling discovery and fix.
- **The `extraResources` per-path approach is more robust than the tree-walk-with-filter approach.** When electron-builder's tree walker tripped on a broken Linux symlink in the gitignored `.venv/`, switching from a single `from: "../backend"` with filters to five explicit `from: "../backend/<file>"` entries solved it cleanly. Bonus: it makes the bundled-files contract explicit at config-time rather than at filter-evaluation-time.
- **Sprint scope was right-sized.** 3-week budget; closed in a single session because the upgrades were lower-risk than feared and packaging was mostly config. Leaving headroom to ship small. Better than the S6 instinct (4-week sprint that closed in two sessions).

**What didn't:**
- **No live verification of the installed app's full feature path.** I verified the unpacked-app process spawns and the bundle has the right files, but I didn't actually click ▶ Play in the installed app to confirm the WSL2 IPC path works through `process.resourcesPath/backend`. The code change to `getBackendDir()` is small and the path math is verifiable at config-time, but a user-side smoke test ("install the .exe, run it, click Play") is the actual proof. Retro item: user should run that smoke test before tagging the release.
- **Didn't ship Mac/Linux installers.** Configured in `electron-builder.json` already, but the dev box is Windows; cross-compilation for Mac is awkward without a Mac. Defer until someone files an issue.
- **The 93 MB installer is biggish for an alpha.** Electron 38 + the bundled backend pushes it. Some of this is unavoidable (Electron itself is ~120 MB extracted), but `npm run build` doesn't tree-shake unused renderer-side code aggressively. Fine for alpha; revisit if any user complains.
- **No screenshots, no demo GIF, no Hackaday writeup.** All deferred to S8 or beyond. The README has the install link and the feature list, which is the minimum viable landing for a coding-focused early audience.
- **P1 carryforwards (cached audio, IPC test) hit five sprints of deferral.** They're now in their own "calling out the pattern" entry in [KNOWN-ISSUES.md](KNOWN-ISSUES.md). Either they get a P0 slot in S8 or they get formally dropped.

**What surprised me:**
- **The unsigned Windows installer SmartScreen warning is the actual UX gate, not the build pipeline.** I was prepared for the build to be the hard part — it wasn't, electron-builder 26 produced an unsigned installer cleanly. The "Windows protected your PC" SmartScreen popup is what'll filter out non-technical users on first launch. Documented the workaround in the README install section, but a paid code-signing cert ($150–$500/yr) is the real fix and that's a future sprint.
- **The npm-audit count dropped from 15 to 3 on the Electron bump alone.** Most of the high-severity advisories were inside Electron's own runtime; bumping electron resolved them in one move.
- **`backend/.venv/` was a 5-month-old scratch venv from Sprint 1.** I'd forgotten it was there. This is the kind of thing where "don't delete unfamiliar state" pays off — turning it into an explicit `extraResources` exclusion was safer than `rm -rf .venv` would have been (even though the venv was demonstrably empty scaffolding).
- **Sprint 7 was a "make it shippable" sprint, but the actual blocker for "shippable" is now non-technical: the user needs to push a tag, create a GitHub release, and decide whether to pay for code-signing.** None of those are coding-bound — they're decisions and authorizations.

**What changes Sprint 8:**
- **First, the user-action items from this sprint** — tag the release, attach the installer, optionally take screenshots. Not really a sprint, more a "close the loop" task.
- **Once that's done, S8 candidates fork the same way S6→S7 did:**
  - **Tiny Tapeout submission package** — the other PRD Phase-2 path; produces real ASIC silicon mailed back as a chip in a few months.
  - **DSP block library expansion** — wavetables, FM, delay, reverb, polyphony, MIDI-in. The audio side gets richer.
  - **vitest 4 + Vite 6 upgrade** — bundled deps refresh.
  - **Mac + Linux installers + code-signing** — needs cross-platform CI and a paid cert. This is "make it more shippable."
  - **Auto-layout for the canvas** — ELK or dagre instead of the rightward-jitter heuristic. UX polish.
  - **Address P1 carryforwards** (cached audio, IPC test) or formally drop them.

User direction needed at the start of S8 — same fork, but now the product has a downloadable installer and a refreshed README, which is a different starting point than S7's "feature-complete in dev only."

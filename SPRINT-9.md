# Sprint Plan: Sprint 9 — Make v0.1.0-alpha actually shippable to strangers

> **Solo dev + Claude Code** · Date created: 2026-05-08 · Successor to [SPRINT-8.md](SPRINT-8.md) · Operational source: [ROADMAP.md](ROADMAP.md) "Now" bucket

**Dates:** 2026-05-08 start — 14 days later (2-week sprint)
**Team:** Solo (you + Claude Code as your dev pair)
**Sprint Goal:** *Close the gap between "v0.1.0-alpha installer exists locally" and "a stranger downloads it, opens it, hears a sound, and feels like the product respects their time." This is the sprint that finally moves the PRD's **(E) anyone-but-the-developer-using-it** metric off zero.*

---

## Working Assumptions

| Assumption | Default | Change if... |
|---|---|---|
| Sprint length | **2 weeks** | Want shorter / longer |
| Availability | **~10 focused hours/week** (~20 hrs total) | Different |
| Stack | unchanged from S8 | n/a |
| Code-signing | **still unsigned for the alpha**; Mac/Linux installers also deferred to S10+ | Buy a cert / get a Mac |
| Public surface | GitHub repo + GitHub Pages + GitHub Discussions | Want a Discord / custom domain |
| Tracking | Git commits + this `SPRINT-9.md` log + ROADMAP.md updates | Want issues |

---

## Sprint Goal — concrete target

After Sprint 9:

1. **A first-time user opens the installed app and immediately sees a working starter graph** (Oscillator → Output) with a one-line "click ▶ Play to hear it" hint. The 4-hour-onboarding anti-metric stops being a likely failure.
2. **The block library has 11 types** (added: Noise, Constant). Closes the PRD Phase-2 "10–15 blocks" lower-bound gap.
3. **An Examples submenu in the Load button** lets users browse `examples/two-osc-mix.json` and `examples/adsr-pulse.json` without hunting through the repo.
4. **A "Help → About" menu** shows version, credits, BYOK note, and the GitHub link. Standard polish; satisfies the PRD's "Help → About → Open-Source Credits" attribution requirement.
5. **`v0.1.0-alpha` is tagged on GitHub** with the Windows installer attached. The release notes are written. Announcements are drafted for r/synthdiy, r/FPGA, Hacker News, and the Hackaday tip line.
6. **GitHub Discussions is enabled** as the Q&A surface for the first external users.
7. **The S8 AI grounding has been smoke-tested** with the 7 representative queries.

What we are NOT shipping:
- Code-signed installers (paid certs deferred).
- Mac/Linux installers (cross-platform CI is an S10+ item).
- A Discord (GitHub Discussions is the v0.1 substitute).
- New DSP blocks beyond Noise + Constant (wavetable / FM / delay are S10+).
- MIDI input or polyphony (S10+).

---

## Capacity (solo)

| Person | Available | Allocation | Notes |
|---|---|---|---|
| You + Claude Code | ~20 hrs over 2 weeks | Plan to 70% = **~14 hrs** committed | Mostly small-piece work + user-actions; low risk |

---

## Sprint Backlog

| Pri | Item | Owner | Est | Dependencies |
|---|---|---|---|---|
| **P0** | **1. Default starter graph on first launch** — Oscillator → Output, with a one-line in-canvas hint "click ▶ Play to hear it." Loads only when there's no saved state in localStorage; once the user touches the canvas, never reappears. | Claude Code | 1–2 hrs | None |
| **P0** | **2. Noise block** — random 8-bit signed audio. Useful for snare drums, percussion, and noise-modulation effects. Pure Amaranth: an LFSR or a small PRNG. Single output port `audio-out`; no parameters. Add to backend `blocks/`, frontend `blocks/`, the BLOCK_REGISTRY, and the AI consultant's system prompt. | Claude Code | 1–2 hrs | None |
| **P0** | **3. Constant block** — emits a fixed 8-bit signed value. Useful as a DC offset, an ADSR test stimulus, a Mixer "ground" input, or a debugging probe. Single output port `audio-out`; one parameter `value` (-128 to 127, default 0). | Claude Code | 1 hr | None |
| **P0** | **4. Examples submenu in Load button** — when the user clicks Load, show two options: "Load from disk…" and "Open example →" submenu listing the bundled `examples/*.json` files (currently `two-osc-mix.json`, `adsr-pulse.json`). The example files are bundled via `extraResources` in [electron-builder.json](frontend/electron-builder.json) so the packaged app can read them. | Claude Code | 1–2 hrs | None |
| **P0** | **5. Help → About menu** — Electron native menu item. Modal shows: version (`0.1.0-alpha`), MIT license, "Built with Claude Code by a non-technical solo developer" tagline, link to the GitHub repo, link to the bundled CREDITS, BYOK note about how the API key is stored. | Claude Code | 1 hr | None |
| **P0** | **6. Pre-write `RELEASE-NOTES-v0.1.0-alpha.md`** at the repo root. One short paragraph framing what the alpha is + a feature checklist + the "unsigned installer triggers SmartScreen, click 'More info → Run anyway'" workaround + the link to ROADMAP.md for what's next. | Claude Code | 0.5 hrs | None |
| **P0** | **7. Pre-write announcement copy** in a single doc (`ANNOUNCEMENT-DRAFTS.md`, deleted after launch) covering: r/synthdiy, r/FPGA, Hacker News (Show HN), Hackaday tip line. Each draft is 2–4 sentences, self-contained, with the GitHub Release link as a placeholder. | Claude Code | 1 hr | None |
| **P0** | **8. Fresh-install smoke test** — install `ChipBlocks_0.1.0.exe` on the dev box (uninstall first if needed); launch from Start Menu; verify (a) starter graph appears, (b) Play produces audio, (c) Build for FPGA produces a bitstream zip, (d) AI chat responds when a key is configured, (e) Examples load. This is the "did the packaging actually work end-to-end" gate that S7 didn't fully verify. | You + Claude Code | 1 hr | Items 1–4 |
| **P0** | **9. Tag + push `v0.1.0-alpha`, attach installer to GitHub Release, post announcements** — `git tag v0.1.0-alpha && git push origin v0.1.0-alpha`, then `gh release create v0.1.0-alpha frontend/release/0.1.0/ChipBlocks_0.1.0.exe -F RELEASE-NOTES-v0.1.0-alpha.md`. After the release is live, post the announcements from `ANNOUNCEMENT-DRAFTS.md`. The actual **(E)**-unblocking action of the sprint. | You | 0.5 hrs | Items 6, 7, 8 |
| **P0** | **10. Capture 2–3 screenshots** — canvas with a multi-block graph, AI consultant chat with a real exchange, FPGA build success toast. Save to `docs/screenshots/` as PNG. Reference from README. | You | 1 hr | Items 1, 4 |
| **P0** | **11. Smoke-test the S8 AI grounding** with the 7 queries from [SPRINT-8.md](SPRINT-8.md) sprint goal. Note any failures and bring them back as input to S10's prompt iteration. | You | 0.5 hrs | None |
| **P0** | **12. Enable GitHub Discussions** on the repo — Settings → Features → check Discussions. Optional: pin a "Welcome / how to ask for help" thread. | You | 5 min | None |
| **P0** | **13. Sprint retrospective** | You | 1 hr | All |
| P1 | **14. Manual eval script** — Python or Node script that sends the 7 smoke-test queries to the Anthropic API (using the user's key) and grades each response against expected substrings. Output: a small report. Reusable for future prompt iterations. | Claude Code | 2–3 hrs | None |
| P1 | **15. IPC layer regression test** (carryforward; promoted from "drop" alongside the future CI work) | Claude Code | 2 hrs | None |
| P2 | **16. Wavetable, FM, or Delay block** — pick one as a stretch if time allows. Wavetable is highest-leverage. | Claude Code | 2–3 hrs | None |

**Planned committed work**: ~9–13 hrs of P0 (within the 14-hr 70% capacity envelope) · **Sprint Load**: ~65–95%

---

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **The fresh-install smoke test reveals a real bug** in the packaged app's IPC path or backend bundling | Item 9 blocks until it's fixed; possibly a multi-day fix | Time-box debugging to 4 hrs; if not resolved, ship the alpha *without* the FPGA build feature (mark it as "FPGA build coming in v0.1.1") rather than block the release indefinitely. The (E) metric matters more than feature completeness. |
| **Noise/Constant blocks feel like padding** rather than new capabilities | Wasted ~3 hrs of effort | Both have legitimate use cases (snare-drum percussion + DC-offset/test stimulus). Ship them, don't second-guess. |
| **The default starter graph confuses users** ("why is there already stuff here?") | Negative onboarding instead of positive | Add a one-line in-canvas hint "Sample graph — click ▶ Play to hear it" that's dismissible. If users still get confused after the alpha lands, iterate. |
| **The release announcement gets zero engagement** | Discouraging, but not actually a problem we can solve in this sprint | Set expectations: the goal is "tag the release + announce somewhere," not "go viral." Re-evaluate after 2 weeks of post-launch quiet. |
| **The user finds new sprint-9 P0 items** (something I can't anticipate) is more important than what's in the plan | Sprint scope creep | The P0 list above is the contract. New ideas go in ROADMAP.md's Next bucket; don't bolt them onto S9. |
| **GitHub Discussions feels too quiet to be useful as a Q&A surface** for one external user | Discoverability gap | Pin a "Welcome" thread with FAQ stubs. If the alpha gets traction and Discussions stays empty, switch to Discord in S11+. |
| **Smoke-testing the S8 AI grounding turns up regressions** I introduced | Need a prompt-iteration sprint | Capture the failures verbatim; treat as S10 input rather than blocking S9. |

---

## Definition of Done (per item)
- [ ] Code committed to git with a clear commit message
- [ ] Demoable to yourself with one or two commands (or one click for installed-app items)
- [ ] This `SPRINT-9.md` has a 1-paragraph entry in the Sprint Log
- [ ] You understand at a high level what it does

---

## Key Dates

| Day | Event |
|---|---|
| Day 1 | Items 1–5 (starter graph + Noise + Constant + examples menu + Help/About) |
| Day 2 | Items 6–7 (release notes + announcement drafts) |
| Day 3 | Item 8 (fresh-install smoke test); fix anything it surfaces |
| Day 4–5 | Items 9–12 (release tag + screenshots + S8 smoke test + Discussions) |
| Day 6–10 | Buffer for surprises; P1 work (manual eval script, IPC test) |
| Day 11–14 | Item 13 (retro), optional P2 (one DSP block as stretch) |

---

## Sprint 9 → Sprint 10 transition

If Sprint 9 ships, ChipBlocks v0.1.0-alpha is publicly tagged with the Windows installer attached and at least one announcement post is live. The **(E)** metric is finally measurable. **Sprint 10 candidates** (per [ROADMAP.md](ROADMAP.md) "Next" bucket):

- **MIDI input block + polyphony** — the flagship-domain unlock for synth makers (1.5–2 sprints).
- **Mac + Linux installer build pipeline** via GitHub Actions cross-platform CI (0.5–1 sprint).
- **2 more DSP blocks** — pick from {wavetable, FM, delay} (1 sprint, 2 blocks).
- **Tiny Tapeout submission package** — needs cohort timing check (1.5 sprints + cohort wait).
- **First Hackaday / Hackster.io writeup submission** — distribution attempt (1–2 days).

User direction at the end of S9 — same fork, but now with real launch-feedback data to inform it.

---

## Sprint Log

> Fill in as you go. One paragraph per completed item. Be honest about what didn't work.

### Item 1 — Default starter graph on first launch
*Pending.*

### Item 2 — Noise block
*Pending.*

### Item 3 — Constant block
*Pending.*

### Item 4 — Examples submenu in Load button
*Pending.*

### Item 5 — Help → About menu
*Pending.*

### Item 6 — Pre-write RELEASE-NOTES-v0.1.0-alpha.md
*Pending.*

### Item 7 — Pre-write announcement copy
*Pending.*

### Item 8 — Fresh-install smoke test
*Pending.*

### Item 9 — Tag + push v0.1.0-alpha, post announcements
*Pending — needs user action.*

### Item 10 — Capture screenshots
*Pending — needs user action.*

### Item 11 — Smoke-test S8 AI grounding
*Pending — needs user action.*

### Item 12 — Enable GitHub Discussions
*Pending — needs user action.*

### Item 13 — Sprint retrospective
*Pending.*

---

## Retrospective (end of sprint)

*To be filled in when the sprint closes.*

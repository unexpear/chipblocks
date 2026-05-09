# Contributing to ChipBlocks

Thanks for being interested. ChipBlocks is a solo-dev project at a "fine taking time" pace, but outside contributions are welcome — this guide is the on-ramp.

## Before you start

1. **Read [CLA.md](CLA.md)** and sign your commits with `git commit -s` to indicate you agree to it. We use a DCO-style sign-off (the same one the Linux kernel uses).
2. **Open an issue first** for anything beyond a typo fix or small bug. ChipBlocks's roadmap is opinionated (see [PRD.md](PRD.md) and [ROADMAP.md](ROADMAP.md)); a 5-minute conversation up front saves a 5-hour PR that doesn't fit the project's direction.
3. **Don't add a copyleft dependency.** The project ships only permissively-licensed code (MIT / Apache 2.0 / BSD / ISC / PSF). GPL, AGPL, LGPL, MPL, and EUPL are all banned in shipped code. See [CREDITS.md](CREDITS.md) for the policy. We can *invoke* GPL-licensed binary tools the user has installed (Yosys, nextpnr) but never bundle them.

## Local setup

Requirements: Node 20+ on the host OS, WSL2 Ubuntu (on Windows) or native Linux/macOS, Python 3.12+.

```bash
# Backend (in WSL2 on Windows; native on Linux/macOS):
cd backend
bash setup.sh
python3 -m pytest tests/ -v   # ~60 s, 48 tests

# Frontend (host OS):
cd frontend
npm install
npm test                      # ~10 s, 103 vitest tests
npx tsc --noEmit              # clean
npm run dev                   # hot-reload Electron dev mode
```

## Architecture

[ARCHITECTURE.md](ARCHITECTURE.md) is the canonical "where things live and how they talk" doc. It covers:

- The high-level process model (Electron main / sandboxed renderer / WSL2 / Python backend).
- The IPC contract surfaces (`window.chipblocks` and `window.ai`).
- The 8-file cookbook for adding a new block.
- The build-target system (FPGABoard profiles for FPGA, separate `tinytapeout.py` for ASIC submission).
- Testing layout (pytest in `backend/tests/`, vitest in `frontend/test/`).

Read it before any non-trivial change.

## Commit style

Plain English explanations of *what* changed and *why*. Avoid unexplained jargon ("RTL," "synthesis," "place-and-route") on first use — see [CLAUDE.md](CLAUDE.md)'s communication-style notes. The user is non-technical; commit messages are for them too.

Pattern:

```
<short imperative title>

<one-paragraph what + why>

<optional: notable trade-offs, deferrals, related issues>

Co-Authored-By: <your name> <your email>   (if pair-coded)
```

Small, single-purpose commits. One feature or fix per commit. **No `--no-verify`** — if pre-commit hooks fail, fix the underlying issue.

## Tests

- **Anything new** should come with at least one test.
- **Block changes** must keep `pytest backend/tests/test_blocks.py` and `vitest test/blocks.test.tsx` green.
- **IPC changes** must keep `vitest test/ipc-contract.test.ts` green; if you change the contract, update the mock in `test/setup.ts` and the type in `frontend/src/types/ipc.ts`.
- **Save-format changes** must bump `SAVE_VERSION` and keep the `vitest test/save-load.test.tsx` roundtrip green.

CI runs both suites on every push to master; the cross-platform release pipeline runs on tag push (`v*`). See `.github/workflows/`.

## Adding a new block

The full cookbook is in [ARCHITECTURE.md](ARCHITECTURE.md). Quick sketch:

1. `backend/blocks/<name>.py` — Amaranth Elaboratable
2. `backend/blocks/__init__.py` — register in BLOCK_REGISTRY
3. `backend/synth.py` — params switch case
4. `frontend/src/blocks/<Name>Node.tsx` — React Flow node
5. `frontend/src/blocks/index.ts` — register in nodeTypes + AppNode
6. `frontend/src/Palette.tsx` — palette entry + defaults
7. `frontend/src/App.css` — `.block-<name>` border
8. `frontend/src/ai/prompt.ts` — block-library reference + tool schemas
9. Tests: `backend/tests/test_blocks.py` + `frontend/test/blocks.test.tsx`

The 8-files-per-block cost is tracked as tech-debt item A1 — when block growth slows, we'll likely refactor to a single block-manifest file. Until then, follow the existing pattern.

## Adding a new build target

If you want to add a new FPGA board (e.g. iCEBreaker, Upduino, HX8K-EVB):

1. Define a new `FPGABoard(...)` instance in `backend/build.py`.
2. Add it to `ALL_BOARDS`.
3. Add a `BuildTargetOption` entry in `frontend/src/App.tsx`'s `BUILD_TARGETS` array.

The IPC handler doesn't need to know about new targets — it parses the bundle filename out of `build.py`'s `[bundle] <basename>` stdout marker.

ASIC paths (eFabless, IHP, GF180) should mirror `backend/tinytapeout.py`'s shape — sources-only, no local PnR.

## Accessibility

ChipBlocks targets WCAG 2.1 AA. Last full audit: [ACCESSIBILITY-AUDIT-2026-05-08.md](ACCESSIBILITY-AUDIT-2026-05-08.md). Re-run when adding new colors / modals / interactive components, or before any v0.2+ release. Manual NVDA + VoiceOver testing is required before any major release.

## License + permissive-only policy

By contributing, you agree your contribution is licensed under MIT (the project's license — see [LICENSE](LICENSE)) and that you have the right to license it that way (the CLA / DCO sign-off codifies this).

Every new dependency you add must be permissively licensed. PRs that add GPL/AGPL/LGPL/MPL/EUPL deps will not be merged. If the dep is build-time-only and clearly stays out of the runtime artifact (e.g. a build tool), call it out explicitly so we can verify before merging.

## Where to ask

- **GitHub Discussions** for questions, design proposals, "is this a good idea?" — preferred for anything that could become a thread.
- **GitHub Issues** for confirmed bugs and concrete feature requests.
- **PR comments** for code-level feedback once a change is in flight.

This is a solo-developer project at a "fine taking time" pace. Issue triage and PR review may take a few days. Sprint cadence is two weeks (see [SPRINT-N.md](SPRINT-1.md) files for prior sprints + retrospectives).

## Code of conduct

Be kind. The project's whole reason for existing is to make chip design accessible to people who've been told they can't do it. Don't be a person who tells others they can't do it.

# Known Issues

Tracked issues that haven't been fixed yet, with rationale for why they're deferred. Each entry has an owner action; when one of these is fixed, delete its entry rather than crossing it out.

## NPM advisories — three remaining (post-S7 upgrade)

After Sprint 7's electron 33→38, electron-builder 24→26, vitest 2→3 bumps, three advisories remain. All require *another* major-version bump. Resolution deferred because:
- The affected APIs are not used by ChipBlocks (offscreen rendering, clipboard image read, named-window scoping)
- The dev-server-only esbuild advisory affects an interface we never expose to the network (Vite binds 127.0.0.1 by default)

| Direct dep | Current | Audit-suggested fix | Bump type | Why deferred |
|---|---|---|---|---|
| `electron` | `^38.0.0` | `electron@42+` | major | Advisories are around offscreen child windows, offscreen shared-texture release, clipboard image parsing, and named-window opener scoping. None of these surfaces are reached by ChipBlocks (no offscreen rendering, no clipboard reads, no `window.open` usage). |
| `vite` (transitive `esbuild`) | `^5.4.11` | `vite@8` | major | The esbuild dev-server CORS issue only affects an attacker who can reach the dev server. Vite binds `127.0.0.1:7777` (per `package.json#debug.env.VITE_DEV_SERVER_URL`); not reachable from outside the dev machine. |

**Action**: bundle into a future "deps refresh" sprint. Lower priority than user-facing work.

## vitest 4 + Vite 6 upgrade deferred

Sprint 7 took vitest 2→3 but stopped before vitest 4 because vitest 4 hard-requires Vite ≥ 6, and Vite 5→6 has its own breaking-change surface (`vite-plugin-electron` compatibility, the new `Environment API`, dropped Node-18 support).

**Action**: bundle vitest 3→4 + Vite 5→6 into a single dedicated upgrade sprint. There are no real tests yet, so the impact is bounded by config compatibility, not test-file rewrites.

## Electron-builder transitively pulls `7zip-bin` (LGPL-2.1)

Documented in [CREDITS.md](CREDITS.md). `7zip-bin` is build-time only — not present in the distributed runtime — so the LGPL terms don't apply to ChipBlocks' shipped binary. If `electron-builder` ever changes that, we'd need to revisit.

**Action**: monitor on every electron-builder major upgrade.

## Random-jitter for AI-placed nodes is a heuristic, not a layout engine

`canvasActions.addNode` places new nodes to the right of the existing rightmost node with a small vertical jitter. For complex multi-block AI sessions, blocks tile to the right and the user has to drag for cleanup. A real auto-layout (e.g. ELK or dagre) would compute an actual graph layout.

**Action**: future-sprint upgrade. Low priority while the AI consultant is producing typical 1–4-node additions.

## Unsigned Windows installer triggers SmartScreen

The v0.1.0-alpha Windows NSIS installer is unsigned (no code-signing certificate was used at build time). On first run, Windows SmartScreen will warn "Windows protected your PC" and the user must click "More info → Run anyway."

**Action**: acquire an EV (Extended Validation) or OV (Organization Validation) Windows code-signing certificate ($150–$500/yr) and configure `electron-builder.json#win.signtoolOptions`. Deferred until there's any external user demand for it.

## Mac and Linux installers not shipped

Sprint 7 only built the Windows installer because the dev machine is Windows. Mac and Linux targets are configured in `electron-builder.json#mac` and `extraResources` already targets the right paths, so a build on a Mac or Linux box would produce the corresponding installers — but no machine to verify on.

**Action**: build + verify on a Mac and a Linux box if a user files an issue asking for one.

## P1 carryforwards (5 sprints stale)

Two items have been carried forward from Sprint 3 → 4 → 5 → 6 → 7 without ever shipping:

- **Cached audio output in save format** — re-rendering audio every time someone reopens a saved graph is slow. The save format would carry a base64-encoded WAV alongside the graph.
- **IPC layer regression test** — the IPC bridge between renderer ↔ main ↔ WSL2 ↔ Python has no automated test. Each sprint manually verifies it didn't regress.

Both were P1 in S3-S7 but never beat the next P0. At this point they're either truly low-value (and should be dropped) or genuinely worth a P0 slot in a future sprint. Calling out the deferral pattern explicitly.

**Action**: at the start of S8, decide: drop, or promote one to P0.

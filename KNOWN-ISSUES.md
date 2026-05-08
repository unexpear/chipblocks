# Known Issues

Tracked issues that haven't been fixed yet, with rationale for why they're deferred. Each entry has an owner action; when one of these is fixed, delete its entry rather than crossing it out.

## NPM advisories — major-version-bump required (15 advisories, frontend)

`npm audit` reports 15 advisories (4 low, 5 moderate, 6 high) in `frontend/`. **All require major-version bumps** (`npm audit fix --force` would do them, but with breaking-change risk). `npm audit fix` without `--force` had nothing to apply.

Affected upstream packages:
| Direct dep | Current | Audit-suggested fix | Bump type |
|---|---|---|---|
| `electron` | `^33.2.0` | `electron@38+` | major |
| `electron-builder` | `^24.13.3` | `electron-builder@26.8.1` | major |
| `vitest` | `^2.1.5` | `vitest@4.1.5` | major |

Most of the high-severity items are inside Electron itself (ASAR integrity bypass, AppleScript injection on macOS, service-worker IPC spoofing, origin-permission handling) and primarily affect packaged production builds. ChipBlocks is currently pre-public-release and runs in dev mode, so the practical risk is low.

**Action**: a future dedicated upgrade sprint should run `npm audit fix --force`, work through the breaking changes, and re-verify the dev server, the IPC bridge, and the Anthropic SDK integration. Treat as one of the gates to a public alpha release.

## Electron-builder transitively pulls `7zip-bin` (LGPL-2.1)

Documented in [CREDITS.md](CREDITS.md). `7zip-bin` is build-time only — not present in the distributed runtime — so the LGPL terms don't apply to ChipBlocks' shipped binary. If `electron-builder` ever changes that, we'd need to revisit.

**Action**: monitor on every electron-builder major upgrade.

## Random-jitter for AI-placed nodes is a heuristic, not a layout engine

`canvasActions.addNode` places new nodes to the right of the existing rightmost node with a small vertical jitter. For complex multi-block AI sessions, blocks tile to the right and the user has to drag for cleanup. A real auto-layout (e.g. ELK or dagre) would compute an actual graph layout.

**Action**: future-sprint upgrade. Low priority while the AI consultant is producing typical 1–4-node additions.

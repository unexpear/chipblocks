# ui-checks — app-aware click-through checks for the ChipBlocks renderer

Playwright drives the renderer in the browser-only dev server (`vite.renderer.config.ts`) through
real user workflows. The runner knows the app: `map/app-map.json` describes every screen it
visits (how to reach it, its ready signal, the region to read, its controls and what they do, its
invariants), and `workflows/*.json` are built from that map. **Coded asserts decide pass/fail.**
The ~6000 vitest tests stay the deterministic unit/integration layer; this suite covers what they
can't: clicking through the real UI.

## Run

```sh
npx playwright install chromium     # once per machine (Playwright-managed browser)
npm run ui-checks:fast              # every workflow, Laya off (the CI-friendly run)
npm run ui-checks                   # every workflow; Laya advisor too if it is configured
node ui-checks/src/run.mjs --workflow gerber-check-led      # one workflow (comma-separate for more)
node ui-checks/src/run.mjs --list                           # workflow names
```

The runner starts `vite --config vite.renderer.config.ts --port 5180` itself when nothing is
listening on `--url` (default `http://localhost:5180/`) and stops it at the end (`--keep-server`
leaves it running). Other flags: `--headed`, `--out <dir>`, `--repo <path>`,
`--chrome <exe>` / `CHROME_EXE` (use a specific browser instead of the managed one).
Exit code: 0 = no failures (skips and known issues don't count), 1 = failures, 3 = runner aborted.

Output goes to `ui-checks/runs/<timestamp>/` (git-ignored): `report.md` + `report.json` with one
PASS / FAIL / KNOWN / SKIP line per step and its reason, timings, Laya answers, and for every
failure `artifacts/<workflow>/<step>.png`, `.panel.txt` (region text + accessibility snapshot),
`.dom.html` and `.console.txt`.

## What it covers

| workflow | what |
|---|---|
| start-to-new-circuit | start screen, Create disabled until a template is picked, custom name, tab round trip, close tab |
| led-circuit-simulate | LED template (4 parts, 4 wires, 3 nets), Math panel converged (`data-converged`), LED ≈ 2 V / 20 mA, Ohm's law, KCL balanced, Solve with Always on off |
| test-bench | save a check, run → PASS with the actual value, wrong expectation → NOT PASSED, remove |
| part-picker-search-place | picker dialog, sections, search narrows, Enter / Place place parts, Ctrl+Z / Ctrl+Y, no-match, Esc clears then closes |
| pcb-led-panel | `pcb-summary` (data-placed / data-routed / data-drc), DRC clean, Export ZIP enabled with the right tooltip, Board header agrees |
| pcb-export-logic | empty board → Export disabled with the reason, one part, good board → enabled, Export click passes validation |
| gerber-check-led | Gerber check at 1600×1000: plot drawn, no refusal, 9 layer tabs, hidden empty bottom files, benign footer, every control actually clickable |
| gerber-layers | each layer tab (`aria-pressed`, `gerber-counts`, FileFunction / polarity), Stack, zoom + / − / Fit, toggle off |
| gerber-blank | empty board → honest empty state, no refusal |
| content-manager | six PLANNED catalog rows, no installed badges, honesty notes, no registry configured, bridge-less Install message, Close / backdrop, no stray dialog on other screens |
| shortcuts | Ctrl+K opens, defaults (`shortcut-row` data-binding), bare key refused, duplicate refused, Ctrl+J accepted and works, Esc cancels, Reset |
| board-workspace | Blank board opens the Board workspace |
| voltage-divider | Math: 500 µA × 10.00 kΩ = 5.00 V, converged |
| my-projects | My Projects category (the rest is Electron-only) |
| cross-screen-panels | panels open only on the screen on display, and a rebind reaches every open tab |

After every step the runner also checks that screen's invariants (from the map) and a global
crash watch (error boundary absent, root rendered). Any `console.error` or uncaught page error
fails the step (the dev server's favicon 404 is the one allow-listed message, and only when its
URL really is `/favicon.ico`).

**Skipped (needs Electron, reported as SKIP with the reason):** writing the manufacturing ZIP
(`saveFabZip`; the validation half is still checked), opening / listing saved projects, user
templates, installed content packs and their badges / enable / uninstall, keybind persistence
across restarts and native-menu accelerators, native menus and file exports, AI chip description.
The Shortcuts and Content Manager panels are reached through the same window events `main.tsx`
broadcasts from the native menus.

## How it drives

- Waits on ready signals from the map, never on sleeps; asserts poll up to 5 s.
- Clicks are hit-tested (`elementFromPoint`) first; a covered or off-screen control is reported
  as `unreachable` with what covers it. Up to 3 attempts with backoff.
- Fresh browser context per workflow. Hidden (display:none) project tabs are ignored.
- Failure categories: `assert` / `invariant` (the app didn't do what the map says),
  `unreachable`, `console`, `crash`, `precondition`, `driver` (the runner couldn't drive — should
  be zero).

## Known issues

A step can carry `"knownIssue": "<short id or link>"`. If it still fails, it is reported as
KNOWN with full evidence but does **not** fail the run; if it passes, the report says the tag can
be removed. No step is tagged right now.

## Laya advisor (optional)

Laya can grade a screen's panel text alongside the asserts. It never gates: it only raises a
"take a look" note when it disagrees with an assert at confidence ≥ 0.9. It is off unless a
sidecar is configured:

```sh
LAYA_SIDECAR=/path/to/laya_sidecar.py LAYA_PYTHON=/path/to/python npm run ui-checks
# or: node ui-checks/src/run.mjs --laya-sidecar <script> --laya-python <python>
```

One warm sidecar per run; one batched request per checkpoint with all of that screen's
questions; English model; panel text only, known-benign text removed, capped at 1200 chars
(`--laya-raw` keeps the benign text). `--no-laya` forces it off.

## Files

| path | what |
|---|---|
| `map/app-map.json` | screens, controls, ready signals, regions, invariants, Laya questions, macros, crash watch, alarm words + known-benign text, console allow-list, Electron-only features, remaining data-testid wishlist |
| `workflows/NN-name.json` | steps: `pre` → `do` → `expect`; `screen` adds that screen's invariants; `laya: true`; `requires: ["electron:…"]`; `independent`, `continueOnFail`, `knownIssue` |
| `src/run.mjs` | CLI, dev-server lifecycle, step loop |
| `src/engine.mjs` | selectors, regions, polling asserts, hit-tested clicks, console watch, artifacts, Laya checkpoint |
| `src/laya.mjs` | Laya sidecar client |
| `src/report.mjs` | Markdown + JSON report |

Selectors: `"screen.control"` refs, `{role, name | nameRe, exact, within}`, `{testid, textIs}`,
`{text | textRe}`, `{css}`, `{label}`; `{placeholders}` filled from a step's `with`.
Regions: `{locator}`, `{anchor, contains, up}`, `{leafRe}`.
Asserts: visible, absent, count, enabled, disabled, checked, pressed, focused, value, attr,
attrNumber, text, numbers, clickable, noAlarms, not, all, any, implies, iff, equalsVar.
Actions: open, macro, waitReady, ifVisible, goto, click, dblclick, fill, select, type, press,
dispatch, waitFor, capture, setViewport, mouseClickAt.

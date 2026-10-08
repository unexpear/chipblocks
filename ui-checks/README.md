# ui-checks — app-aware click-through checks for ChipBlocks

Playwright drives ChipBlocks through real user workflows in two targets: the renderer in the
browser-only dev server (`vite.renderer.config.ts`, the default), and the real Electron app
(`--target electron`, see [Electron mode](#electron-mode)). The runner knows the app: `map/app-map.json` describes every screen it
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
node ui-checks/src/run.mjs --list                           # workflow names and targets
npm run ui-checks:electron          # the Electron workflows against the real app (Laya off)
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

Browser target (default):

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
| hover-help | hover a tool, a palette part, disabled Export ZIP, a Gerber layer tab, a catalog badge, and the registry URL; the tip names each one and goes away on mouse-out |
| hover-help-screens | hover one control on the meter, scope, timeline, canvas, close-project, project browser, Verilog, footprint and part editors, inspector, Bode, reflection, distortion, stress, clipboard, symbol editor, hierarchy, plan, chip, FPGA report, and board 3D; the tip names it and goes away on mouse-out |

After every step the runner also checks that screen's invariants (from the map) and a global
crash watch (error boundary absent, root rendered). Any `console.error` or uncaught page error
fails the step (the dev server's favicon 404 is the one allow-listed message, and only when its
URL really is `/favicon.ico`).

**Skipped in the browser target (needs Electron, reported as SKIP with the reason and the
Electron workflow that covers it):** writing the manufacturing ZIP (`saveFabZip`; the validation
half is still checked), opening / listing saved projects, user templates, installed content packs
and their badges, keybind persistence across restarts, FPGA chip description files (File ▸ Read an
FPGA Chip File…; offline, no network or API key). The Shortcuts and Content Manager panels are
reached through the same window events `main.tsx` broadcasts from the native menus.

Electron target (`npm run ui-checks:electron`):

| workflow | what |
|---|---|
| electron-native-menus | sandbox verified at launch; File / Edit / Settings / Tools / Shortcuts menu structure and accelerators; canvas-only File items grey on the launcher; Tools ▸ Plugin & Content Manager and Shortcuts ▸ View / Change open the panels; Edit ▸ Select All / Copy / Paste / Undo / Redo on the LED circuit; File ▸ Export Netlist… (save dialog default name + filter, file written, report card); cancelling Export Netlist, Export Verilog, and Export GDS writes nothing and shows no export card; Settings ▸ Theme ▸ Slate (radio checked, `--surfaceBase` changes) survives a relaunch |
| electron-save-open-projects | first Save asks (Documents/UicLed.chipblocks, JSON: format, 4 nodes, 4 wires, window title); second Save is silent and rewrites (5 nodes); Save As to Desktop; My Projects lists both (scan count); open a file from elsewhere via the open dialog; recent list; reopen; a broken file is refused with an error box; the list survives a relaunch |
| electron-user-templates | File ▸ Save as Template → toast + `~/.chipblocks/user-templates.json`; listed under My templates ("4 parts · schematic"); survives a relaunch; start a project from it; delete asks to confirm, then empties the file |
| electron-content-packs | three packs built at test time with a throwaway ed25519 key (signed MIT, signature broken after signing, GPL-3.0); signed install from a local file → ENABLED badge, trust note, `libraries/<id>/pack.json` + `index.json` (valid-untrusted / match); bad signature and copyleft refused; disable / enable badges; the pack's part in the picker; survives a relaunch; tampered pack.json → `ENABLED · NOT LOADED` + SHA-256 mismatch note; uninstall |
| electron-keybind-persistence | rebind Shortcuts panel → Ctrl+J and Rotate → T; `userData/keybinds.json` and the native menu accelerator follow; relaunch; Ctrl+K is dead and Ctrl+J opens the panel; Reset; defaults survive a relaunch |
| electron-fab-zip | PCB panel on the LED circuit; cancelled Export ZIP writes nothing; Export ZIP saves through the dialog with the "manufacturing ZIP saved — …" note; the ZIP is parsed (central directory, sizes, CRC-32): copper/mask/silkscreen/Edge_Cuts Gerbers with FileFunction, the PTH Excellon drill (`M48`), job file, BOM, placement, netlist, validation report, README, stackup, none empty |
| electron-fpga-chip-description | File ▸ Read an FPGA Chip File… on the repo's iCE40-384 fixture: refusal asking for the chip description, choose it (open dialog title), decoded card, remembered in `~/.chipblocks/fpga-chip-descriptions.json`, asked once on reopen, remembered after a relaunch |

**Not covered by either target** (listed in `map.electron.notCovered` and in the Electron report):
the other imports / exports and Compile to iCE40 (listed and reachable, not driven end to end),
View-menu window roles, accelerators delivered by the OS menu (checked on the menu items instead),
the look of real native dialogs (stubbed), writing a publisher pin and installing from a
registry index (a local signed pack's fingerprint and untrusted state are checked; the Trust
click and the registry download are not driven), and the packaged electron-builder build.

## Electron mode

```sh
npm run ui-checks:electron                                   # = run.mjs --target electron --no-laya
node ui-checks/src/run.mjs --target electron --workflow electron-fab-zip --keep-sandbox
```

- **Build.** The runner launches the built app in `out/` (`out/main/main.js`, renderer over
  `file://` with the production CSP), not a dev server. It runs `npx electron-vite build` (~20 s)
  first when `out/` is missing or older than anything in `electron/`, `src/`, `schemas/`,
  `electron.vite.config.ts` or `package-lock.json`. `--build` forces a rebuild, `--no-build` uses
  `out/` as is. The repo's own `electron` package is the binary.
- **Isolation, no app hook.** Each workflow gets a fresh `os.tmpdir()/chipblocks-uic-*` sandbox.
  `src/isolate.cjs` is preloaded into the main process (`electron -r isolate.cjs .`) and calls
  `app.setPath` for home, appData, userData, documents, desktop and downloads before
  `electron/main.ts` runs (it throws if `CHIPBLOCKS_UIC_SANDBOX` is missing rather than fall back);
  `HOME` / `USERPROFILE` point at the sandbox too. After launch the runner reads every guarded path
  back from the main process and kills the app before any step if one is outside the sandbox. So
  the real `~/.chipblocks`, keybinds and localStorage are never read or written. Nothing in
  `electron/` was changed for testing. The sandbox is deleted afterwards; it is kept (path in the
  report) when a workflow fails or with `--keep-sandbox`.
- **Dialogs.** `dialog.showOpenDialog` / `showSaveDialog` are replaced in the main process with a
  queue filled by the `dialog` action; a dialog nothing was queued for is answered "cancel" and
  fails the step. `showErrorBox` / `showMessageBox` are recorded, never shown; one fails the step
  unless the step asserts it with `dialogs`.
- **Native menus.** `menu: "File ▸ Export Netlist"` clicks the real `MenuItem` in the main process
  (disabled items are refused) and then waits two animation frames, since a person can't pick two
  menu items in one frame. `menuItem` asserts read label, enabled, checked, accelerator and submenu.
- **Restart.** `relaunch` closes the app and starts it again on the same sandbox.
- Window: 1440×900 content (`map.electron.window`), background throttling off. Workflows carry
  `"targets": ["electron"]`; browser workflows have no `targets` (= browser) and are not run in
  Electron mode.

## How it drives

- Waits on ready signals from the map, never on sleeps; asserts poll up to 5 s.
- Clicks are hit-tested (`elementFromPoint`) first; a covered or off-screen control is reported
  as `unreachable` with what covers it. Up to 3 attempts with backoff.
- Fresh browser context (browser) or fresh app + sandbox (Electron) per workflow. Hidden
  (display:none) project tabs are ignored.
- Failure categories: `assert` / `invariant` (the app didn't do what the map says),
  `unreachable`, `console` (in Electron also main-process errors, prefixed `[main]`), `crash`,
  `dialog` (an unexpected error / message box or unqueued file dialog), `precondition`, `driver`
  (the runner couldn't drive — should be zero).

## Known issues

A step can carry `"knownIssue": "<short id or link>"`. If it still fails, it is reported as
KNOWN with full evidence but does **not** fail the run; if it passes, the report says the tag can
be removed.

None are open. Cancelling File ▸ Export Netlist… used to show "Exported N parts to a netlist"
(`export-report-ignores-cancel`); that step is now a normal assert, and Export Verilog and Export
GDS are cancelled the same way.

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
| `workflows/NN-name.json` | `targets` (default `["browser"]`); steps: `pre` → `do` → `expect`; `screen` adds that screen's invariants; `laya: true`; `requires: ["electron:…"]`; `target` + `targetNote` (skip a step on the other target); `independent`, `continueOnFail`, `knownIssue` |
| `src/run.mjs` | CLI, dev-server / Electron lifecycle, step loop |
| `src/electron.mjs` | build check, sandbox, `_electron` launch, isolation check, dialog stubs, native menu access |
| `src/isolate.cjs` | main-process preload that points every app folder at the sandbox |
| `src/pack-fixture.mjs` | content packs signed with a throwaway in-memory ed25519 key |
| `src/zip.mjs` | dependency-free ZIP reader (central directory, inflate, CRC-32) |
| `src/engine.mjs` | selectors, regions, polling asserts, hit-tested clicks, console watch, artifacts, Laya checkpoint |
| `src/laya.mjs` | Laya sidecar client |
| `src/report.mjs` | Markdown + JSON report |

Selectors: `"screen.control"` refs, `{role, name | nameRe, exact, within}`, `{testid, textIs}`,
`{text | textRe}`, `{css}`, `{label}`; `{placeholders}` filled from a step's `with`.
Placeholders also take the Electron paths `{sandbox}`, `{home}`, `{userData}`, `{files}`, `{out}`
and the repo's `{fixtures}`.
Regions: `{locator}`, `{anchor, contains, up}`, `{leafRe}`.
Asserts: visible, absent, count, enabled, disabled, checked, pressed, focused, value, attr,
attrNumber, text, numbers, clickable, noAlarms, not, all, any, implies, iff, equalsVar;
Electron: menuItem, windowTitle, dialogs (this step's), file (exists / size / regex / JSON paths),
zip (entries by name, size, first bytes, content).
Actions: open, macro, waitReady, ifVisible, goto, click, dblclick, fill, select, type, press,
dispatch, waitFor, capture, setViewport, mouseClickAt, settle; Electron: menu, dialog
(`open` / `save` / `cancel`), relaunch, writeFile, editFile, makePack (all writes stay inside the
sandbox). `goto` reloads the window in Electron.

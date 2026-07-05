# Third-Party Licenses

ChipBlocks depends on third-party software. This file lists each direct dependency, its license, copyright holder, source repository, and where to find the full license text. ChipBlocks complies with each license's redistribution requirements (preserving LICENSE files, preserving NOTICE content where present per Apache-2.0 §4(d), retaining attribution notices).

> **Last verified:** 2026-07-05 — re-checked; the board-road toolchain (footprint model, copper router, DRC, Gerber/Excellon writers, manufacturing ZIP) and the from-scratch 3-D board engine added **NO new dependencies** (all original TypeScript). The dependency set is unchanged since the Sprint 18 Electron/React/React-Flow additions below. Originally added during v3 Sprint 12 when `mathjs` brought the first NOTICE-bearing dependency.

---

## Direct dependencies (declared in `package.json`)

### Development tooling

#### TypeScript
- **Package:** `typescript` ^6.0.3
- **License:** Apache-2.0
- **Copyright:** Microsoft Corporation
- **Source:** <https://github.com/microsoft/TypeScript>
- **License text:** `node_modules/typescript/LICENSE.txt` after `npm install`
- **Third-party notices:** `node_modules/typescript/ThirdPartyNoticeText.txt` — 193 lines documenting third-party code TypeScript itself incorporates (DefinitelyTyped, Unicode, WebGL). **Not §4(d)-binding on ChipBlocks** because TypeScript is a dev-time-only tool: the compiler runs at build time and only its compiled JavaScript output would ship in the eventual Electron binary; TypeScript itself is never redistributed in ChipBlocks's product. Acknowledged here for audit honesty.
- **Usage tier:** dev-time only (build-time compiler; no runtime presence in shipped artifacts)

#### Vitest
- **Package:** `vitest` ^4.1.8
- **License:** MIT
- **Copyright:** Anthony Fu and contributors
- **Source:** <https://github.com/vitest-dev/vitest>
- **License text:** `node_modules/vitest/LICENSE.md` after `npm install`

#### Biome
- **Package:** `@biomejs/biome` ^2.4.16
- **License:** MIT OR Apache-2.0 (dual — either grant satisfies)
- **Copyright:** Biomejs project contributors (with upstream Rome attribution preserved)
- **Source:** <https://github.com/biomejs/biome>
- **License text:** `node_modules/@biomejs/biome/LICENSE-MIT` + `LICENSE-APACHE` after `npm install`
- **Attribution preserved:** `ROME-LICENSE-MIT` (original Rome project)

#### Ajv
- **Package:** `ajv` ^8.20.0
- **License:** MIT
- **Copyright:** Evgeny Poberezkin
- **Source:** <https://github.com/ajv-validator/ajv>
- **License text:** `node_modules/ajv/LICENSE` after `npm install`

#### ajv-formats
- **Package:** `ajv-formats` ^3.0.1
- **License:** MIT
- **Copyright:** Evgeny Poberezkin and contributors
- **Source:** <https://github.com/ajv-validator/ajv-formats>
- **License text:** `node_modules/ajv-formats/LICENSE` after `npm install`

#### yaml
- **Package:** `yaml` ^2.9.0
- **License:** ISC
- **Copyright:** Eemeli Aro
- **Source:** <https://github.com/eemeli/yaml>
- **License text:** `node_modules/yaml/LICENSE` after `npm install`

#### @types/node
- **Package:** `@types/node` ^25.9.1
- **License:** MIT (DefinitelyTyped collective)
- **Copyright:** DefinitelyTyped contributors
- **Source:** <https://github.com/DefinitelyTyped/DefinitelyTyped>
- **License text:** `node_modules/@types/node/LICENSE` after `npm install`

### Physics / math (Sprint 12+)

#### mathjs
- **Package:** `mathjs` 15.2.0
- **License:** **Apache-2.0** — NOTICE file preserved at project-root [NOTICE](NOTICE) per §4(d)
- **Copyright:** Copyright (C) 2013-2026 Jos de Jong
- **Source:** <https://github.com/josdejong/mathjs>
- **License text:** `node_modules/mathjs/LICENSE` after `npm install`
- **NOTICE text:** `node_modules/mathjs/NOTICE` (also reproduced in project-root NOTICE)
- **Used for:** expression parsing + dimensional unit checking in `src/equation-evaluator.ts` (per OBJECT-MODEL.md §16)

### Frontend / canvas (Sprint 18+)

All MIT; none ship a NOTICE file (verified 2026-06-06 via `ls node_modules/<pkg>/NOTICE*`). Runtime (`dependencies`): react, react-dom, @xyflow/react. Build/dev (`devDependencies`): electron, electron-vite, vite, @vitejs/plugin-react, @types/react, @types/react-dom.

| Package | Version | License | Role | Source |
|---|---|---|---|---|
| `react` | ^19.2 | MIT | UI framework (renderer) | <https://github.com/facebook/react> |
| `react-dom` | ^19.2 | MIT | DOM renderer | <https://github.com/facebook/react> |
| `@xyflow/react` (React Flow) | ^12.11 | MIT | canvas engine | <https://github.com/xyflow/xyflow> |
| `electron` | ^42.3 | MIT | desktop shell | <https://github.com/electron/electron> |
| `electron-vite` | ^5.0 | MIT | Electron + Vite build integration | <https://github.com/alex8088/electron-vite> |
| `vite` | ^7.3 | MIT | renderer bundler (pinned to 7 for electron-vite compat) | <https://github.com/vitejs/vite> |
| `@vitejs/plugin-react` | ^5.2 | MIT | React JSX + fast-refresh | <https://github.com/vitejs/vite-plugin-react> |
| `@types/react`, `@types/react-dom` | ^19 | MIT | types (DefinitelyTyped) | <https://github.com/DefinitelyTyped/DefinitelyTyped> |

**Electron's bundled components.** Electron itself is MIT, but it bundles Chromium (BSD-3-Clause + many sub-licenses) and Node.js (MIT). Electron ships a `LICENSES.chromium.html` enumerating all bundled third-party licenses; when ChipBlocks is packaged into a distributable (electron-builder, a later sprint), that file travels with the app per Electron's redistribution terms. No GPL/AGPL in the bundled set — Chromium and Node are permissive. This is a ship-time obligation handled at packaging; the Sprint 18 MVP runs via `npm run dev` and doesn't redistribute.

---

## Transitive dependencies introduced by mathjs

All 9 transitive deps mathjs pulls in are MIT-licensed (verified 2026-06-05 via `node -e "require('./node_modules/<pkg>/package.json').license"`):

| Package | License | Author / Source |
|---|---|---|
| `@babel/runtime` | MIT | Babel contributors |
| `complex.js` | MIT | Robert Eisele |
| `decimal.js` | MIT | MikeMcl |
| `escape-latex` | MIT | Tyler Stewart |
| `fraction.js` | MIT | Robert Eisele |
| `javascript-natural-sort` | MIT | Jim Palmer |
| `seedrandom` | MIT | David Bau |
| `tiny-emitter` | MIT | Scott Corgan |
| `typed-function` | MIT | Jos de Jong |

All transitive LICENSE files available at `node_modules/<pkg>/LICENSE` after `npm install`.

---

## Other notable transitive deps (carried in pre-Sprint-12 audit)

The pre-mathjs full transitive audit (deep-research 2026-06-05) found `lightningcss` (MPL-2.0) as a deeper transitive via Vite → Vitest. MPL-2.0 is file-level copyleft and is on the permissive whitelist (CLAUDE.md principle 4). See [LEGAL-CONSIDERATIONS.md](LEGAL-CONSIDERATIONS.md) §1 for the rationale.

The integration audit (2026-06-16) also noted `caniuse-lite` (CC-BY-4.0), carried transitively via browserslist → Vite. CC-BY-4.0 is a **content/data** license — it covers browser-support data tables, not software — and the package is build-time only (browserslist reads it while bundling the renderer); none of its data ships in the product. It is thus outside the code whitelist *by kind* rather than in violation of it. Noted here for an exhaustive accounting.

---

## Dev-time vs runtime distinction

Apache-2.0 §4(d) obligations on ChipBlocks attach only to deps that travel with the shipped product. The audit distinguishes:

- **Dev-time-only deps** (TypeScript compiler, Biome linter, Vitest runner, Ajv schema-validator-at-test-time, etc.) — used during development and CI. None of these ship inside the eventual Electron binary; only their *output* (compiled JS, lint-clean source, passing tests) does. Apache-2.0 §4(d) doesn't bind ChipBlocks to surface their NOTICE content in the shipped product.
- **Runtime deps** (mathjs as of Sprint 12, plus any future deps required for the app's runtime behavior) — ship inside the binary. Their LICENSE + NOTICE content MUST travel with the distribution per §4(d).

Today every dep is in `devDependencies` per the schema-validator-at-dev-time pattern. Once an Electron runtime appears, deps split into actual `dependencies` (runtime) vs `devDependencies` (dev-time), and this section becomes the source of truth for which NOTICE content the shipped binary must surface.

---

## Compliance approach

For each new dependency added to the project:

1. **Verify the license** is on CLAUDE.md principle 4's permissive whitelist (MIT / Apache-2.0 / BSD / ISC / CC0 / MPL-2.0). Never GPL / AGPL bundled.
2. **Check the package for a NOTICE file:** `ls node_modules/<pkg>/NOTICE*`. If present, append the content to the project-root `NOTICE` file per Apache-2.0 §4(d).
3. **Add an entry to this file** (THIRD-PARTY-LICENSES.md) with license, copyright, source URL, and where to find the full license text.
4. **Record the license** in the commit message that adds the dependency (per CLAUDE.md "Every new dependency needs a license check").
5. **Sample the transitive deps** (`npm ls --all` or the per-package `license` field) for non-permissive surprises.

When the application ships as a binary (Electron, etc.), `LICENSE` + `NOTICE` + `THIRD-PARTY-LICENSES.md` MUST be bundled with the distribution and accessible to end users — typically via an in-app "About → Licenses" screen. The compliance scaffold here is ready for that ship.

---

## License of this file

This file is part of ChipBlocks and is licensed under MIT — see [LICENSE](LICENSE).

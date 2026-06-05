# Third-Party Licenses

ChipBlocks depends on third-party software. This file lists each direct dependency, its license, copyright holder, source repository, and where to find the full license text. ChipBlocks complies with each license's redistribution requirements (preserving LICENSE files, preserving NOTICE content where present per Apache-2.0 §4(d), retaining attribution notices).

> **Last verified:** 2026-06-05 (added during v3 Sprint 12 when `mathjs` brought the first NOTICE-bearing dependency).

---

## Direct dependencies (declared in `package.json`)

### Development tooling

#### TypeScript
- **Package:** `typescript` ^6.0.3
- **License:** Apache-2.0
- **Copyright:** Microsoft Corporation
- **Source:** <https://github.com/microsoft/TypeScript>
- **License text:** `node_modules/typescript/LICENSE.txt` after `npm install`
- **NOTICE file:** none (LICENSE.txt only)

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

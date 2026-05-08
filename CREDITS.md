# Credits & Open-Source Notices

ChipBlocks is built on the work of many open-source projects. This file is the canonical attribution / credits record. The licenses below are all **permissive** (MIT / Apache 2.0 / BSD / ISC / PSF) — they require attribution but not source disclosure, and place no restrictions on commercial use.

---

## Licensing policy (the rule that governs what we accept)

ChipBlocks ships only under permissive licenses. Concretely:

- ✅ **Allowed in shipped code**: MIT, Apache 2.0, BSD (any clause), ISC, PSF, Unlicense, CC0, public domain
- ❌ **Not allowed in shipped code**: GPL (any version), AGPL, LGPL, MPL, EUPL, CDDL, EPL, or any other copyleft / share-alike / file-level-copyleft license
- 🟡 **Allowed as separately-installed tools the user has on their machine** (never bundled inside the shipped app): we may invoke GPL/LGPL tools as subprocesses (e.g., a user's existing Verilator install) **provided we do not redistribute them**

This keeps the door open for **future monetization** — a paid desktop bundle, a hosted SaaS tier, a Pro feature set — without re-licensing surprises.

---

## Frontend dependencies (as of 2026-05-07)

All MIT or Apache 2.0. Each is `npm install`-ed and bundled at build time.

| Package | Version | License | Copyright / Authors | URL |
|---|---|---|---|---|
| react | ^18.3.1 | MIT | © Meta Platforms, Inc. and affiliates | https://react.dev |
| react-dom | ^18.3.1 | MIT | © Meta Platforms, Inc. and affiliates | https://react.dev |
| @xyflow/react | ^12.10.2 | MIT | © xyflow GmbH (formerly webkid GmbH) | https://reactflow.dev |
| electron | ^33.2.0 | MIT | © Electron contributors / GitHub Inc. | https://electronjs.org |
| electron-builder | ^24.13.3 | MIT | © Stefan Judis & contributors | https://www.electron.build |
| vite | ^5.4.11 | MIT | © Yuxi (Evan) You & Vite contributors | https://vitejs.dev |
| @vitejs/plugin-react | ^4.3.3 | MIT | © Vite contributors | https://github.com/vitejs/vite-plugin-react |
| vite-plugin-electron | ^0.29.0 | MIT | © electron-vite team | https://github.com/electron-vite/vite-plugin-electron |
| vite-plugin-electron-renderer | ^0.14.6 | MIT | © electron-vite team | https://github.com/electron-vite/vite-plugin-electron-renderer |
| typescript | ^5.4.2 | Apache-2.0 | © Microsoft Corporation | https://www.typescriptlang.org |
| @types/react | ^18.3.12 | MIT | © DefinitelyTyped contributors | https://www.npmjs.com/package/@types/react |
| @types/react-dom | ^18.3.1 | MIT | © DefinitelyTyped contributors | https://www.npmjs.com/package/@types/react-dom |
| tailwindcss | ^3.4.15 | MIT | © Tailwind Labs Inc. | https://tailwindcss.com |
| postcss | ^8.4.49 | MIT | © Andrey Sitnik & PostCSS contributors | https://postcss.org |
| postcss-import | ^16.1.0 | MIT | © PostCSS contributors | https://github.com/postcss/postcss-import |
| autoprefixer | ^10.4.20 | MIT | © Andrey Sitnik | https://github.com/postcss/autoprefixer |
| vitest | ^2.1.5 | MIT | © Anthony Fu, Matias Capeletto & Vitest contributors | https://vitest.dev |

Initial frontend scaffold cloned (and heavily customized) from:
- **electron-vite-react** boilerplate — MIT — © 草鞋没号 — https://github.com/electron-vite/electron-vite-react

---

## Backend dependencies (as of 2026-05-07)

| Package | Version | License | Copyright / Authors | URL |
|---|---|---|---|---|
| Python | 3.12 | PSF License | © Python Software Foundation | https://python.org |
| migen | 0.9.2 | BSD-2-Clause | © M-Labs Limited | https://m-labs.hk/gateware/migen/ |
| litex | 2025.12 | BSD-2-Clause | © EnjoyDigital / M-Labs | https://github.com/enjoy-digital/litex |
| stdlib `wave`, `struct`, `argparse`, `json` | (Python) | PSF License | © Python Software Foundation | (built-in) |

Reference repos cloned for examples (gitignored — not part of shipped product):
- **litex-hub/fpga_101** — BSD-2-Clause — © LiteX Hub contributors — https://github.com/litex-hub/fpga_101 (the `lab004/pwm.py` was the starting point for our PWM-to-WAV simulation)

---

## Tools we plan to invoke (separately installed, never bundled)

These are **user-installed** tools we shell out to; we don't redistribute them. All happen to be permissively licensed, but the rule is "user install, not bundled" regardless.

| Tool | License | Use |
|---|---|---|
| Verilator | BSD-3 (executable) / LGPL-3 (small generated runtime) | RTL simulation. Generated runtime is LGPL but we don't statically link or redistribute it. |
| Yosys | ISC | Synthesis |
| nextpnr | ISC | FPGA place-and-route |
| SymbiYosys | MIT | Formal verification |
| OpenLane / LibreLane | Apache-2.0 | ASIC tape-out flow |
| Ollama | MIT | Optional local LLM for AI consultant (BYO-model) |

---

## AI integration (BYOK — bring your own key)

ChipBlocks calls third-party AI services using the **user's own API key**. We do not bundle or redistribute these services.

| Service | License / Terms | URL |
|---|---|---|
| Anthropic Claude API | Commercial (per Anthropic's terms) | https://www.anthropic.com |
| OpenAI API | Commercial (per OpenAI's terms) | https://platform.openai.com |
| Local Ollama models | Varies per model | https://ollama.com |

---

## Tools explicitly NOT used (license incompatible with our policy)

These were considered and rejected because they're copyleft-licensed and would compromise the future-monetization posture:

| Tool | License | Why dropped |
|---|---|---|
| Icarus Verilog | GPL-2.0 | Copyleft. Verilator (BSD-3) is faster and permissive; we use that instead. |
| GTKWave | GPL-2.0 | Copyleft. We will build a permissive in-app viewer or use a permissive npm/web component. |
| Surfer (waveform viewer) | EUPL-1.2 | Weak copyleft. Same rationale. |
| ghdl-yosys-plugin | GPL-3.0 | Copyleft Yosys plugin. We use only the core ISC Yosys distribution. |

---

## A note about `electron-builder` and `7zip-bin`

`electron-builder` may transitively pull `7zip-bin` (LGPL-2.1) for *creating* installers. This is purely a build-time tool — the LGPL component is not present in the final distributed app. Treating it like a build tool (not a runtime dependency) keeps us license-clean. If `electron-builder` ever moves to bundle 7zip into the runtime artifact, we'd need to revisit.

---

## How attributions are surfaced in the shipped product

When ChipBlocks ships a public release, this `CREDITS.md` content (or a generated equivalent) will be:
1. Embedded in the app under **Help → About → Open-Source Credits**
2. Included in the installer / package as a `CREDITS.txt`
3. Linked from the public-facing website / README

This satisfies the attribution requirement of every license listed above.

---

*Generated from `frontend/package.json` and the planned-tools list in `PRD.md`. Update whenever a new dependency is added or removed.*

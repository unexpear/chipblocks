# Tooling research — May 2026

> **Status:** research notes, not a decision doc. When specific picks are adopted, they'll land as ADRs (with this file referenced as supporting context). Last verified 2026-05-17 against canonical official sources.
>
> **Why this exists:** ChipBlocks is at the Sprint 2 → Sprint 3 transition. A linter hasn't been picked. The Python toolchain hasn't been picked. The contributor base is about to grow. Most of these decisions are 30 minutes to apply now and weeks of churn to retrofit later. This doc captures the research that informs those upcoming picks.
>
> **Method:** 4 parallel research agents (frontend toolchain, testing/CI/supply chain, Python toolchain, Electron desktop), each with a focused brief and instructions to verify against current sources. Then a verification pass: 8 parallel WebFetches against canonical official URLs (biomejs.dev, react.dev, typescriptlang.org, pnpm.io, GitHub repos for astral-sh/uv + astral-sh/ruff + evilmartians/lefthook, v2.tauri.app). Findings below distinguish **confirmed**, **confirmed with caveats**, and **overstated** so future-us can trust the parts that held up.

---

## Bottom-line picks (not yet adopted)

### Before S3-1 — three small, high-value changes (~2-3 hours total)

1. **Biome** for lint + format (replaces ESLint + Prettier, one tool, one config)
   - Pair with `eslint-plugin-react-hooks` standalone — Biome does not cover `exhaustive-deps` / `rules-of-hooks` (verified gap)
2. **TypeScript strict-flag set**: `strict: true` + `exactOptionalPropertyTypes: true` + `verbatimModuleSyntax: true` + `isolatedModules: true`. Consider `noUncheckedIndexedAccess: true` as a stricter opt-in (it'll surface real bugs in manifest-walking code, but be ready to fix what it surfaces).
3. **pnpm migration** + **Renovate** GitHub App for automated dependency PRs

### When the Python backend lands (Sprint 3+)

- **uv** for everything package/env (replaces pip + pipx + poetry + pyenv + venv + virtualenv + twine — verified at the [uv README](https://github.com/astral-sh/uv))
- **Ruff** for lint + format (one config block in `pyproject.toml`, Black-compatible)
- **Pyright** for type-checking in CI (re-evaluate Astral's `ty` when 1.0 lands)
- **pytest + Hypothesis** — manifest validation is property-based testing's sweet spot
- **Python 3.12+ as the supported floor** (3.11 is dropping out of the scientific Python ecosystem per [SPEC 0](https://scientific-python.org/specs/spec-0000/))
- One GitHub Actions workflow file using `astral-sh/setup-uv@v7`

### Electron-specific (Sprint 4+)

- Stay on **electron-builder** for distribution (still dominant by adoption + best multi-target installer matrix)
- Migrate to **electron-vite** when the canvas lands — proper main/preload/renderer separation with HMR for preload
- **Don't migrate to Tauri 2.** The Python sidecar story is bad — no Python-specific guide, requires PyInstaller + target-triple suffix per platform, no hot-reload. ChipBlocks specifically needs Python integration (Amaranth + ngspice), so Tauri's strengths don't apply here. ([Tauri sidecar docs](https://v2.tauri.app/develop/sidecar/))
- Security baseline: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, strict CSP, `contextBridge` for typed IPC. **Community manifests are untrusted** — parse YAML in main process behind narrow IPC, validate with Ajv, never `eval` or `Function()` manifest content.

### Skip / watch but don't adopt

| Thing | Why skip (today) |
|---|---|
| **Oxlint / oxc** | Faster than Biome but Windows OOM issues. Your dev environment is Windows. Wait. |
| **Bun as Node replacement** | ~95% Node compat = real risk for Electron + native modules + electron-builder. |
| **Tauri 2** | Python sidecar friction is documented and real. |
| **Astral's `ty` type checker** | Still beta. Pyright now; migrate when `ty` hits 1.0. |
| **UI snapshot testing** | Falling out of favor. Use Playwright `toHaveScreenshot` for canvas regressions when Sprint 4 lands. |
| **Turbopack / Rspack for ChipBlocks's case** | Vite (now backed by Rolldown) remains consensus for Electron + React + TS. |

---

## The five big industry shifts (the narrative)

### 1. One tool, not five

The 2010s pattern was "compose tiny tools" (ESLint + Prettier + Babel + isort + black + flake8 + …). The 2020s pattern is "one Rust binary that does all of it."

- **Biome** replaces ESLint + Prettier. One config file. Verified at [biomejs.dev](https://biomejs.dev/internals/language-support/) — lints + formats TS/JSX/TSX.
- **Ruff** replaces black + flake8 + isort + pyupgrade + pydocstyle. Verified at the [ruff README](https://github.com/astral-sh/ruff) — formatter included, Black-compatible.
- **uv** replaces pip + pip-tools + pipx + poetry + pyenv + twine + virtualenv. Verbatim from the [uv README](https://github.com/astral-sh/uv): "A single tool to replace `pip`, `pip-tools`, `pipx`, `poetry`, `pyenv`, `twine`, `virtualenv`, and more."

**Why this won:** the cost of "configurability" was decades of broken plugin ecosystems and confused new contributors. Speed + simplicity gain swamps the loss of flexibility. **Pick the single-tool option where ChipBlocks hasn't yet — linter/formatter on the JS side; the entire stack on the Python side.**

### 2. TypeScript got stricter on purpose

The `strict: true` of 2020 is the floor, not the ceiling. The modern flags add:

| Flag | Verified status | What it catches |
|---|---|---|
| `strict` | ✓ officially recommended | enables the strict-mode family |
| `exactOptionalPropertyTypes` | ✓ officially recommended | distinguishes "missing key" vs "key with `undefined`" |
| `noUncheckedIndexedAccess` | exists; **not** flagged "recommended" by docs but adopted by quality projects | array/dict lookups return `T \| undefined` instead of `T` — catches bugs in manifest-walking code |
| `verbatimModuleSyntax` | exists | clean ESM import/export, plays well with all the new bundlers |
| `isolatedModules` | exists | required for fast non-tsc transpilers |
| `isolatedDeclarations` | exists | library-author flag for explicit return types; skip unless emitting many `.d.ts` from many entry points |

Verified at [typescriptlang.org/tsconfig](https://www.typescriptlang.org/tsconfig). Current TypeScript version referenced in docs: 5.7 (one agent claimed 5.9; the version number wasn't verifiable, but the flags exist regardless).

**For ChipBlocks specifically:** the manifest schemas in `frontend/src/manifests/_generated/` are exactly the surface where `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` catch real bugs that `strict: true` alone misses. Cheap to flip now, expensive to retrofit later.

### 3. Supply chain became a real thing

After xz, Lodash, eventstream, OSS converged on:

- **npm `--provenance`** when publishing — Sigstore-signed, free, one flag. (When ChipBlocks first publishes a manifest-validator package, use this from GitHub Actions with `id-token: write`.)
- **Renovate over Dependabot** — better grouping, automerge presets, regex managers. Free hosted bot.
- **Pinning GitHub Actions by commit SHA** instead of version tag — real mitigation against compromised action versions.

### 4. Pre-commit hooks: Lefthook is the cleaner option, not the dominant one

The agent claimed "Lefthook has overtaken Husky for new TS projects." **Verified result: not really.** Husky has ~32k GitHub stars; Lefthook has 8.2k (verified at [github.com/evilmartians/lefthook](https://github.com/evilmartians/lefthook), latest v2.1.6 April 16 2026).

But Lefthook *is* genuinely simpler: single Go binary, single YAML config, parallel execution, no Node runtime dependency. For a fresh start with no Husky inertia, Lefthook is the cleaner pick. Either works.

For ChipBlocks: `tsc --noEmit` + `vitest --run --changed` + the manifest drift check, all in parallel, on every commit. Catches "I forgot to run tests" locally before CI.

### 5. Visual regression replaced UI snapshot testing

UI snapshot tests became a maintenance burden — every legitimate change required regenerating snapshots, so people stopped reading the diffs. **Playwright's `toHaveScreenshot`** catches actual visual regressions (pixel diffs of rendered states) without the noise.

For ChipBlocks: keep inline snapshots for the codegen TS output (high signal — drift CI already does this); when canvas lands in Sprint 4, use Playwright `toHaveScreenshot` for a few key canvas states instead of introducing Storybook+Chromatic.

---

## Verification pass — what held up, what didn't

### ✓ Confirmed (recommendation stands)

| Claim | Source verified |
|---|---|
| Biome lints + formats TS/JSX/TSX as one tool | [biomejs.dev/internals/language-support](https://biomejs.dev/internals/language-support/) |
| Biome does NOT cover React Hooks rules (need eslint-plugin-react-hooks alongside) | Same page — no support for `exhaustive-deps` / `rules-of-hooks` |
| pnpm uses content-addressable store + non-hoisted layout | [pnpm.io/motivation](https://pnpm.io/motivation) — "files are hard-linked from that single place" + symlinks for direct deps only |
| uv is production-stable; replaces pip/pipx/poetry/pyenv/twine/virtualenv | [github.com/astral-sh/uv](https://github.com/astral-sh/uv) — verbatim. v0.11.14 (May 12 2026) |
| Ruff has a formatter that drops Black | [github.com/astral-sh/ruff](https://github.com/astral-sh/ruff) — v0.15.13 (May 14 2026) |
| Lefthook is a single Go binary, single YAML config, parallel exec | [github.com/evilmartians/lefthook](https://github.com/evilmartians/lefthook) — v2.1.6 (April 16 2026) |
| Tauri 2 Python sidecar friction is real | [v2.tauri.app/develop/sidecar](https://v2.tauri.app/develop/sidecar/) — no Python-specific guide, requires PyInstaller + target-triple suffix, no hot-reload |

### ⚠ Confirmed with caveats (rec softened)

| Original claim | What the docs actually say | Revised position |
|---|---|---|
| "React Compiler hit 1.0 in Oct 2025 — default-on recommendation" | [react.dev/learn/react-compiler/installation](https://react.dev/learn/react-compiler/installation) doesn't say "1.0 / stable / production-ready" or "turn it on by default." Frames as a guide. Install command verified. | Available; install if you want automatic memoization. NOT a mandatory pick. |
| "TS 5.9 is the current version (July 2025)" | Official tsconfig page references 5.7 as recent. Version number unverifiable. | Flags exist regardless of version label. |
| "noUncheckedIndexedAccess is part of the 2026 baseline" | TS docs don't flag it as "recommended" — only `strict` and `exactOptionalPropertyTypes` are explicitly recommended. | A *stricter than default* opt-in adopted by quality projects. Recommend it for ChipBlocks because the manifest code benefits, but be honest that it's not the official "recommended" set. |
| "ruff format shipped its own 2026 stable style guide, no longer just Black-compatible" | Ruff README still says "Drop-in parity with Flake8, isort, and **Black**" and formatter options "Like Black." | ruff format is a fast Black-compatible formatter. Drop black; gain speed. Don't oversell the divergence. |

### ✗ Overstated by agents (rephrased)

- **"pnpm gives ~75% disk reduction"** — official page describes hard-link mechanism but doesn't quote a 75% number. Use "saves significant disk via shared store" instead.
- **"Lefthook has overtaken Husky"** — Husky ~32k stars vs Lefthook 8.2k. Lefthook is the cleaner newer option, not the dominant choice.
- **"Ruff has diverged from Black"** — README contradicts. Still Black-compatible.

### ? Couldn't verify (treating as agent claims, not facts)

- "Vite 8 shipped March 12 2026 with default Rolldown bundler" — didn't fetch vite.dev. Plausible.
- "Electron 42 + Node 24 as of May 14 2026" — didn't fetch electronjs.org. Plausible given the 8-week cadence.
- "Azure Trusted Signing at $9.99/mo for Windows code signing" — didn't fetch Azure pricing. Reasonable.
- "Apple Developer ID $99/yr + Apple notarization for macOS" — well-known; trusted.
- "npm provenance free + Sigstore-backed + SLSA Level 2 from GitHub Actions" — well-known feature shipped 2023; trusted.

---

## Source URLs (verified during this research pass)

- [biomejs.dev — language support](https://biomejs.dev/internals/language-support/)
- [react.dev — React Compiler installation](https://react.dev/learn/react-compiler/installation)
- [typescriptlang.org — tsconfig reference](https://www.typescriptlang.org/tsconfig)
- [pnpm.io — motivation](https://pnpm.io/motivation)
- [github.com/astral-sh/uv](https://github.com/astral-sh/uv)
- [github.com/astral-sh/ruff](https://github.com/astral-sh/ruff)
- [github.com/evilmartians/lefthook](https://github.com/evilmartians/lefthook)
- [v2.tauri.app — sidecar guide](https://v2.tauri.app/develop/sidecar/)
- [scientific-python.org — SPEC 0 (Python version support policy)](https://scientific-python.org/specs/spec-0000/)

Plus the agent-reported sources (not independently verified by me but cited if you want to dig):

- [npm docs — generating provenance statements](https://docs.npmjs.com/generating-provenance-statements/)
- [docs.astral.sh/uv/ — uv documentation](https://docs.astral.sh/uv/)
- [astral.sh/blog — Ruff v0.15.0](https://astral.sh/blog/ruff-v0.15.0)
- [astral.sh/blog — ty announcement](https://astral.sh/blog/ty)
- [Electron security tutorial](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- [electron-vite.org](https://electron-vite.org/)
- [GitHub docs — OIDC with reusable workflows](https://docs.github.com/actions/deployment/security-hardening-your-deployments/using-openid-connect-with-reusable-workflows)
- [OpenSSF OSPS Baseline](https://baseline.openssf.org/)
- [Renovate docs — bot comparison](https://docs.renovatebot.com/bot-comparison/)
- [pytest documentation](https://docs.pytest.org/)
- [Hypothesis documentation](https://hypothesis.readthedocs.io/)

---

## When to revisit this doc

- **Before any tooling pick lands as an ADR** — re-verify the picks against current sources at adoption time.
- **Quarterly review** — toolchain churn is fast in 2026. Astral's `ty` (Python type checker) becoming 1.0 is the most likely trigger to revisit.
- **When a contributor opens a PR using an old pattern** (e.g., Husky setup, Black formatter, pip+venv) — point them here and the relevant ADR if one exists.

## What this doc does NOT do

- It does not commit ChipBlocks to any of these picks. Each adoption needs its own ADR with rationale and consequences.
- It does not cover AI-side patterns (prompt caching, streaming, structured outputs, tool use) — that's Sprint 6 research, not done yet.
- It does not cover canvas-specific tooling (React Flow performance, virtualization, drag-drop libraries) — that's Sprint 4 research, not done yet.
- It does not cover physics-engine choices (in-app vs ngspice integration patterns, Amaranth HDL elaboration) — Sprint 5 research, not done yet.

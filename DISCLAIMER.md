# DISCLAIMER

> A plain-language statement of who built ChipBlocks, how, and what users should and shouldn't trust about it. Complements the formal language in [LICENSE](LICENSE) (MIT, "AS IS", no warranty) and [LEGAL-CONSIDERATIONS.md](LEGAL-CONSIDERATIONS.md) (legal posture review).

---

## In plain words

**I'm not an electrical engineer.**

I built ChipBlocks because the problem space is interesting — how do you go from physical materials up through circuits and chips to full electronic systems, with real values at every layer, in a way that a curious person can both use as a black box AND drill into the physics? I wanted to find out what that takes. ChipBlocks is the working answer-in-progress.

**Do not put full trust in ChipBlocks's validation.**

The catalog is built from cited references (NIST, IEC, IEEE, IPC, ASTM, Sze textbook, Schubert textbook, Ioffe NSM Archive, manufacturer datasheets — see [CREDITS.md](CREDITS.md) for the full list). The cross-FK validator catches structural errors (wrong material kinds, missing references, role-satisfaction violations) and the foundation rule prohibits invented values. But:

- I could have made mistakes I didn't catch.
- The model simplifies real physics in places that I've tried to flag but may not have caught all of.
- Citations point at authoritative sources, but human transcription errors happen.
- Some claims I made about industry standards were caught and corrected during zero-trust verification rounds. There are probably more I didn't catch.

This is how every major open-source electronics design project works — **KiCad's component libraries** explicitly disclaim warranty on the values they ship and rely on community-curated PR-based errata fixes. ChipBlocks adopts the same posture. Cited values may contain transcription errors, datasheet errata, or condition-dependent inaccuracies; the community-curated errata model (see [Reporting issues](#reporting-issues) below) is how data quality improves over time.

**AI did a lot of the work — and that's disclosed.**

I built ChipBlocks using **Claude Opus** (Anthropic) extensively for drafting documentation, authoring YAML fixtures, writing the TypeScript validator + tests, and running deep-research verification rounds. Per-commit `Co-Authored-By:` trailers in the git log show specifically what AI was used. The arrangement: AI surfaces options and drafts content; I direct decisions and approve nothing without reading it. That's the project's load-bearing principle 1 from [CLAUDE.md](CLAUDE.md): *"AI assists. ChipBlocks validates. The user approves."*

But: **AI can be confidently wrong.** It pattern-matches against training data, which is necessarily limited and dated. The zero-trust verification discipline (cross-checking AI-surfaced facts against canonical sources) catches a lot but not everything. Take everything ChipBlocks claims with the same scrutiny you'd apply to any AI-generated technical content.

**Vibe coding is real and that's how I iterate.**

I work iteratively, lean on AI to draft, read what it writes carefully, push back when something looks off, and ship when the gates (tests, typecheck, biome) pass. "Vibe coding" — Karpathy's term — is the workflow: human directs, AI drafts, gates verify. It's productive for a curious-person-without-a-PhD building a complex domain tool. It's also imperfect.

---

## What ChipBlocks IS

- **A learning tool** for understanding electronics from materials up. Every fixture's properties cite a real source so the curious user can dig in.
- **A hobbyist's design companion** — when you're picking a resistor for an LED in a hobby project, ChipBlocks should give you honest material data and standard circuit conventions.
- **An experiment in foundation-up modeling** — can a single object model span material physics through device behavior cleanly? The catalog so far (18 materials, 10 behaviors, 10 primitive devices, 16 instances) is the work in progress.
- **An open-source, free-forever project** — see [README.md](README.md), [LICENSE](LICENSE), and the commercial-use posture in [CREDITS.md](CREDITS.md) and [LEGAL-CONSIDERATIONS.md](LEGAL-CONSIDERATIONS.md). No paid tier, ever. Files you create with ChipBlocks are yours to sell, share, or use commercially.

## What ChipBlocks IS NOT

- **NOT a substitute for professional engineering judgment.** If a circuit's failure could cost lives, money, or property — medical devices, automotive systems, aerospace, life-support, industrial control, power transmission — you need a credentialed engineer to design, review, and certify it. ChipBlocks is not that.
- **NOT certified or audited.** No professional engineering board, government agency, or accreditation body has reviewed this project. The values cite authoritative sources; the validator catches structural errors; neither is a substitute for certification.
- **NOT validated by a circuit simulator yet.** As of v3 Sprint 11 close, there's no DC simulation, no transient simulation, no thermal simulation, no EMI/EMC analysis. The full simulation+visualization arc is laid out in [SIMULATION-AND-VISUALIZATION-ARC.md](SIMULATION-AND-VISUALIZATION-ARC.md) but most of it is years of future work.
- **NOT a finished application.** As of v3 Sprint 11 close, there's no canvas, no UI, no Electron app shipped. The foundation is markdown + schemas + a TypeScript validator + YAML fixtures.

---

## Recommended use

| Use case | Recommendation |
|---|---|
| Learning electronics from materials up | **Great fit.** Browse the fixtures; cite values come from real sources you can dig into. |
| Choosing components for a hobby project | **OK with verification.** Cross-check forward-voltage / max-current / etc. against the actual part you're buying via its manufacturer datasheet. |
| Designing a circuit for a class project, science fair, weekend hack | **OK.** Verify against the same sources ChipBlocks cites, plus the actual parts you use. |
| Designing something safety-critical (medical, automotive, aerospace, life-support, industrial control) | **DO NOT use ChipBlocks alone.** Hire a credentialed engineer. Use professional EDA tools (KiCad, Altium, Cadence). Get certified test results. |
| Designing a commercial product | **OK as a starting point with engineering review.** ChipBlocks output is your IP per the two-deliverables model; commercial use is fully permitted; but a credentialed engineer should review the design before manufacture. |
| Authoring custom blocks or contributing fixtures | **Welcome.** Per [CLA.md](CLA.md), contributions go through the standard PR workflow. The per-fixture provenance discipline applies to contributions. |

---

## How to verify ChipBlocks claims yourself

The project's per-fixture provenance discipline is designed to make this easy:

1. **Open the YAML fixture for any component** (e.g., `fixtures/valid/material-copper.yaml`).
2. **Read the `provenance:` block** on each property — it cites the source (NIST CODATA, IEC standard, manufacturer datasheet, etc.) used for that value.
3. **Cross-check against the cited source.** Most are publicly available (NIST web pages, Wikipedia for general values, manufacturer-published datasheets). Standards are usually paywalled (IEC/IEEE/IPC) but the values they specify are also published in textbooks and authoritative web summaries.
4. **If you find a discrepancy:** file a GitHub issue. Or better — submit a PR with the corrected value and an updated provenance citing the better source.

The repo's zero-trust verification rounds (visible in commit messages from Sprints 5, 6, 8, 10, 11 and in deep-research workflow artifacts) demonstrate this practice. Several AI-surfaced claims were caught and corrected during these rounds — that catches some errors, but not all. Independent user verification helps catch more.

---

## Reporting issues

If you spot:

- A value that doesn't match its cited source
- A unit conversion error
- A misnamed material or behavior
- An incorrect schema constraint that lets through invalid data
- A formula that doesn't dimensionally check
- An out-of-date cited reference
- An AI-surfaced claim that's actually wrong
- Any other technical error

Please **file a GitHub issue** at <https://github.com/unexpear/chipblocks/issues>. Even better, submit a PR with the fix and a source citation showing the corrected value.

The project has explicit anti-placeholder rules ([OBJECT-MODEL.md](OBJECT-MODEL.md) §12): no fake values, no fake physics, no fake sources, no marking unsupported behavior as passing. Reports that surface violations are taken seriously.

---

## What this disclaimer is, legally

This document is **plain-language context** to help users understand the project's posture. It is NOT a substitute for the formal language in:

- [LICENSE](LICENSE) — MIT "AS IS" no-warranty no-liability disclaimer
- [LEGAL-CONSIDERATIONS.md](LEGAL-CONSIDERATIONS.md) — full legal-posture review including safety-critical use, AI-generated content responsibility, etc.
- [CLA.md](CLA.md) — contributor licensing

Reading those is recommended for any serious use, commercial activity, or distribution.

This file is itself part of ChipBlocks and is licensed under MIT.

# LEGAL-CONSIDERATIONS.md

> **IMPORTANT DISCLAIMER FIRST:** I am Claude, an AI assistant. **I am not a lawyer. This document is NOT legal advice.** This is a structured review of the project's current legal posture — strengths, gaps, and risk categories — based on common-knowledge analysis of open-source project practices. For any high-stakes legal decision (commercial launch, dispute resolution, IP enforcement), consult a qualified attorney in your jurisdiction. **The disclaimer-of-warranty in [LICENSE](LICENSE) also applies to this document itself.**
>
> **Reviewed:** 2026-06-05

---

## TL;DR

ChipBlocks at v3 Sprint 11 close is in **good legal posture** for a docs-only open-source project. Major protections (MIT license + permissive-only bundling rule + CLA + per-fixture provenance discipline) are in place. The biggest near-term legal concerns are:

1. **Trademark for "ChipBlocks"** — not yet verified at USPTO TESS or other registries. Should be checked before any product launch, marketing, or commercial use.
2. **Disclaimer about engineering judgment** — currently absent. Should be added before users start treating ChipBlocks output as professional-grade engineering data.
3. **AI-generated content responsibility** — disclosure is fine via co-author trailers + CREDITS.md, but a clearer "user is responsible for verification" statement would harden the posture.
4. **Export control awareness** — semiconductor design technology can be dual-use (EAR / Wassenaar). Low risk at foundation stage, but worth a flag.

The MIT license itself provides strong baseline protection. The CLA is well-structured. Per-fixture provenance for material values means citations are traceable rather than invented.

---

## Section 1 — License posture

### Current state

- Primary license: **MIT** ([LICENSE](LICENSE)). Strong, well-understood, provides "AS IS" + no warranty + no liability. Copyright 2026 unexpear.
- Bundling rule (per [CLAUDE.md](CLAUDE.md) Core principle 4): only MIT / Apache 2.0 / BSD / ISC / CC0 licenses can be bundled in the shipped product. NEVER GPL / AGPL bundled. GPL tools can be invoked as separate user-installed processes (the KLayout/ngspice/openEMS posture).
- Contributor licensing: [CLA.md](CLA.md). Grants Maintainer perpetual + worldwide + irrevocable copyright AND patent licenses. Patent-litigation termination clause protects the project from contributor-led patent attacks.

### Verdict

Strong. The MIT license is the gold standard for permissive open source. The bundling rule is internally consistent and verified against actual tool licenses (see [SIMULATION-AND-VISUALIZATION-ARC.md](SIMULATION-AND-VISUALIZATION-ARC.md)). The CLA covers both copyright and patent grants — better than many open-source projects which only cover copyright.

### Risks

- **MIT license clause requires attribution preservation.** If any future contributor or downstream user removes the copyright notice from copies, that's a license violation. Standard exposure — same as every MIT-licensed project. Hard to prevent technically; addressable by enforcement if/when discovered.
- **The CLA requires `Signed-off-by:` trailers.** If contributions arrive without them, technically the CLA hasn't been accepted. Practical mitigation: PR templates that remind, or a bot that checks (e.g., DCO bot on GitHub).
- **MIT does NOT include explicit patent grant.** If a contributor's code unknowingly infringes a third-party patent, MIT alone doesn't grant a patent license to downstream users. The CLA fills this gap for contributors but doesn't reach third parties. **Consider Apache 2.0 instead of MIT** in a future relicense to harden this — Apache 2.0 has an explicit patent clause. Sprint-level scope concern, not urgent.

### Recommendations

1. Keep MIT for now. The CLA's patent clause covers the most likely attack vector (contributor-led patent claims).
2. When the project ships a real product, consider an Apache 2.0 relicense for the patent grant clarity. Both MIT and Apache 2.0 are permissive; Apache 2.0 just adds the explicit patent language.
3. Add a DCO bot (or similar) on the GitHub repo to enforce `Signed-off-by:` on PRs once external contributors start submitting.

---

## Section 2 — Copyright considerations

### Facts vs expression — the core principle

Under US copyright law (and most jurisdictions): **facts are not copyrightable.** The compilation and presentation of facts CAN be copyrightable, but the underlying facts themselves are not. This is critical for ChipBlocks.

### How this applies to ChipBlocks

- **Material property values** (resistivity, density, bandgap, etc.) cited from references like NIST CODATA, Sze textbook, Ioffe NSM Archive, CRC Handbook are FACTS. The numbers themselves are not copyrightable. The TEXTBOOK around them is copyrighted, but the individual measured values are not.
- **Specific manufacturer datasheet values** (forward voltage, max current, capacitance) are FACTS. Citing them is normal professional engineering practice and not a copyright issue.
- **IEC / IEEE / ANSI / IPC / ASTM standard NUMBERS and their TITLES** are facts. The standards' FULL TEXTS are copyrighted (most are paywalled). The project cites standards by number/title only and does not reproduce standard text — safe.

### Where copyright concerns DO arise

- **Verbatim quotation** of copyrighted text (textbook passages, datasheet prose, standards body marketing copy) needs to be limited to short quotes under fair-use principles. The project should NOT copy chapters of Sze or Schubert verbatim into doc files.
- **ARRL symbol GRAPHICS** are copyrighted as visual works. The project explicitly does NOT copy ARRL's specific symbol drawings ([SCHEMATIC-SYMBOLS.md](SCHEMATIC-SYMBOLS.md) is clear on this — ARRL is an inventory checklist, not a graphics source). ChipBlocks's eventual SVG library will be ORIGINAL drawings following the same IEEE/ANSI 315 conventions.
- **KiCad symbol GRAPHICS** are GPL-licensed. The project cannot copy KiCad's SVG files into a bundled product. The conventions (zigzag = resistor, triangle + bar = diode) are public standards (IEC 60617, IEEE 315), and those conventions themselves are not copyrightable — only specific drawings are.

### Verdict

Strong. The project's discipline of citing values per-fixture with sources, plus the explicit rule about not copying graphics from copyrighted symbol libraries, addresses the main copyright risks.

### Recommendations

1. Continue the per-fixture provenance discipline.
2. When the canvas + symbol library work begins, ensure ChipBlocks's SVG drawings are ORIGINAL (drawn from the public-standards conventions, not traced from KiCad / ARRL files).
3. Avoid copying standard-body text verbatim — paraphrase facts and cite the standard.
4. If quoting any source longer than a sentence, format as a clearly attributed quote with citation.

---

## Section 3 — Trademark

### The name "ChipBlocks"

**The project name "ChipBlocks" has NOT been verified as available for trademark use.**

- WebFetch of USPTO TESS (US trademark database) failed in this review pass (the page requires interactive search; not WebFetch-able).
- A manual search at [tmsearch.uspto.gov](https://tmsearch.uspto.gov/) for "chipblocks" + close variants ("chip blocks", "chip-blocks") would establish whether the name is available, registered, or contested in the US.
- Similar checks should be done at other major registries (EUIPO for EU, UK IPO for UK, JPO for Japan if any market presence is planned).

### Risk if "ChipBlocks" turns out to be trademark-protected

- Pre-launch (current state): low risk. Foundation-spec phase has no marketing, no commercial offering, low likelihood of trademark-holder enforcement.
- Post-launch: real risk. A trademark holder could send cease-and-desist letters, force a rename, or seek damages depending on usage scope and similarity.

### Recommendations

1. **Before any launch / marketing / commercial activity:** do a thorough trademark search at TESS + EUIPO at minimum. Consider hiring a trademark attorney for this if commercial intent is real.
2. **Document the search results** in this file when done.
3. **If "ChipBlocks" is unavailable:** plan a rename early rather than after building brand identity.
4. **If "ChipBlocks" appears available:** consider filing your own trademark application to lock it down for ChipBlocks's use. Trademark protection is jurisdictional; multiple filings may be needed for international scope.
5. **Watch for similar marks:** "ChipBlock" (no s), "ChipsBlocks", etc. — close enough to potentially cause confusion. The trademark search should cover variants.

---

## Section 4 — Patent considerations

### The foundation-stage exposure

ChipBlocks v3 Sprint 11 close is markdown + a small TypeScript validator + YAML fixtures. **None of this is novel patentable subject matter.** It's:

- Public-domain physics (Ohm's law, Kirchhoff's laws, Shockley diode equation, Planck radiation, etc. — known for 50-150+ years)
- Standard engineering practice (PCB design, component selection, schematic conventions)
- Cited reference values from public + commercial sources

Patents typically cover **specific implementations** or **novel methods**, not general principles. The current ChipBlocks work doesn't implement anything novel-enough-to-patent.

### Where patent risk DOES arise

- When ChipBlocks ships a circuit simulator: specific solver implementations could potentially be patented. ngspice and other open-source simulators have been around for decades without major patent litigation — suggesting the field is mature enough that the foundational patents have expired.
- When ChipBlocks adds layout / EDA features: PCB autorouting, place-and-route algorithms have patents that may still be active. The project should check before implementing specific algorithms.
- Specific component models (e.g., SPICE BSIM4 transistor model) may have associated patents. The project should use only methods that are clearly in the public domain or licensed for use.

### Recommendations

1. Continue using only well-established physics and methods at the foundation stage.
2. When the simulator + EDA features land, do a patent landscape review before implementing specific algorithms.
3. The CLA's patent grant + litigation termination clauses are already protective.
4. Do not knowingly use patented methods without a license. If a team member identifies a potential patent issue, pause and consult counsel.

---

## Section 5 — AI-generated content responsibility

### The current state

- AI assistance is disclosed via:
  - [CREDITS.md](CREDITS.md) AI assistance section
  - Per-commit `Co-Authored-By:` trailers
  - CLAUDE.md's Core principle 1 ("AI assists. ChipBlocks validates. The user approves.")

### Why this matters legally

- **Anthropic's commercial terms** ([anthropic.com](https://www.anthropic.com/)) allow commercial use of Claude's output, with caveats. The user is responsible for verifying AI output before use.
- **Copyright of AI-generated content** is jurisdiction-dependent. In the US, recent guidance from the US Copyright Office (2023) is that purely AI-generated content is NOT copyrightable; human-authored or human-edited content is. ChipBlocks's content is heavily human-directed and human-approved per the core principle — likely copyrightable as a work of joint authorship or human authorship with AI assistance.
- **Liability for AI errors:** if AI generates incorrect content that someone relies on and gets hurt, the project's liability depends on:
  - The MIT license disclaimer ("AS IS", no warranty)
  - The user's responsibility to verify (per core principle 1)
  - Whether ChipBlocks marketed AI output as authoritative (it shouldn't)

### Recommendations

1. The current disclosure setup is solid. Continue per-commit trailers + central credit in CREDITS.md.
2. **Add a section to README.md or CLAUDE.md** explicitly stating: "AI-assisted content is verified by the project lead before merge; users of ChipBlocks output bear responsibility for verifying against their own engineering judgment." (Or similar.)
3. When the application ships, in-app indicators that show "AI-generated" or "AI-assisted" would harden the posture further.
4. Continue the zero-trust verification discipline — it's already in practice and lines up with legal best practice for AI-assisted work.

---

## Section 6 — Warranty and liability disclaimers

### Currently in place

- **MIT license disclaimer** covers warranty of merchantability + fitness for purpose + non-infringement, and disclaims liability for damages.
- **CLA disclaimer** mirrors this for contributions.

### Gaps

- **No explicit "this is not a substitute for professional engineering judgment" statement.** ChipBlocks's foundation work will eventually produce circuit designs, simulations, and recommendations. Users could rely on these for safety-critical work (medical, automotive, aerospace, life support) where errors have real-world consequences. The MIT disclaimer covers liability legally, but a domain-specific disclaimer reduces user confusion and addresses ethical responsibility.

### Recommendations

1. **Add a DISCLAIMER.md** or expand a section in README.md to state explicitly: "ChipBlocks is intended for educational use, hobbyist projects, and as a development tool. It is NOT a substitute for professional engineering judgment, and its output should NOT be relied upon for safety-critical applications (medical devices, automotive systems, aerospace, life-support, etc.) without independent verification by qualified engineers. Users assume all responsibility for the use of ChipBlocks output." (Or stronger language depending on the project lead's risk tolerance.)
2. When the application ships, in-app warnings for likely-safety-critical patterns would harden this further.

---

## Section 7 — Export control awareness

### The concern

Semiconductor design technology is regulated under:

- **US: Export Administration Regulations (EAR)**, particularly Category 3 (Electronics) and Category 5 (Computers). Some EDA tools, advanced node PDKs, and certain integrated circuits are export-controlled. Some destinations (sanctioned countries, certain entities) have restrictions.
- **Wassenaar Arrangement** — multilateral export controls on dual-use technologies, including semiconductor design.

### How this applies to ChipBlocks at the foundation stage

- **Foundation work (materials catalog + symbol research):** essentially no export concern. Material data is public; symbol conventions are international standards.
- **Future simulator + layout work:** the tools themselves (especially advanced-node PDK access) could fall under export control.
- **Distribution of source code from US to other countries:** generally OK for open-source software per longstanding EAR practice (the "publicly available" exemption), but not absolute. Code with specific cryptographic, military-grade, or advanced-semiconductor functionality may be controlled.

### Recommendations

1. **At foundation stage:** no action needed. The current catalog is purely educational/reference content.
2. **Before adding advanced PDK integration or cutting-edge ASIC features:** check current export-control posture. Cutting-edge node design (≤5nm, advanced GaN/SiC RF, etc.) attracts more scrutiny than mature-node hobbyist work.
3. **Maintain a public, open-source posture:** open-source release generally qualifies for the "publicly available" exemption from EAR.
4. **Add a brief disclaimer** if users want to use ChipBlocks for production design: "Users are responsible for compliance with applicable export-control regulations including US EAR and equivalents in other jurisdictions."

---

## Section 8 — Privacy and data protection

### Current state

ChipBlocks at v3 Sprint 11 close has no application, no user accounts, no telemetry, no data collection. **No GDPR / CCPA / similar exposure currently.**

### When this becomes relevant

- When the Electron app ships with AI integration (BYOK), user API keys will be stored. Either client-side only (never sent to ChipBlocks servers) or with explicit user consent + transparent storage policy.
- When the app collects telemetry (crash reports, usage stats), opt-in consent + clear policy will be required.
- When community packs / marketplaces appear, user contributions / accounts create more responsibilities.

### Recommendations

1. **Pre-ship:** draft a Privacy Policy that's ready for the first ship.
2. **Default-private posture:** any data collection should be opt-in, transparent, and minimal. No selling user data ever (per core principle 4 about no paid tier).
3. **AI API key handling:** must be local-only by default. Never transmitted to ChipBlocks servers without explicit user action.
4. **GDPR / CCPA compliance:** if any user data is collected and the user might be in EU or California, those regulations apply. Plan early.

---

## Section 9 — Summary of risk by category

| Category | Current state | Risk level (pre-launch) | Recommended action |
|---|---|---|---|
| License compatibility (bundling) | Verified MIT/Apache/BSD/ISC/CC0 only | Low | Continue per-tool verification |
| Copyright of cited values | Per-fixture provenance discipline | Low | Continue, avoid verbatim quotation |
| Copyright of graphics (symbols) | Explicit "original drawings, not copies" rule | Low | Confirm when canvas lands |
| Trademark "ChipBlocks" | Not verified at USPTO TESS | Medium pre-launch, HIGH post-launch | Manual TESS search before any launch |
| Patent considerations | Public-domain physics + methods only | Low | Patent landscape review before novel-algorithm work |
| AI-generated content | Disclosed + per-commit attribution | Low | Add user-verification statement |
| Warranty disclaimer | MIT covers, no explicit safety-critical disclaimer | Low (legal) but reputational risk | Add DISCLAIMER or expanded README section |
| Export control | Foundation stage, no controlled tech | Very low | Re-check at advanced-feature stage |
| Privacy / data protection | No data collected | Very low currently | Privacy Policy + opt-in posture before ship |
| Liability for misuse | MIT covers, but no domain-specific disclaimer | Low | Add safety-critical use disclaimer |

---

## When to consult an attorney

- Before any commercial launch or marketing campaign
- If a cease-and-desist or other legal notice arrives
- If a contributor's work appears to infringe a third-party patent or copyright
- Before relying on ChipBlocks output for any safety-critical application
- Before accepting external funding or signing acquisition / partnership agreements
- If user data collection or processing exceeds purely local-only operation
- Before any trademark filing
- If the project takes on commercial sponsorship that affects open-source posture

For day-to-day operation as a hobbyist-led open-source project at the foundation stage, the current legal posture is sound. The recommendations above are forward-looking hardening, not immediate fixes.

---

## License of this file

This file is part of ChipBlocks and is licensed under MIT, same as the rest of the project — see [LICENSE](LICENSE).

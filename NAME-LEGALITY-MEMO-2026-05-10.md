# Name Legality Memo — "ChipBlocks"
Date: 2026-05-10

**Disclaimer:** I am not a lawyer and this is not legal advice. This is a factual scan of public registries and the open web. For binding clearance, consult a trademark attorney before any commercial use, paid advertising, or trademark filing.

## Verdict
**GREEN-LEANING-YELLOW: ship as is for an open-source MIT-licensed solo project, but be aware of one descriptive-use overlap in the children's-toy category (PicassoTiles "Building Chip Blocks") that is in a different International Class. No direct same-name conflict in software, EDA, FPGA, or chip-design adjacent space was found.**

## Trademark search

- **USPTO (tmsearch.uspto.gov + Justia + Trademarkia indexes via Google):** No live registration or pending application for "ChipBlocks" or "Chip Blocks" as a unitary mark was returned. Justia and Trademarkia are exhaustive indexes of USPTO records and surface via Google for any registered mark — searches for the exact term returned zero matches in either index. Cannot fully confirm without an attorney pulling a knock-out search direct from tmsearch.uspto.gov, since the USPTO's new search UI is JS-rendered and not crawlable by the tools I had.
- **EUIPO (euipo.europa.eu / eSearch plus):** Could not reach the search results page directly (JS-rendered, CAPTCHA-gated). No "ChipBlocks" results surfaced via Google's index of EUIPO either. Treat this jurisdiction as **not confirmed clear** — anyone planning EU commerce should run a fresh eSearch plus query.
- **WIPO Madrid Monitor / Global Brand Database:** CAPTCHA-gated; could not pull results directly. Google's index of `branddb.wipo.int` returned no specific brand record for "chipblocks." Same caveat as EUIPO.

## Existing-project conflict

- **GitHub:** Exactly one repository named `chipblocks` exists — `unexpear/chipblocks` (this project). No competing repo. Adjacent names that exist: `chipsalliance/rocket-chip-blocks` (a CHIPS Alliance RTL peripheral library — different name, different audience, well-known org so worth knowing about), and `CircuitMess/CircuitBlocks` (Croatian Blockly-for-Arduino tool — different name, different audience).
- **npm:** No `chipblocks` or `chip-blocks` package on the registry.
- **PyPI:** No `chipblocks` package. Adjacent: `Chips-python`, `CHIP-IO`, `chipsec`, `chipwhisperer`, `pyblocks` — all unrelated, all differently named.
- **crates.io:** No `chipblocks` crate.

## Web presence

- **Domains:** `chipblocks.com` and `chipblocks.io` both returned `ECONNREFUSED` on direct HTTPS fetch, which strongly suggests they're unregistered or parked-without-A-record. WHOIS returned "no data found" for `.com`. Could not verify `.io`, `.dev`, `.app`, `.net`, `.org` definitively — Namecheap's WHOIS UI is JS-rendered. Recommend running an interactive check at `namecheap.com` / `whois.com` before relying on this finding.
- **Top web results for "chipblocks" / "chip blocks":**
  1. **PicassoTiles** — children's "Building Chip Interlocking Disc" construction toys sold on Amazon, Best Buy, etc. Often marketed with phrase "Building Chip Blocks Toy Set" as a *descriptive* product line, not as a registered standalone mark. PicassoTiles is the trademark; "chip blocks" is descriptive.
  2. Generic industrial usage — "chipblocks" / "chipblock" is a commodity term in wood-pallet manufacturing (compressed sawdust pallet feet, sold on Alibaba, TT Plywood, Fushi Wood Group). No single brand owns this.
  3. Football slang ("chip block" = blocking technique).
  4. Quilting ("Potato Chip Block" pattern).
  5. **Mr. Potato Head Chips** — Hasbro stacking-toy that uses "chips" as the play piece.
- **No commercial software, EDA tool, FPGA tool, or developer brand named "ChipBlocks" was found anywhere on the indexed web.**

## Risk assessment

- **Trademark infringement C&D risk:** Low. There is no apparent registered "ChipBlocks" mark in software (Nice Class 9) or design-services (Class 42) space. PicassoTiles is in Class 28 (toys/games) — different goods, different consumers, very different channels. The term "chip blocks" appears to be used descriptively by PicassoTiles rather than as a registered standalone mark. A toy company asserting rights against an open-source FPGA design tool would face an uphill confusion analysis.
- **"Confusingly similar to a real product" risk:** Low in software / hardware ecosystem. No EDA / FPGA / ASIC / chip-design product called "ChipBlocks" exists. The hardware-adjacent names that *do* exist (`rocket-chip-blocks`, `CircuitBlocks`) are spelled differently enough that a developer wouldn't confuse them.
- **Defensive trademark gap:** You have no filing. Anyone could file a US intent-to-use application tomorrow and start a priority race. If the project gets traction, this becomes a real concern — not a present risk, but a future one.
- **Descriptive-term risk:** "Chip" + "Blocks" is a fairly generic combination ("blocks" you compose into a "chip"). It may be hard to *defend* as a trademark even if you eventually file, because it borders on merely descriptive of the product's function. That cuts both ways — hard to defend, but also hard for anyone else to lock down.

## Recommendation

**Ship under the name "ChipBlocks" for the v0.1.0-alpha public launch.** Specific actions:

1. **No name change needed for the alpha.** The GitHub repo, npm/PyPI/crates namespace, and immediate web presence are all clean.
2. **Run two confirmation checks before the public announcement** (these need an interactive browser, which I couldn't do):
   - Direct knock-out search at `https://tmsearch.uspto.gov/` for "chipblocks" and "chip blocks" — confirm no Class 9 or Class 42 LIVE registrations.
   - Direct WHOIS at `whois.com` for `chipblocks.com`, `.io`, `.dev`, `.app`. If `.com` is available, register it ($10–15/yr) defensively to prevent squatters once the project gets any visibility.
3. **Add a short disclaimer to the README:** something like "ChipBlocks is an independent open-source project, not affiliated with PicassoTiles, the CHIPS Alliance, or any other entity using 'chip' in their name." Costs nothing, defuses confusion arguments preemptively.
4. **If/when traction arrives (~1k GitHub stars, press coverage, or a corporate sponsor):** consider filing a US intent-to-use trademark application (TEAS Plus, ~$250) in Class 9 (downloadable software) and/or Class 42 (SaaS / design services). This is the first real defensible move and is cheap.
5. **Consider monitoring** by setting a Google Alert for "ChipBlocks" so any new competing use surfaces early.

If you'd rather sidestep the descriptive-toy overlap entirely, alternatives that scan as distinctively yours and are clearly software-domain: `ChipForge`, `ChipFlow` (taken — chipflow.io is an existing chip-design startup, skip this), `BlockSilicon`, `Siliconauts`, `Tapeblock`. None of those have been formally checked here — same caveat applies.

**Bottom line: nothing in this scan suggests you'd be stepping on a real trademark or being confusingly similar to a real product by shipping under "ChipBlocks." The open-source / solo-dev / MIT / BYOK posture also makes you a low-value C&D target. Proceed, with the two confirmation steps and the disclaimer above.**

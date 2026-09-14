# Let’s Build a Zoo — Installed-Build Audit

**Audit date:** 2026-09-14
**Scope:** one installed Steam build, recoverable .NET code and content, dependency-chain behavior, onboarding, and feedback UX.
**ChipBlocks changes:** none.

## Verdict

Let’s Build a Zoo is a useful reference for ChipBlocks at the management and teaching layer, but not at the circuit-physics layer. The installed build has a recoverable .NET/MonoGame assembly with explicit state managers for food, shops, employees, research, customers, notifications, finances, and weekly summaries. It demonstrates how to make a dependency chain visible to a player without exposing every internal implementation detail.

The strongest transferable patterns are:

- staged onboarding that temporarily constrains the UI, points at the next action, and restores control after the required state change;
- dependency feedback that names the missing input or capacity rather than only reporting a generic failure;
- notifications that can be tracked to an off-screen target;
- daily/weekly summaries that compare outcomes over time;
- unlocks that explicitly map a research item to the buildings or capabilities it enables.

The game uses management abstractions and tuned game rules. Its code is not evidence for voltage, current, charge, timing, thermal, magnetic, or frequency-domain correctness.

## Build and recovery evidence

The Steam manifest is:

`D:\SteamLibrary\steamapps\appmanifest_1547890.acf`

Verified manifest values:

- AppID: `1547890`
- Name: `Let’s Build a Zoo`
- Install directory: `D:\SteamLibrary\steamapps\common\Let's Build a Zoo`
- Steam build ID: `20618772`
- Size on disk: `1,096,129,199` bytes

The executable is a self-contained Windows .NET 8 x64/MonoGame build, not a Unity or Unreal package:

- `LetsBuildAZoo.runtimeconfig.json` targets `.NETCoreApp,Version=v8.0` and includes the Windows Desktop runtime.
- `LetsBuildAZoo.deps.json` declares `MonoGame.Framework.WindowsDX`, `SEngineCore`, and the Spring UI/data libraries.
- `LetsBuildAZoo.dll` is `108,956,672` bytes, SHA-256 `3D7B7D31C09A294FD2C2862BCAC1277D6E3F19BC1582A80BBF6061F0842014AC`.
- `LetsBuildAZoo.exe` is `143,872` bytes, SHA-256 `76B2361DA334E1DB61D94B00F2D4F9677A1D999152CD0AB185958B834593EDBF`.
- `LetsBuildAZoo.dll` exposes roughly 3,000 named classes; the recovered namespace is primarily `TinyZoo`.

The assembly was inspected with ILSpy command-line `11.0.0.9375`. Targeted decompilations were written outside the repository to:

`C:\Users\micha\Desktop\lets-build-a-zoo-decompiled`

The full recovered type inventory is:

`C:\Users\micha\Desktop\lets-build-a-zoo-types.txt`

The installed content contains 358 `.xnb` assets, 22 `.csv` files, 6 news `.txt` files, and 8,144 English localization rows. The active save `Save\ZSV_0_0` is 1,639,616 bytes and begins as printable Base64-like text; it was not modified or decoded through the running game.

## Recovered mechanics

### 1. Onboarding is a state machine, not a static help page

`TinyZoo.Z_Save.CreateNewGame.NewGameCreator.SetNewGameFlags` initializes the main scenario with `FeatureFlags.BlockAllUI`, blocked land buying, blocked top-bar actions, and tutorial-specific build/trade flashing (`...NewGameCreator.cs:54-76`). The tutorial manager then starts individual classes rather than presenting one undifferentiated manual (`...TutorialManager.cs:121-126`, `301-361`).

The first sequence is concrete and verifiable:

- `WelcomeToTheZoo` blocks build, intake, settings, stats, breeding, timer, cash, and alerts, then unlocks animal intake only after the player reaches the intended map action (`...WelcomeToTheZoo.cs:23-39`, `54-87`).
- `StartTheDayTutorial` blocks most controls until the player starts the day and customers arrive; it then explains the animal-count/ticket-price relationship before returning control (`...StartTheDayTutorial.cs:28-39`, `48-102`).
- `Z_AdjustFood` guides the player into enclosure management, points to the diet control, and explains food quality, stockouts, store-room orders, and storekeepers (`...Z_AdjustFood.cs:24-29`, `47-77`).
- `Z_EmployZooKeeper` directs the player into hiring, highlights the hiring action, and waits for a keeper to actually be hired before releasing the UI (`...Z_EmployZooKeeper.cs:26-29`, `40-97`).
- `Z_ManageShop` teaches the shop options screen and waits for the player to reach `GAMESTATE.ManageShop` (`...Z_ManageShop.cs:14-41`).

**ChipBlocks lesson:** for complex flows such as symbol creation, simulation setup, or test authoring, use a short, stateful walkthrough that ends on a verified state change. Do not replace the existing physics or solver contracts with game-like abstractions.

### 2. Dependency chains are explicit in code and data

The installed `Content\CSV` tables define inspectable input data rather than hiding every value in sprites:

- `AnimalFoodRequirements.csv`: animal diet, food types, doses, and daily food quantity;
- `Food.csv`: food cost, shelf life, and shipping time;
- `Popularity.csv`: animal popularity, group-size parameters, habitat modifiers, diet, aggression, and enclosure compatibility;
- `EnrichmentData.csv`: animal-to-enrichment suitability scores;
- `BirthRates.csv`: birth chance and real chance;
- `ShopInventory.csv`: shop item, base sell price, and cost range.

The decompiled code joins these data sources into stateful chains:

- `StoreRooms.AutoOrderFood` calls `FoodDaysRemainingCalculator`, checks days remaining per food type, estimates the missing quantity and cost, then places orders only when auto-ordering is enabled and a nutritionist exists (`...StoreRooms.cs:44-91`). It emits different feedback for successful ordering versus insufficient cash.
- `StoreRoomContents.UseThis` consumes stock entries, records farmed/improbable provenance, and reports the usage to financial records (`...StoreRoomContents.cs:47-121`).
- `ShopData.CalculateStockPriceAndUse` consumes store-room inputs for shop recipes, falls back to meat or other inputs when needed, and returns a price derived from the stock slider and available source stock (`...ShopData.cs:1998-2065`).
- `ShopData.GetNeedFulfillment` attaches product-specific satisfaction modifiers, including quality/stock-slider effects (`...ShopData.cs:87-100`).
- `ShopStatus.BuiltABuilding` routes a built tile into a shop, employee facility, factory, store room, toilet, ATM, attraction, or decoration path; factories are registered with `ProductionLineCalc` and stores with `ShopNavigation` (`...ShopStatus.cs:416-620`).
- `Employees.GetProductionMultiplier` derives a bounded production multiplier from the number and levels of employees assigned to a shop (`...Employees.cs:149-171`).

This is a useful model for explaining a circuit result: show the immediate dependency (for example, a missing source, unconnected load, or contended driver), then expose the upstream path and the measured consequence.

### 3. Continuous simulation is converted into inspectable events

`LiveStats.UpdateInOverworld` advances timed effects and calls `ProcessZooMoments` (`...LiveStats.cs:511-623`). The event queue contains recognizable outcomes including births, factory completion, animal death, employee quitting, employee level-up, fights, gate breaks, and research-related state changes (`...LiveStats.cs:623-936`). Completed events update notification and quest scrubbers rather than only changing an invisible variable.

This is not a physics solver. It is a good observability pattern: preserve an event record with the source entity, affected target, time, and consequence so the UI can answer “what just changed?”

### 4. Feedback is trackable and target-aware

`GenericNotificationManager` translates notification types into actions. For animal hunger, no water, animal death, shop staffing, applicants, strike, ticket price, and related failures, tracking adds an off-screen pointer through `PointOffScreenManager`; build goals can pin a quest-tracking view (`...GenericNotificationManager.cs:60-121`).

The tutorial and notification systems also use arrows, dimming, blocked controls, and feature-reveal panels. This makes the next action visible without requiring the player to search the entire map.

**ChipBlocks comparison:** `src/renderer/net-inspector.ts:14-123` already provides endpoint roles and statuses including `contended`, `attention`, `driven`, `undriven`, and `passive`. `src/renderer/causal-replay.ts:6-339` already maps transitions and diagnostics to sources, nets, and terminals. The gap is mostly presentation consistency: use the same target-aware language for physics failures that the existing net inspector and causal replay already provide for digital/trace results.

### 5. Summaries turn history into feedback loops

The accounts graph compares the last 50 days of visitors, audience demand, revenue earned, revenue spent, and closing balance (`...CreateGraphData.cs:6-36`). Financial records maintain daily values, weekly archives, customer purchases, ingredient costs, visitor counts, and environmental quantities (`...FanancialRecords.cs:19-79`, `916-1022`).

The week summary sequences staff payment, accounts, and zoo progress (`...WeekSummaryManager.cs:63-139`). The newer end-of-week UI builds cubes for income, expenditure, profit, customers, reasons for leaving, utilities, staff, trash, and research (`...EndPOfWeekSummaryManager.cs:12-63`, `...IncomeCube.cs:36-125`).

**ChipBlocks lesson:** the equivalent is not a business dashboard. It is a run summary that groups solver evidence into voltage/current balance, timing, thermal, magnetic, and unsupported-model outcomes, with before/after comparisons when a design or parameter changes.

### 6. Unlocks carry dependency metadata

`REntry` stores an unlock type, research-point cost, category, description, and a `WillUnlockThese` list of tile/building types (`...REntry.cs:9-80`). `Unlocks.UnlockThis` records the unlock, updates group counts, adds the buildings to the researched lists, recalculates publicity/rating, emits feature reveals, and scrubs quests (`...Unlocks.cs:77-180`, `202-231`).

This is a strong reference for reusable ChipBlocks blocks: an authored block should be able to state its required interfaces, exposed terminals, supported analysis modes, and what downstream capabilities it enables. That metadata must remain separate from the numerical physics authority.

## Formula and data observations

The recovered rules are game rules, but their structure is useful:

- `AnimalTempData.FinalizeData` adjusts aggregate popularity using health, total animals, variants, and per-pen group-size efficiency; undersized groups and oversized groups take different penalties (`...AnimalTempData.cs:109-150`).
- `ShopData.GetPopularity` reduces duplicate-shop benefit using a diminishing-return calculation (`...ShopData.cs:32-64`).
- `Employees.GetProductionMultiplier` uses employee count and level, then clamps the multiplier to `1..10` (`...Employees.cs:149-171`).
- `CreateGraphData` preserves both demand (`PeopleWhoWantedToCome`) and realized visitors (`PeopleWhoCame`), which lets the player distinguish “not enough demand” from “demand existed but the zoo did not convert it” (`...CreateGraphData.cs:20-36`).

None of these formulas should be imported into ChipBlocks. The transferable part is exposing intermediate terms and the reason a final score/value changed.

## ChipBlocks mapping

Already present in the current repository:

- net inspection and endpoint roles: `src/renderer/net-inspector.ts:14-123`;
- causal source/diagnostic replay: `src/renderer/causal-replay.ts:6-339`;
- cycle traces and anomaly detection: `src/renderer/run-trace.ts:22-224`;
- expected-vs-actual block test cases: `src/renderer/block-tests.ts:4-79`;
- static timing, setup/hold, critical-path, and synchronizer analysis: `src/static-timing.ts:35-197`;
- transient result/status contracts and supported-device declarations: `src/transient-solver.ts:226-382`.

The highest-value design takeaways from this game are therefore UX-facing:

1. Keep a single “why” path from a visible failure to the responsible source, net, terminal, and measured value.
2. Give each warning a target or action when one exists: select the net, locate the driver, open the unsupported device, or show the failed test vector.
3. Present a run summary that compares the current result with a prior run or expected waveform.
4. Make dependency metadata inspectable: required pins, analysis support, source/load role, and downstream effects.
5. Use guided, reversible walkthroughs for advanced workflows; do not hide solver uncertainty behind a success-style progress bar.

## Limits and confidence

- High confidence in the installed build identity, assembly format, class names, method bodies, CSV schemas, and the observed UI/state relationships.
- Medium confidence in behavior not exercised interactively in this audit, especially timing-dependent customer movement and save migration paths.
- The save format is custom and starts as Base64-like text; it was inspected read-only and not altered.
- Decompiled output is recovered IL, not the developer’s original source. Names and control flow are strong evidence, but compiler/decompiler presentation can differ from the original project.
- This audit found no circuit solver or real-world physics authority in the game. Its popularity, staffing, stock, and visitor formulas are simulation-game mechanics.

## Reproduction commands

The following were run read-only:

```powershell
& "$env:USERPROFILE\.dotnet\tools\ilspycmd.exe" -l c "D:\SteamLibrary\steamapps\common\Let's Build a Zoo\LetsBuildAZoo.dll"
& "$env:USERPROFILE\.dotnet\tools\ilspycmd.exe" -t TinyZoo.PlayerDir.StoreRooms.StoreRooms "D:\SteamLibrary\steamapps\common\Let's Build a Zoo\LetsBuildAZoo.dll"
Get-FileHash "D:\SteamLibrary\steamapps\common\Let's Build a Zoo\LetsBuildAZoo.dll" -Algorithm SHA256
```

**Final result:** useful reference for ChipBlocks’ onboarding, dependency explanation, target-aware warnings, and run summaries; not a source for electronics physics. No ChipBlocks implementation, fixture, documentation, installed game, or save file was edited.

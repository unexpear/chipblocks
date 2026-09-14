# Chop Chop Inc. Deep-Dive Audit

**Audit date:** 2026-09-14
**Scope:** Installed Windows build, Unity managed assembly, decompiled C# implementation, shipped localization data, and comparison with the current ChipBlocks implementation.
**Change control:** No ChipBlocks source, tests, fixtures, or existing documentation were edited for this audit. This file is the only repository artifact added by this audit.

## Executive verdict

Chop Chop Inc. is a useful additional reference for ChipBlocks, but for a different layer than SHENZHEN I/O or CRUMB. Its strongest transferable ideas are **discrete production flow, typed resource contracts, configurable queues, event-driven observability, persistent world objects, and tutorialized dependency chains**. It is not evidence for electrical behavior: its resources are integer item quantities, its machines use wall-clock craft timers, and its delivery system is mission/trigger logic rather than a physical transport or circuit solver.

The most valuable verified mechanic is the automated-crafter queue. A queue entry stores a recipe asset ID, a finite or unlimited production target, an optional batch threshold for moving to the next entry, and a wait-or-skip policy when ingredients are unavailable. The scheduler checks inventories before selecting a recipe, advances round-robin, and persists both the queue and the current index. That is a strong reference for reusable ChipBlocks subgraphs, block test plans, build pipelines, or resource-flow views.

The second strong lesson is separation of concerns. A central service layer owns inventories, recipes, missions, shop orders, progression, world-object registration, save/load, and autosave; world objects expose small components and `ITickable` behavior; UI subscribes to state-change events. ChipBlocks already exceeds this game on physical correctness and instrumentation, but it can borrow the same explicit state ownership and user-facing dependency explanations.

## Evidence and provenance

### Installed build

- Steam AppID: `4369130` (`Chop Chop Inc.`).
- Steam build ID: `25187442`.
- Install directory: `D:\SteamLibrary\steamapps\common\ChopChopInc`.
- Main executable: `D:\SteamLibrary\steamapps\common\ChopChopInc\ChopChopInc.exe`.
- Main executable size: `667,648` bytes.
- Main executable SHA-256: `4152712A11628A3C29AD79DC9363D735A189C445FE8E0AEDD58E06AAE1DCDD1F`.
- Unity version from the executable file version: `6000.3.5f2` (`3fa8bc678cb0`).
- Main managed assembly: `D:\SteamLibrary\steamapps\common\ChopChopInc\ChopChopInc_Data\Managed\Assembly-CSharp.dll`.
- Managed assembly size: `917,504` bytes.
- Managed assembly SHA-256: `51CD8C70AD4692973786D5A31AB69C6B6E6FA4B4DEA3828152478E19CA6F19A1`.
- Unity player SHA-256: `E8519D73C626C96B191A0215A31E03AE00CA485A6ECF28D629B07E01C7101F39`.

### Recovery method

- Decompiled with `C:\Users\micha\.dotnet\tools\ilspycmd.exe` version `11.0.0.9375`.
- Decompiled output: `C:\Users\micha\Desktop\chop-chop-inc-decompiled-20260914`.
- ILSpy reported `569` class records and produced `508` C# files.
- The shipped English localization file is `D:\SteamLibrary\steamapps\common\ChopChopInc\ChopChopInc_Data\StreamingAssets\MainGame\Loca\en-US\Main_en-US.json`; it contains `2,661` entries.
- The Unity data contains serialized recipe, item, mission, and world-object assets, but this audit did not modify or patch the build and did not claim to reconstruct Unity inspector values that are not exposed by the managed assembly.

The recovered internal source paths are evidence from the installed build, not the original developer source tree. The conclusions below are based on decompiled control flow, field names, serialized-data contracts, UI bindings, and shipped localization strings.

## Recovered architecture

### Service and lifecycle layer

`C:\Users\micha\Desktop\chop-chop-inc-decompiled-20260914\LumberjackCore.cs` registers eight game states and 26 services. The service list includes asset loading, session data, recipes, inventory, world objects, money, shops, target-audience progression, missions, mission boards, session unlocks, player state, achievements, and autosave. This is a concrete separation between simulation state, persistence, progression, and UI rather than a single scene script.

`C:\Users\micha\Desktop\chop-chop-inc-decompiled-20260914\Service.WorldObject\WorldObjectServiceImpl.cs` maintains world-object registries, asset-ID indexes, reusable IDs, and a tickable table. `ITickable.Tick(float deltaTime)` is called from the world-object service, and objects can register/unregister individual tickable components. The system starts with a 16,384-entry tick table and doubles it if needed.

Transferable lesson: make each ChipBlocks runtime domain explicit about ownership, update order, registration, and teardown. Do not hide derived network state inside editor-only React state.

### Recipe model and manual crafting

`C:\Users\micha\Desktop\chop-chop-inc-decompiled-20260914\ScriptableObjects\Recipe.cs` defines:

- a `craftTime` in seconds;
- input and output ingredient arrays;
- item amounts;
- an option to spawn an output as one stacked item or as separate items;
- optional output game objects;
- an `unlockedAtStart` flag;
- display metadata and a minigame payload.

`C:\Users\micha\Desktop\chop-chop-inc-decompiled-20260914\WorldObjects.Useables\Crafter.cs` verifies every input requirement across one or more input inventories before crafting. On success it removes the exact required amounts, spawns item outputs or output objects, applies spawn modifiers, and emits an `onCrafted` event. Automatic crafting advances a timer by `deltaTime * craftSpeedFactor`; when the timer reaches `craftTime`, one craft is performed and the timer wraps with a remainder.

This is a clean discrete flow contract:

`inputs + recipe + time + unlock state -> consumed inputs + outputs + craft event`.

It is not an electrical equation. There is no voltage, current, impedance, conservation law, or analog convergence in this path.

### Automated-crafter queue

`C:\Users\micha\Desktop\chop-chop-inc-decompiled-20260914\WorldObjects\AutomatedCrafter.cs` stores each queue entry with:

- `recipeAssetID`;
- finite `Amount` or `UnlimitedAmount`;
- `MoveToNextQueueAfterCraftAmount` and its current counter;
- `MoveToNextQueueAfterTrying`, which controls whether an unavailable recipe blocks or lets the scheduler try the next entry.

The queue state saves `recipeQueue` and `currentRecipeQueueIndex`. The scheduler:

1. disables automatic crafting while selecting;
2. removes a completed finite entry;
3. tries the current entry first;
4. walks the queue with wraparound;
5. skips an entry after its configured batch count;
6. either waits on missing resources or continues to another entry;
7. enables crafting only after `HasAllIngredients` succeeds.

`C:\Users\micha\Desktop\chop-chop-inc-decompiled-20260914\UIAutomatedCrafterConfigureQueueEntry.cs` confirms the user-facing controls: production limit, amount per cycle, and wait-for-resources. New entries default to a finite production limit of `100`, a batch size of `10`, and “wait for resources” disabled.

This is the strongest ChipBlocks-relevant finding from this game. It maps well to a reusable block or build pipeline with explicit run limits, batching, retry policy, and blocked-state explanation.

### Inventory and transfer semantics

`C:\Users\micha\Desktop\chop-chop-inc-decompiled-20260914\Service.Inventory\Inventory.cs` stores integer item quantities by item ID and emits `onAmountChanged(itemID, oldAmount, newAmount, deltaAmount, wasSold)`. Negative changes clamp at the available amount; zero-quantity entries are removed. `TryToTransferAmount` performs an all-or-nothing transfer when the source contains enough items.

`C:\Users\micha\Desktop\chop-chop-inc-decompiled-20260914\UI.Inventory\UIInventoryTransferLogic.cs` exposes a slider and numeric input, clamps the requested transfer to the source amount, and applies the source decrement and target increment on acceptance. Recipe ingredient UI subscribes to the same inventory event and updates the displayed available/required amount immediately. Missing ingredients are rendered as a red partial count, for example `2/5`.

The useful design principle is not the item abstraction itself; it is the **single mutation event** shared by simulation, mission checks, and UI. ChipBlocks should continue to make net, terminal, current, voltage, thermal, and diagnostic changes observable through one consistent state path.

### Automatic inventory reaction

`C:\Users\micha\Desktop\chop-chop-inc-decompiled-20260914\WorldObjects.Useables\AutoInventoryCrafter.cs` subscribes to an inventory's `onAmountChanged` event. When a change makes an unlocked recipe craftable, it crafts once and can execute per-recipe actions, including spawning an object or destroying a configured object after crafting. A per-frame guard prevents a recursive chain from crafting repeatedly from the same inventory-change event.

This provides a verified reference for event-triggered subgraphs: a state change can activate a dependent operation, but the operation needs a re-entrancy/recursion guard and a clear event boundary.

### Orders, delivery, and missions

The shop path is a staged discrete workflow:

- `C:\Users\micha\Desktop\chop-chop-inc-decompiled-20260914\Service.Shop\ShopServiceImpl.cs` aggregates orders by item ID and count. The first order starts a shop-delivery mission if no relevant delivery mission is active.
- `C:\Users\micha\Desktop\chop-chop-inc-decompiled-20260914\WorldObjects\OnTrigger_SpawnShopOrders.cs` reads the queued orders when the delivery trigger fires, spawns the ordered item quantities at the configured location, and clears the order list.
- `C:\Users\micha\Desktop\chop-chop-inc-decompiled-20260914\Service.Mission.Mission.cs` composes start actions, checks, success actions, and fail actions. It ticks checks, solves or fails the mission, runs the corresponding action list, and then destroys the mission instance.
- Mission checks cover inventory amount, total amount, total worth, shop orders, unlocked recipes, unlocked shop items, timers, player state, object counts, position, and combined subchecks.

The installed `DeliveryDrone` component itself is only a persistent world-object shell; the actual order/delivery semantics are implemented by shop state, missions, triggers, item spawning, and inventory checks. This distinction matters: a visible drone is not proof of a simulated transport network.

The English localization independently confirms this flow with shipped strings including:

- `Mission_Check_InventoryAmount_DroneLandingPadInventory`: “Store {current}/{target} {item} in the drone landing pad.”
- `Mission_Tutorial_WaitForDroneEarnMoney`: “Wait for the drone and receive {target} {item} for your stuff.”
- `Mission_Tutorial_WaitForDroneToSell`: “Wait for the drone to collect the furniture.”
- `Mission_Tutorial_PutStuffIntoDronePlatform`: “Put your crafted stools {current}/{target} into the drone landing pad.”
- `Mission_Tutorial_GoToDeliveryArea`: “Go to the delivery dropoff location and wait for the delivery truck.”
- `Mission_Check_ShopOrder_PC`: “Use your PC and order {current}/{target} {item}.”

### Progression and persistence

`C:\Users\micha\Desktop\chop-chop-inc-decompiled-20260914\Service.Recipe\RecipeServiceImpl.cs` unlocks startup recipes from serialized asset flags and emits unlock events. `Service.Shop.ShopServiceImpl` does the same for initial shop entries. `Service.TargetAudience.TargetAudienceServiceImpl` maintains raw and clamped values per audience, derives total progress as the sum of clamped values divided by the sum of maximum values, and emits both per-audience and total-progress events.

`C:\Users\micha\Desktop\chop-chop-inc-decompiled-20260914\Service.SessionData\SessionDataServiceImpl.cs` serializes session data and world-object save data to `.sav` files under Unity's persistent-data path. `Service.Autosave.AutosaveServiceImpl.cs` supports 15-minute, 30-minute, 60-minute, or off intervals. It defers an autosave while the player/UI is in a state where hiding the player or controls are active, then switches to a save game state.

Transferable lesson: persist user-authored configuration and runtime progress together, but keep the save boundary explicit. For ChipBlocks this applies to circuit-block parameters, custom symbols/footprints, test cases, and derived diagnostics that can be recomputed and validated after load.

## Comparison with current ChipBlocks

### Where ChipBlocks already matches or exceeds this reference

- `C:\Users\micha\Desktop\chipzzzd\src\renderer\net-inspector.ts` already classifies endpoints as drivers, loads, passives, or unknown and reports driven, undriven, passive, and contended net states with wire current, voltage drop, length, and resistance where available.
- `C:\Users\micha\Desktop\chipzzzd\src\renderer\causal-replay.ts` already maps digital transitions, transient net changes, current transitions, solver warnings, and anomalies back to source blocks, terminals, and nets.
- `C:\Users\micha\Desktop\chipzzzd\src\renderer\run-trace.ts` records per-cycle values, settling, gate sweeps, register changes, power-up dependence, pulses, and slow cycles.
- `C:\Users\micha\Desktop\chipzzzd\src\renderer\block-tests.ts` already supports deterministic cycle tests with expected output arrays and per-cycle failures.
- `C:\Users\micha\Desktop\chipzzzd\src\static-timing.ts` and `C:\Users\micha\Desktop\chipzzzd\src\renderer\timing-panel.tsx` provide real RC-derived delay, critical-path, setup-slack, hold-violation, and maximum-frequency analysis.
- ChipBlocks also has solver-backed DC, transient, AC, device, electro-thermal, magnetic, scope, meter, PCB, and FPGA features. Chop Chop Inc. has no comparable physical circuit model.

### High-value lessons to borrow

1. **Explicit flow contracts:** Give reusable ChipBlocks assemblies a visible contract for inputs, outputs, timing, state, and blocked conditions, analogous to a recipe's input/output/time/unlock contract.
2. **Queue policies as first-class state:** For test benches, FPGA build stages, or future resource-flow features, expose finite/unlimited runs, batch thresholds, retry/skip behavior, current entry, and remaining work instead of hiding them in scheduler code.
3. **One mutation/event path:** Keep net and device state changes observable by the solver, diagnostics, replay, and UI through a consistent event or snapshot boundary.
4. **Explain blocked work:** Show the first missing resource, unavailable dependency, incompatible endpoint, or failed prerequisite. Borrow the game's immediate missing-versus-required display, but use ChipBlocks' electrical and timing diagnostics for the underlying reason.
5. **Separate domain state from UI:** Keep graph membership, runtime values, queue state, and derived diagnostics in domain models; let panels subscribe and render them.
6. **Persist and validate reusable systems:** Save block configuration, test cases, and custom authoring data with explicit versioning, then validate connectivity and recompute derived results on load.
7. **Teach dependency chains:** Use staged tutorials and inspectable “why is this blocked?” explanations to connect schematic edits to the resulting physical or timing consequence.

## What not to copy

- Do not treat item counts, production timers, mission checks, or delivery triggers as analog flow, voltage, current, impedance, power, or energy equations.
- Do not infer a transport simulation from the visible drone. The recovered drone component is a saveable shell; the verified delivery behavior is order aggregation plus mission/trigger/item-spawn logic.
- Do not replace ChipBlocks' solver-backed net analysis with a scalar resource count or a purely visual dependency graph.
- Do not claim that Chop Chop Inc. provides deterministic replay, waveform debugging, KCL/KVL validation, or formal setup/hold analysis; those were not recovered.
- Do not overstate the automated-crafter missing-resource color. The queue UI defines a `MissingResource` highlight state, but the recovered call sites visibly apply active/normal highlighting and the wait/skip control; a live missing-resource highlight path was not established by this static audit.

## Audit findings

### Confirmed strengths

- The installed Unity build contains recoverable, organized application code rather than only opaque scene data.
- The automated crafter has a real persisted queue with finite/unlimited production, batch rotation, and wait/skip semantics.
- Recipes, inventories, missions, shop orders, progression, world objects, save/load, and UI are separated behind service/component contracts.
- Inventory mutation events drive dependent UI and mission behavior, and automatic crafting includes a re-entrancy guard.
- Shipped localization independently confirms the tutorial's production → storage → ordering → delivery dependency chain.

### Limits and uncertainty

- This was a static decompilation audit. No debugger attachment, runtime instrumentation, save-file mutation, or game patching was performed.
- Unity serialized inspector values for every recipe, item, and mission were not reconstructed; conclusions about algorithmic behavior come from managed code and localization, not guessed asset values.
- The decompiled output is an analysis artifact outside the ChipBlocks repository: `C:\Users\micha\Desktop\chop-chop-inc-decompiled-20260914`.
- No electrical, thermal, magnetic, or continuous-flow equations were recovered from this game because they are not part of its verified production model.

## Final recommendation

Use Chop Chop Inc. as a reference for **resource-flow UX, queue policy, dependency explanations, event-driven updates, persistence, and staged onboarding**. It is especially relevant to future ChipBlocks circuit-block authoring and test orchestration, where users need to see what is ready, blocked, waiting, or advancing. Keep physics correctness anchored in the existing ChipBlocks equations, cited device references, solver tests, and instrument validation—not in this game's discrete economy model.

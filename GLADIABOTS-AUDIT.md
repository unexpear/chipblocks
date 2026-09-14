# Gladiabots Audit

**Audit status:** Complete  
**Audit scope:** Installed Gladiabots build only  
**Application code changes:** None

## Provenance

The installed Unity Mono assemblies were decompiled for private behavioral analysis using [ILSpy command-line documentation](https://github.com/icsharpcode/ILSpy/blob/master/ICSharpCode.ILSpyCmd/README.md?plain=1).

Recovered output was written outside the ChipBlocks repository:

- `C:\Users\micha\Desktop\gladiabots-decompile`
- `C:\Users\micha\Desktop\gladiabots-decompile-firstpass`

The installed executable reports Unity `2022.3.40f1` and was last modified on 2026-09-11.

Assembly fingerprints:

| Assembly | SHA-256 |
| --- | --- |
| `Assembly-CSharp.dll` | `91DBF91CB2EF7C9C5C605C8EB2C7DF3BDDFF7464197A85271E9CCEA1981435A7` |
| `Assembly-CSharp-firstpass.dll` | `416602ABD4DBE5D31FAE22C1E908570D675624B3D9E3DE64E6FC856BE5BF409B` |

The main game assembly produced 303 C# files. The relevant `GFX47` first-pass assembly produced 221 C# files. Decompiled output is C#-like recovered code, not the original source with its original comments or project structure.

## Verified Architecture

### Persisted executable graph

`AI` stores a list of `AINode` objects. Nodes have stable IDs, positions, typed node kinds, typed actions or conditions, target specifications, optional sub-AI references, comments, and output-node IDs.

The graph supports:

- Root, condition, action, connector, sub-AI, and comment nodes.
- Typed target kinds, filters, filter inversion, category-level AND/OR combinations, and target selectors.
- Link cleanup, duplicate-link removal, invalid-link removal, and deterministic output ordering during save.
- Whole-graph copy, undo, redo, duplication, deletion, and migration of older saved graph formats.

### Editor interaction

The editor implementation includes:

- Async graph loading with a loading/cancellation path for large graphs.
- Snap-to-grid placement, zoom, fit-to-viewport, and linked-node movement.
- Multi-selection, duplicate/copy/cut/paste, delete, and link dragging.
- Sub-AI navigation with parent-path tracking and a back-to-parent action.
- Read-only mode for inspecting graphs without editing them.
- Runtime node status visuals: valid and invalid nodes are shown differently, and inactive paths are faded.

### Runtime evaluation

Each bot evaluates its AI starting at the root during scheduled AI ticks. Evaluation walks the graph in output order and:

1. Marks root and connector nodes as traversable.
2. Evaluates target filters and conditions.
3. Resolves target selectors such as closest, farthest, weakest, strongest, and distance-to-resource.
4. Checks action-specific validity, including required targets and state constraints.
5. Selects the first valid action path and executes it at the correct turn phase.

The runtime caches target queries and condition checks per AI tick. It also enforces a maximum evaluable-node count and records `Unchecked`, `Valid`, or `Invalid` status for every evaluated graph path, including nested sub-AIs.

### Deterministic execution and replay

The recovered `GFX47.DeterministGame` loop advances fixed turns and runs these phases in order:

```text
ExecuteActions -> PreTurn -> Turn -> PostTurn -> PostTurn2
```

The game uses fixed turn duration, deterministic randomizers, integer-based position math, explicit entity registration, and state-hash methods. Gladiabots replay/time-shift behavior restarts the match and deterministically advances it to the requested time, rather than mutating the current state arbitrarily.

Gladiabots also supports:

- Pause, resume, slow motion, and fast-forward.
- Tick-by-tick playback for a selected bot.
- Selected-bot AI visualization during simulation.
- Replay-mode match loading and replay restart.
- Collision/repulsion resolution after bot actions.

## ChipBlocks Comparison

ChipBlocks already has stronger electrical and physical-modeling foundations than Gladiabots:

- Hierarchical blocks, ports, inner nodes, and inner edges in `src/renderer/blocks.ts`.
- Digital cycle traces and expected waveform tests in `src/renderer/run-trace.ts` and `src/renderer/block-tests.ts`.
- Independent transient timeline recording and scrubbing in `src/renderer/use-timeline.ts`.
- Causal explanations for trace anomalies and timeline changes in `src/renderer/causal-replay.ts`.
- Net endpoint roles, contention detection, driven/undriven states, and net inspection in `src/renderer/net-inspector.ts`.

The highest-value Gladiabots pattern for ChipBlocks is therefore not its game physics. It is the explicit runtime execution model:

- Give every evaluated block or internal node a clear per-step status.
- Preserve parent-path context for hierarchical blocks.
- Show why a node was skipped, invalid, active, or selected.
- Keep replay state deterministic and inspectable.
- Surface evaluation limits and unresolved paths as first-class diagnostics.

This should complement—not replace—the existing electrical net, solver, waveform, timing, thermal, and causal diagnostics.

## Audit Conclusion

Gladiabots is a useful reference for graph authoring, deterministic execution, status visualization, hierarchy, and replay inspection. It is not an authority for circuit physics. No Gladiabots code was copied into ChipBlocks, and no ChipBlocks application or documentation behavior was changed as part of this audit.


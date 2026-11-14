---
Status: accepted (round 89, #57; the user ruled at the mid-wave gate of 09.11.2026). Supersedes ADR 0009.
---

# The search tree holds no chance nodes: chance is priced at the root cells and where the merge weighs the trees' classes

ADR 0009 kept the tree's chance nodes built and switched off (`CHANCE_NODES = false`, since round 43), because a second attempt would start from them. Round 89 asked whether any path needs them, and none does. The constant was a literal `false` with no environment read and no setter, so `expandCell` always took `singleChild`, and `groupedDraw`, `groupedChildren`, `makeChanceNode`, `pickClass` and the chance branches of `mcts.ts` and `search/mcts-node.ts` never ran in the app, the worker, the bank or the feedback corpus. Their one spec, `eval-mcts-chance.spec.ts`, sat under `describe.runIf(CHANCE_NODES)` and skipped on every run.

The second attempt that ADR 0009 waited for came in another shape and needed none of that code. T322 block 1 (round 89) prices chance in the tree through the root cells: each tree books the class its root draw showed (`classKey`, `classWeight`), the doubles trees name theirs through the pair plan, and the merge weighs the classes by their Dex chance (`keyedCell` in `search/merge-pool.ts`). The cell sampler still prices the root cells by outcome classes, and the tree below the root stays flat, with one outcome per cell from `treeSeed`.

The decision of round 89:

- **Deleted.** `CHANCE_NODES`, `CHANCE_MAX_DEPTH`, `TREE_FORCED_CAP`, `GROUP_SEEDS`, `GROUP_MAX_DEPTH`, `groupedDraw`, `search/chance-node.ts`, `groupedChildren` in `search/outcome-children.ts`, the chance branches of `selectAndExpand`, `lineFrom` and `treeMatrix`, `eval-mcts-chance.spec.ts` and the `groupedChildren` rows of two other specs. `cellStats` moved to `search/mcts-node.ts` and writes decision cells only.
- **Kept.** `classChildren` and `drawChild` in `search/outcome-children.ts` (the endgame solver, the forced-win prover), the class book of the root cells (`singleChild`, `doublesRootChild`), and the merge's reader of `cells[].classes` (`pooledChanceValue`, `classPoolEntry` in `search/merge-pool.ts`) with the optional `classes` field of `MctsTreeStats`. Nothing writes that field any more; its removal is a follow-up that touches the engine's tree statistics type and its specs.
- **Lossless.** The deleted paths were unreachable, so no score, line or dump moves, and no cache version, protocol or API version changes.

## Considered options

- Keep the machinery, as ADR 0009 ruled: rejected. The code read like live code (T305 named it as the path round 86 should widen, and the review of 03.11.2026 found the slip), and the tests that guarded it never ran.
- Switch it on again with a deficit pick: the measurement of round 43 stands (the bank read +12 bp late, doubles cost +44 to +70 %, and the play-out pin flipped), and nothing since has changed the visit split that caused it.
- Revive it from git history if a later round wants a chance node: the code sits in commits up to `462bac2e` (`search/chance-node.ts`, `search/expansion.ts`, `groupedChildren`).

## Consequences

- ADR 0009 stays in the repository as the record of why round 43's tree lost and why the outcome-class children of the endgame solver and the prover stay.
- `FORCED_SWITCH_NODES` also goes: forced switches are decision nodes in the tree (round 42), and the constant held only the value `true`.
- A new feature that wants chance inside the tree starts from the root-cell keys and the merge's class weights, and writes its own spec first.

Sources: `docs/adr/0009-chance-is-priced-by-outcome-classes-and-tree-chance-nodes-stay-off.md`, #57, the mid-wave gate of 09.11.2026, T322 block 1.

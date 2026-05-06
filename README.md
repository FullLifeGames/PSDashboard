# PS Replay Interceptor

PS Replay Interceptor is an early-stage web app for replay-based "what if?" analysis on Pokemon Showdown battles. It loads a Showdown replay, reconstructs the battle state up to a chosen turn, and then lets you branch from that point by selecting alternative moves or switches for both sides.

The current implementation is a working prototype, not a fully accurate replay recreation engine yet. It is best treated as an exploratory simulator built from replay evidence plus inferred hidden information.

## Current Capabilities

- Load a Pokemon Showdown replay from a replay URL or replay ID.
- Render the original replay inside an embedded Pokemon Showdown replay viewer.
- Parse the replay protocol into per-turn snapshots.
- Infer both teams from replay data, including revealed moves, items, abilities, levels, gender, and tera type when shown.
- Accept a pasted player team export to improve reconstruction accuracy.
- Normalize German stat abbreviations in pasted team exports.
- Fetch optional Smogon usage stats and `@pkmn/smogon` set assumptions for unrevealed abilities, items, moves, natures, and EV spreads.
- Display whether team data is revealed from the replay, guessed from usage stats, or manually edited.
- Edit reconstructed information for both players before branching.
- Select a turn and branch from that point into a controllable simulator.
- Pick moves or switches for both players and advance the branch turn by turn.
- Use slot-aware and target-aware controls for doubles battles, including blocking duplicate simultaneous switch targets.
- View lightweight damage estimates for currently available moves, including per-target previews in doubles.
- Animate newly executed branch turns, or disable animation to jump straight to the result.
- Compare branch history against the original replay line after executing alternate turns.
- Save branch summaries locally and create share links containing the replay id, branch turn, branch choices, and final branch log.
- Show a battle statistics panel for both teams.

## What "Works" Today

As of the current repository state:

- `npm run lint` passes.
- `npm run build` succeeds.
- `npx playwright test` passes with 35 browser tests.
- `npm run test:regression` runs replay reconstruction, save/share, damage-preview, branch choice, and pure-engine regression tests.

The browser test suite validates the main happy path with a mocked replay fixture:

- load replay
- render replay iframe
- select a branch turn
- enter branch mode
- show move and switch controls
- enable turn execution after both choices are selected
- return to the original replay

## Where Accuracy Is Still Limited

This project is not yet a frame-perfect recreation of the original battle. The current branch state is rebuilt from:

1. the replay protocol
2. an inferred team model
3. optional Smogon usage-stat fallbacks for hidden information
4. a post-reconstruction HP/status correction step

That means branch outcomes can diverge from the original replay when hidden information matters. Important limitations today:

- Hidden moves, EVs, IVs, natures, and some items/abilities can be guessed when they were not revealed in the replay.
- Probability-backed guesses come from Smogon monthly `chaos` usage stats when they can be fetched. If usage stats are unavailable or incomplete, `@pkmn/smogon` set data can provide non-probability set assumptions before the app falls back to unknown/default simulator values.
- HP and status are corrected from the snapshot at branch start, but other hidden or volatile state may still differ.
- Doubles battles have multi-active reconstruction, explicit target reconstruction, redirection/retargeting fixtures, and protocol correction for `switch`/`drag` active-slot evidence, but unusual targeting effects and some volatile state can still diverge.
- Save/share links are compact branch reports today; they do not yet fully restore and replay an alternate line from scratch.
- Replay viewing and sprite rendering depend on Pokemon Showdown-hosted assets.
- The automated tests use a mocked replay response and do not yet cover a large replay corpus or difficult edge cases.

## Local Development

### Requirements

- Node.js
- npm

If Playwright browsers are missing locally, install them once with:

```bash
npx playwright install
```

### Install

```bash
npm install
```

### Run the app

```bash
npm run dev
```

Open the local Vite URL shown in the terminal.

### Quality checks

```bash
npm run lint
npm run build
npm run test:e2e
npm run test:regression
```

## How To Use The Prototype

1. Paste a replay URL or replay ID into the loader.
2. Optionally expand the team section and paste your own exported team to improve reconstruction.
3. Load the replay.
4. Scrub to a turn using the replay viewer or the branch slider.
5. Click `Branch Here`.
6. Choose a move or switch for both sides.
7. Execute the turn and continue exploring the branch.
8. Use `Edit Player` or `Edit Opp` if you want to override inferred details before branching.

## Repository Map

- [`src/App.tsx`](./src/App.tsx) hosts the main application flow.
- [`src/hooks/useReplay.ts`](./src/hooks/useReplay.ts) loads the replay and derives snapshots plus inferred team data.
- [`src/hooks/useBranch.ts`](./src/hooks/useBranch.ts) manages React state for the live branch simulator.
- [`src/lib/branch-engine.ts`](./src/lib/branch-engine.ts) reconstructs the battle up to a selected turn in a pure, directly testable module.
- [`src/lib/protocol-parser.ts`](./src/lib/protocol-parser.ts) converts replay protocol logs into turn snapshots.
- [`src/lib/opponent-inferrer.ts`](./src/lib/opponent-inferrer.ts) extracts revealed team information from the replay log.
- [`src/lib/team-builder.ts`](./src/lib/team-builder.ts) builds simulator teams from replay evidence, pasted teams, and usage-stat guesses.
- [`src/lib/smogon-stats.ts`](./src/lib/smogon-stats.ts) fetches and normalizes Smogon monthly usage probabilities.
- [`src/lib/smogon-sets.ts`](./src/lib/smogon-sets.ts) fetches normalized fallback set assumptions through `@pkmn/smogon`.
- [`src/lib/team-info.ts`](./src/lib/team-info.ts) enriches revealed team data while preserving revealed/guessed/manual source labels.
- [`src/components/PSReplayFrame.tsx`](./src/components/PSReplayFrame.tsx) renders the Showdown replay viewer in an iframe.
- [`src/components/BranchPanel.tsx`](./src/components/BranchPanel.tsx) renders move and switch controls for the active branch.
- [`src/components/BranchSaveSharePanel.tsx`](./src/components/BranchSaveSharePanel.tsx) saves branch summaries locally and creates compact share links.
- [`src/components/BattleStatsPanel.tsx`](./src/components/BattleStatsPanel.tsx) shows inferred team information for both players.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) explains the current internal flow in more detail.

## Sample Inputs In The Repo

- [`replay.txt`](./replay.txt) contains a sample replay URL.
- [`team.txt`](./team.txt) contains a sample team export with German stat labels.

## Notes For Contributors

- This repository still contains a few unused or experimental files from earlier UI directions.
- The current app path uses the Showdown iframe viewer plus the `useBranch` simulator hook.
- The production bundle is large because the simulator and learnset data are included client-side.

## Next Priorities

- Turn branch share links into full replayable branch restores.
- Improve reconstruction fidelity for unusual targeting effects and volatile hidden battle state.
- Expand the replay regression suite with many more real replays and expected snapshots.
- Continue reducing async chunk size for `@pkmn/dex`, learnsets, and protocol parsing.
- Add deeper branch comparison tools.

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
- Select a turn and branch from that point into a controllable simulator.
- Pick moves or switches for both players and advance the branch turn by turn.
- View lightweight damage estimates for currently available moves.
- Edit inferred opponent information before branching.
- Show a battle statistics panel for both teams.

## What "Works" Today

As of the current repository state:

- `npm run lint` passes.
- `npm run build` succeeds.
- `npx playwright test` passes with 15 browser tests.

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
3. common-set fallbacks for hidden information
4. a post-reconstruction HP/status correction step

That means branch outcomes can diverge from the original replay when hidden information matters. Important limitations today:

- Hidden moves, EVs, IVs, natures, and some items/abilities are guessed when they were not revealed in the replay.
- Opponent defaults come from a hardcoded common-set library, which is useful for prototyping but not authoritative.
- HP and status are corrected from the snapshot at branch start, but other hidden or volatile state may still differ.
- The current branch flow is built for singles replays and has not been generalized for doubles or more complex battle formats.
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
```

## How To Use The Prototype

1. Paste a replay URL or replay ID into the loader.
2. Optionally expand the team section and paste your own exported team to improve reconstruction.
3. Load the replay.
4. Scrub to a turn using the replay viewer or the branch slider.
5. Click `Branch Here`.
6. Choose a move or switch for both sides.
7. Execute the turn and continue exploring the branch.
8. Use `Edit Opp` if you want to override inferred opponent details before branching.

## Repository Map

- [`src/App.tsx`](./src/App.tsx) hosts the main application flow.
- [`src/hooks/useReplay.ts`](./src/hooks/useReplay.ts) loads the replay and derives snapshots plus inferred team data.
- [`src/hooks/useBranch.ts`](./src/hooks/useBranch.ts) reconstructs the battle up to a selected turn and manages the live branch simulator.
- [`src/lib/protocol-parser.ts`](./src/lib/protocol-parser.ts) converts replay protocol logs into turn snapshots.
- [`src/lib/opponent-inferrer.ts`](./src/lib/opponent-inferrer.ts) extracts revealed team information from the replay log.
- [`src/lib/team-builder.ts`](./src/lib/team-builder.ts) builds simulator teams from replay evidence, pasted teams, and fallback sets.
- [`src/lib/common-sets.ts`](./src/lib/common-sets.ts) contains fallback competitive sets for hidden information.
- [`src/components/PSReplayFrame.tsx`](./src/components/PSReplayFrame.tsx) renders the Showdown replay viewer in an iframe.
- [`src/components/BranchPanel.tsx`](./src/components/BranchPanel.tsx) renders move and switch controls for the active branch.
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

- Improve reconstruction fidelity for hidden battle state.
- Separate replay reconstruction from UI state so it can be tested more directly.
- Add a real replay regression suite covering different formats and edge cases.
- Reduce bundle size by code-splitting simulator-heavy dependencies.
- Add branch history, save/share support, and better debugging tools.

# Architecture Notes

This document describes how the current prototype works internally and where its biggest approximation points are.

## End-to-End Flow

### 1. Replay loading

The app starts in [`src/components/ReplayLoader.tsx`](./src/components/ReplayLoader.tsx), where the user provides:

- a replay URL or replay ID
- optionally a pasted team export

`useReplay` then:

1. normalizes the replay input in `parseReplayUrl`
2. fetches `https://replay.pokemonshowdown.com/<id>.json`
3. parses the replay log into snapshots
4. infers visible team information for both sides

Relevant files:

- [`src/hooks/useReplay.ts`](./src/hooks/useReplay.ts)
- [`src/lib/replay-fetcher.ts`](./src/lib/replay-fetcher.ts)
- [`src/lib/protocol-parser.ts`](./src/lib/protocol-parser.ts)
- [`src/lib/opponent-inferrer.ts`](./src/lib/opponent-inferrer.ts)

### 2. Snapshot creation

`parseReplayLog` uses `@pkmn/client` to feed the raw replay protocol into a battle client and record snapshots at turn boundaries.

Each `TurnSnapshot` stores:

- both sides' Pokemon state
- field state
- side conditions
- the chunk of protocol associated with that snapshot

This snapshot data powers the turn slider and is also used later to partially correct reconstructed simulator state.

### 3. Team reconstruction

When the user starts a branch, `buildTeamsFromReplay` creates `PokemonSet[]` values for both sides.

The current precedence is:

1. revealed information from the replay
2. the user's pasted team for `p1`, when provided
3. common-set fallbacks for anything still unknown

This is the most important approximation point in the current implementation. The branch engine can only be as accurate as the reconstructed teams.

Relevant files:

- [`src/lib/team-builder.ts`](./src/lib/team-builder.ts)
- [`src/lib/common-sets.ts`](./src/lib/common-sets.ts)
- [`src/lib/team-parser.ts`](./src/lib/team-parser.ts)

### 4. Branch reconstruction

`useBranch` is the core of the prototype.

When `startBranch` runs, it:

1. creates a new `@pkmn/sim` battle
2. reorders both teams so the replay lead appears first
3. starts the battle and sends `default` for team preview
4. splits the replay protocol into turn blocks
5. replays original choices turn by turn until the target branch turn
6. handles follow-up forced switches when the simulator requests them
7. corrects HP and status from the selected snapshot
8. exposes the resulting simulator state to the UI

After branch entry, the user can choose actions for both sides and `executeTurn` submits them to the live simulator.

Relevant file:

- [`src/hooks/useBranch.ts`](./src/hooks/useBranch.ts)

## UI Structure

The main application surface in [`src/App.tsx`](./src/App.tsx) has two modes:

- original replay mode
- branch mode

### Original replay mode

- `PSReplayFrame` renders the fetched replay log through a generated HTML document.
- That HTML bootstraps `replay-embed.js` from Pokemon Showdown.
- Turn updates are posted back to the parent window so the branch slider can follow the replay viewer.

### Branch mode

- `PSReplayFrame` renders the branch simulator log instead of the original replay log.
- `BranchPanel` shows move and switch controls for both sides.
- `BattleStatsPanel` stays visible to show inferred team information.
- `OpponentEditor` lets the user override inferred opponent fields before branching.

Relevant files:

- [`src/components/PSReplayFrame.tsx`](./src/components/PSReplayFrame.tsx)
- [`src/lib/replay-html.ts`](./src/lib/replay-html.ts)
- [`src/components/BranchPanel.tsx`](./src/components/BranchPanel.tsx)
- [`src/components/BattleStatsPanel.tsx`](./src/components/BattleStatsPanel.tsx)
- [`src/components/OpponentEditor.tsx`](./src/components/OpponentEditor.tsx)

## Approximation Points

These are the main reasons the current simulator can diverge from the real battle:

### Hidden information

The replay log does not expose every relevant battle input. Unknown values are currently inferred or guessed:

- unrevealed moves
- EVs/IVs/natures
- unrevealed items and abilities
- some tera details before reveal

### Replay choice reconstruction

The branch engine reconstructs prior choices from protocol lines such as `|move|` and `|switch|`. This works for the covered happy path, but complex edge cases can still break reconstruction.

### Partial state correction

After replaying turns inside the simulator, the code corrects HP and status from the selected snapshot. This helps reduce visible divergence, but it does not fully reconcile every hidden or transient state.

### External viewer dependency

The replay viewer and sprite assets are loaded from Pokemon Showdown-hosted resources. The app is not fully self-contained today.

## Validation Status

The current codebase has been validated with:

- `npm run lint`
- `npm run build`
- `npx playwright test`

The Playwright suite covers the main browser flow with a mocked replay fixture, but it does not yet serve as a replay-accuracy benchmark.

## Unused Or Alternate Code Paths

A few files are present but are not part of the current app path:

- [`src/components/BattleView.tsx`](./src/components/BattleView.tsx)
- [`src/components/BattleScene.tsx`](./src/components/BattleScene.tsx)
- [`src/hooks/useTimeline.ts`](./src/hooks/useTimeline.ts)
- [`src/lib/battle-simulator.ts`](./src/lib/battle-simulator.ts)

These look like earlier or alternate directions. They may still be useful, but they currently increase maintenance surface without contributing to the live app flow.

## Recommended Refactor Direction

If the project continues, the cleanest next architectural move would be to split the system into three separately testable layers:

1. replay ingestion and inference
2. deterministic branch reconstruction
3. UI rendering and controls

That would make it much easier to measure reconstruction accuracy, build replay regression tests, and keep the frontend moving without coupling it to simulator internals.

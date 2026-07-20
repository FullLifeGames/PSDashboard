# Architecture Notes

This document describes how the current prototype works internally and where its biggest approximation points are.

## End-to-End Flow

### 1. Replay loading

The app starts in [`src/components/ReplayLoader.tsx`](./src/components/ReplayLoader.tsx), where the user provides:

- a replay URL or replay ID
- or a locally exported replay file (a "Download replay" `.html` export or a raw protocol log), via drag & drop or the file picker
- optionally a pasted team export

`useReplay` then:

1. normalizes the replay input in `parseReplayUrl` and fetches `https://replay.pokemonshowdown.com/<id>.json` — or, for files, parses the export in `parseExportedReplay` (the export wraps the log in a `text/plain` script with `/` escaped as `\/`; the replay id comes from the hidden `replayid` input, never from the file name, so arbitrary file names cannot corrupt format inference)
2. parses the replay log into snapshots
3. infers visible team information for both sides

The app can also be driven from outside ([`src/hooks/useEmbedHost.ts`](./src/hooks/useEmbedHost.ts)): `?replay=<id|url>` auto-loads a replay on startup, `?embed=1` hides the chrome for iframe embedding, and a host page can post `{ type: 'ps-load-replay', replay }` (id, URL, raw log, or exported HTML content). The app answers with `ps-embed-ready` / `ps-replay-loaded` / `ps-replay-error`; these types are disjoint from the internal viewer-iframe protocol below.

Relevant files:

- [`src/hooks/useReplay.ts`](./src/hooks/useReplay.ts)
- [`src/hooks/useEmbedHost.ts`](./src/hooks/useEmbedHost.ts)
- [`src/lib/replay-fetcher.ts`](./src/lib/replay-fetcher.ts)
- [`src/lib/replay-file.ts`](./src/lib/replay-file.ts)
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
3. Smogon usage-stat guesses for anything still unknown, when monthly stats can be fetched — formats without a stats file (Custom Game, niche metas) fall back to the generation's OU stats
4. `@pkmn/smogon` set assumptions for remaining gaps (Custom Game also maps to the generation's OU here)

This is the most important approximation point in the current implementation. The branch engine can only be as accurate as the reconstructed teams.

Relevant files:

- [`src/lib/team-builder.ts`](./src/lib/team-builder.ts)
- [`src/lib/team-info.ts`](./src/lib/team-info.ts)
- [`src/lib/smogon-stats.ts`](./src/lib/smogon-stats.ts)
- [`src/lib/smogon-sets.ts`](./src/lib/smogon-sets.ts)
- [`src/lib/team-parser.ts`](./src/lib/team-parser.ts)

### 4. Branch reconstruction

`src/lib/branch-engine.ts` is the core reconstruction module. `useBranch` wraps it with React state for the UI.

When `startBranch` runs, it:

1. creates a new `@pkmn/sim` battle
2. reorders both teams so the replay lead appears first
3. starts the battle and sends `default` for team preview
4. splits the replay protocol into turn blocks
5. replays original choices turn by turn until the target branch turn
6. handles follow-up forced switches when the simulator requests them
7. corrects HP and status from the selected snapshot
8. exposes the resulting simulator state to the UI

For doubles, the branch state includes slot-indexed active Pokemon, move lists, legal target options, switch lists, force-switch flags, and pending choices. The legacy single-active fields still point at slot 0 so the singles UI/tests remain compatible. Reconstruction also uses protocol `switch` and `drag` lines to correct active slots when simulator randomness would otherwise choose a different phazing target.

After branch entry, the user can choose actions for both sides and `executeTurn` submits them to the live simulator.

Relevant files:

- [`src/hooks/useBranch.ts`](./src/hooks/useBranch.ts)
- [`src/lib/branch-engine.ts`](./src/lib/branch-engine.ts)

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
- `BranchPanel` shows move, target, and switch controls for both sides.
- `BranchHistoryPanel` compares executed branch turns against the original replay line.
- `BranchSaveSharePanel` saves compact branch reports to localStorage and creates URL-hash share payloads.
- `BattleStatsPanel` stays visible to show inferred team information.
- `TeamEditor` lets the user override inferred fields for either player before branching.

Relevant files:

- [`src/components/PSReplayFrame.tsx`](./src/components/PSReplayFrame.tsx)
- [`src/lib/replay-html.ts`](./src/lib/replay-html.ts)
- [`src/components/BranchPanel.tsx`](./src/components/BranchPanel.tsx)
- [`src/components/BranchHistoryPanel.tsx`](./src/components/BranchHistoryPanel.tsx)
- [`src/components/BattleStatsPanel.tsx`](./src/components/BattleStatsPanel.tsx)
- [`src/components/TeamEditor.tsx`](./src/components/TeamEditor.tsx)

## Approximation Points

These are the main reasons the current simulator can diverge from the real battle:

### Hidden information

The replay log does not expose every relevant battle input. Unknown values are currently inferred or guessed:

- unrevealed moves
- EVs/IVs/natures
- unrevealed items and abilities
- some tera details before reveal

The UI keeps these categories separate:

- `revealed`: directly observed in the replay protocol
- `guessed`: filled from Smogon usage probabilities or `@pkmn/smogon` set assumptions
- `manual`: edited by the user
- `unknown`: not known and not guessed

### Replay choice reconstruction

The branch engine reconstructs prior choices from protocol lines such as `|move|` and `|switch|`. For targetable doubles moves, it translates protocol targets like `p2b:` into the simulator's relative target locations such as `+2`. Regression fixtures now cover redirection, retargeting after a fainted target, and protocol-guided phazing correction. Complex edge cases can still break reconstruction, especially unusual targeting effects or volatile state that is not represented in the replay snapshot.

### Save/share

Branch share payloads are intentionally compact. They include replay identity, format, players, branch turn, executed choices, and the final branch protocol log. They are useful for reporting and comparing a branch, but they are not yet a full deterministic branch restore mechanism.

### Bundle splitting

The initial app path avoids importing the heaviest simulator modules directly. Replay parsing, Smogon stats, team building, branch reconstruction, and damage calculation are loaded with dynamic imports when the user reaches those workflows. The build still emits large async Pokemon data chunks for dex/learnsets, but they are no longer part of the initial entry chunk.

### Partial state correction

After replaying turns inside the simulator, the code corrects HP and status from the selected snapshot. This helps reduce visible divergence, but it does not fully reconcile every hidden or transient state.

### External viewer dependency

The replay viewer and sprite assets are loaded from Pokemon Showdown-hosted resources. The app is not fully self-contained today.

### iframe sandbox

The replay viewer iframe is rendered with `sandbox="allow-scripts allow-same-origin"`. This combination effectively disables the sandbox for the blob document — and that is a deliberate choice: the two-way turn synchronization (`ps-seek-turn` / `ps-turn` postMessages, live log appends) and the e2e assertions need script execution plus same-origin access to the embedded `Replays` object. The document only ever contains our generated wrapper plus `replay-embed.js` from play.pokemonshowdown.com, so the trust boundary is the same as loading that script directly.

On narrow screens the embed keeps its desktop layout; the app wraps it in a horizontally scrollable container with a 640px minimum width so the battle log stays reachable instead of being cut off.

## Validation Status

The current codebase has been validated with:

- `npm run lint`
- `npm run build`
- `npx playwright test`
- `npm run test:regression`

The regression suite covers pure Smogon-stat parsing/enrichment (including the Custom Game → OU fallback), exported replay file parsing, branch save/share encoding, target-specific damage previews, basic doubles branch state, redirection/retargeting/phazing fixtures, stable checkpoints from a mocked fixture, and stable checkpoints from a saved real replay. Two deeper checkpoints are marked `fixme` to document known divergence rather than hiding it.

## Recommended Refactor Direction

If the project continues, the cleanest next architectural move would be to keep tightening the three separately testable layers:

1. replay ingestion and inference
2. deterministic branch reconstruction
3. UI rendering and controls

That makes it much easier to measure reconstruction accuracy, expand replay regression tests, and keep the frontend moving without coupling it to simulator internals.

# PS Dashboard

PS Dashboard is an early-stage web app for replay-based "what if?" analysis on Pokemon Showdown battles. It loads a Showdown replay, reconstructs the battle state up to a chosen turn, and then lets you branch from that point by selecting alternative moves or switches for both sides.

Published app: [https://fulllifegames.github.io/PSDashboard/](https://fulllifegames.github.io/PSDashboard/)

The current implementation is a working prototype, not a fully accurate replay recreation engine yet. It is best treated as an exploratory simulator built from replay evidence plus inferred hidden information.

## Current Capabilities

- Load a Pokemon Showdown replay from a replay URL or replay ID, with input validation and readable error messages. Smogtours ids are normalized to their real formats (`smogtours-gen3ou-…` → `gen3ou`).
- Load a locally exported replay by dropping a "Download replay" `.html` file (or a raw protocol log) onto the loader panel or picking it via `Browse file` — every feature (stats, branching, sharing) works on file-based replays.
- Formats without usage stats (Custom Game, niche metas) automatically fall back to the generation's OU stats and sets for hidden-information guesses.
- Deep-link and embed support: `?replay=<id|url>` auto-loads a replay on startup, and `?embed=1` hides the app chrome so the dashboard can run inside another site's iframe (see "Embedding" below).
- Render the original replay inside an embedded Pokemon Showdown replay viewer with two-way turn sync (playback runs through without self-pausing; the end position is labelled `End`).
- Parse the replay protocol into per-turn snapshots.
- Infer both teams from replay data, including revealed moves, items, abilities, levels, gender, and tera type when shown — plus ability reveals from effect attributions (e.g. Poison Heal heals), item reveals from heal messages and mega stones, and a Heavy-Duty Boots inference for Pokemon that switch into Stealth Rock without taking damage.
- Parse Open Team Sheets (`|showteam|`) and embedded "View team" chat exports as revealed team data.
- Accept a pasted player team export (validated, shown as manual data in the stats panel, persisted across reloads). German stat abbreviations are normalized.
- Fetch optional usage stats (via the CORS-safe `data.pkmn.cc` mirror) and `@pkmn/smogon` set assumptions for unrevealed abilities, items, moves, natures, and EV spreads.
- Display whether team data is revealed from the replay, guessed from usage stats, or manually edited.
- Edit reconstructed information for both players before or during branching (edits rebuild the branch and replay its history).
- Edit teams with legal dropdown pools: species-legal moves (learnset-based, prevo chain included), gen-legal items, the species' real abilities, tera types (gen 9), and natures. Moves and items use a filterable combobox — click an option to select it, arrow keys + Enter for keyboard use — validated against the pools.
- Export both teams' current sets as text (Showdown format under `=== p1 ===` / `=== p2 ===` headers) and import corrected sets back — imported values apply as green manual knowledge, rebuild a live branch in place, and persist per replay for repeated perfect-information "what if I did a, b, or c" analysis. Natures, IVs, and levels round-trip.
- Try hypothetical moves while branching ("What if it had Flamethrower?") — picked from the legal move pool, loaded into the set (adding or replacing a move), and pre-selected as that slot's pending choice with damage previews included.
- Toggle a chess-style position evaluation (`Eval`) on the replay view or inside a branch, shown beside the battle in the right column: a sim-backed maximin search plays out every legal choice pair on forked battles (depth 1–3, default 2, deterministic fixed-seed sampling, parallelized across a worker pool) and shows an advantage bar plus the safest choices for both sides, each with worst case, expected value, the punishing reply, and — at depth 2+ — the followup line explaining the "why". The eval is matchup-aware: a per-pair 1v1 threat estimate (movesets, type chart, stats, speed, the big items and immunity abilities, priority, recovery walls) makes early positions readable before anything faints. Positions with no safe line are labeled as toss-ups (the maximin interval is wide — the turn hinges on prediction). Tera enumeration is a setting (Auto infers "banned" from a replay that never terastallized). In branch mode a recommendation click pre-fills the choice picker, and an opt-in auto mode re-evaluates after every executed turn. The score is a heuristic estimate for spotting swings and blunders — not an oracle.
- Analyze the whole game into a chess-style evaluation graph (`Analyze game` in the eval panel): a background sweep evaluates every turn, draws the score line with blunder markers where the game swung, and clicking a point jumps the replay to that turn. Results are cached per turn and reused by single-position evaluations.
- Select a turn and branch from that point into a controllable simulator — including Random Battle replays and older generations.
- Pick moves or switches for both players and advance the branch turn by turn. Choices are stored by move identity, so forced-switch interludes and team edits can never execute a different move than the one clicked.
- Use Tera / Mega Evolution / Ultra Burst / Z-Move toggles where the format and the reconstructed sets allow them.
- Use slot-aware and target-aware controls for doubles battles, including blocking duplicate simultaneous switch targets, plus a dropdown listing every legal choice.
- View damage estimates computed with the replay's generation, the exact reconstructed sets (abilities, items, EVs), and field conditions — including per-target previews for targeted and spread moves in doubles.
- Get loud, actionable errors: invalid choices are rejected with messages, failed turns keep your selections, and stuck reconstructions explain themselves instead of dead-ending.
- Animate newly executed branch turns, or disable animation to jump straight to the result.
- Compare branch history (including forced replacements) against the original replay line.
- Save branches locally (open and delete them again) and create share links that also work in an already-open tab.
- Show a battle statistics panel for both teams, with placeholders for unrevealed Random Battle slots.

## What "Works" Today

As of the current repository state:

- `npm run lint` passes.
- `npm run build` succeeds.
- `npm run test:e2e` passes with 53 browser tests (the replay JSON and the Showdown embed script are served from fixtures/cache, so the suite is CDN-independent).
- `npm run test:regression` passes with 169 tests (plus 2 documented known-divergence skips and an opt-in `EVAL_BENCH=1` throughput benchmark) covering replay reconstruction, identity-based choice resolution, execute error paths, gimmick availability, damage-calc generation/set alignment, team sheets, team paste (including natures, IVs, and levels), sets import/export round-trips, legal option pools, position evaluation (static eval, forward model, maximin search with deepening), stats parsing, exported replay file parsing, save/share, and inference quality.

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
- Probability-backed guesses come from the `data.pkmn.cc` usage-stat mirror (the only endpoint that sends CORS headers in a browser). When it has no data for a format, `@pkmn/smogon` set data provides non-probability set assumptions before the app falls back to unknown/default simulator values.
- HP and status are corrected from the snapshot at branch start, but other hidden or volatile state may still differ. Reconstructions that end up in an unplayable state are detected and reported instead of dead-ending.
- Damage previews match the sim's generation and sets, but an *armed* Tera toggle is not pre-applied to the preview numbers — they update once the terastallized turn executes.
- Doubles battles have multi-active reconstruction, explicit target reconstruction, redirection/retargeting fixtures, and protocol correction for `switch`/`drag` active-slot evidence, but unusual targeting effects and some volatile state can still diverge.
- Save/share links are compact branch reports today; they do not yet fully restore and replay an alternate line from scratch.
- Replay viewing and sprite rendering depend on Pokemon Showdown-hosted assets. On phones the embed keeps its desktop layout inside a horizontally scrollable container.
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

## Embedding

The app can be included in another site and handed a replay to render:

- **Deep link:** `https://…/?replay=gen3customgame-2115579570` auto-loads that replay on startup (works standalone and inside an iframe).
- **Embed mode:** add `?embed=1` to hide the header and loader chrome — combined: `?embed=1&replay=<id>`.
- **postMessage handoff** for replays that are not hosted (exported HTML files, raw logs):

  ```html
  <iframe id="dashboard" src="https://…/?embed=1"></iframe>
  <script>
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'ps-embed-ready') {
        // A replay id/URL, a raw protocol log, or a full exported replay HTML document:
        document.getElementById('dashboard').contentWindow
          .postMessage({ type: 'ps-load-replay', replay: 'gen3customgame-2115579570' }, '*');
      }
      if (event.data?.type === 'ps-replay-loaded') console.log('loaded', event.data.id);
      if (event.data?.type === 'ps-replay-error') console.warn(event.data.message);
    });
  </script>
  ```

  The app posts `ps-embed-ready` to its parent once it can receive replays, and answers every `ps-load-replay` with `ps-replay-loaded` (`id`, `format`) or `ps-replay-error` (`message`).

  A runnable host-page demo lives in [`examples/embed-host.html`](./examples/embed-host.html) — with the dev server running, open `http://localhost:5173/examples/embed-host.html`, pick an exported replay file (or click the demo button), and the embedded dashboard renders it.

## How To Use The Prototype

1. Paste a replay URL or replay ID into the loader, or drop an exported replay `.html` file onto the loader panel.
2. Optionally expand the team section and paste your own exported team to improve reconstruction.
3. Load the replay.
4. For perfect-information analysis, open `Import/Export Sets`, correct both teams (or paste the real sets), and import — the import is remembered for this replay.
5. Scrub to a turn using the replay viewer or the branch slider.
6. Click `Branch Here`.
7. Choose a move or switch for both sides — or load a hypothetical move via "What if it had …".
8. Execute the turn and continue exploring the branch.
9. Use `Edit Player` or `Edit Opp` if you want to override inferred details before branching.

## Repository Map

- [`src/App.tsx`](./src/App.tsx) hosts the main application flow.
- [`src/hooks/useReplay.ts`](./src/hooks/useReplay.ts) loads the replay (fetched or file-based) and derives snapshots plus inferred team data.
- [`src/hooks/useEmbedHost.ts`](./src/hooks/useEmbedHost.ts) implements `?replay=`/`?embed=1` and the host-page postMessage protocol.
- [`src/lib/replay-file.ts`](./src/lib/replay-file.ts) parses exported replay HTML files and raw protocol logs into replay data.
- [`src/hooks/useBranch.ts`](./src/hooks/useBranch.ts) manages React state for the live branch simulator.
- [`src/lib/branch-engine.ts`](./src/lib/branch-engine.ts) reconstructs the battle up to a selected turn in a pure, directly testable module.
- [`src/lib/protocol-parser.ts`](./src/lib/protocol-parser.ts) converts replay protocol logs into turn snapshots.
- [`src/lib/opponent-inferrer.ts`](./src/lib/opponent-inferrer.ts) extracts revealed team information from the replay log.
- [`src/lib/team-builder.ts`](./src/lib/team-builder.ts) builds simulator teams from replay evidence, pasted teams, and usage-stat guesses.
- [`src/lib/smogon-stats.ts`](./src/lib/smogon-stats.ts) fetches and normalizes Smogon monthly usage probabilities.
- [`src/lib/smogon-sets.ts`](./src/lib/smogon-sets.ts) fetches normalized fallback set assumptions through `@pkmn/smogon`.
- [`src/lib/team-info.ts`](./src/lib/team-info.ts) enriches revealed team data while preserving revealed/guessed/manual source labels.
- [`src/lib/branch-choices.ts`](./src/lib/branch-choices.ts) defines the identity-based choice model shared by the UI and the engine.
- [`src/lib/damage-calc.ts`](./src/lib/damage-calc.ts) computes damage previews with `@smogon/calc` using the replay generation, sim sets, and field state.
- [`src/lib/team-paste.ts`](./src/lib/team-paste.ts) parses pasted Showdown exports (including natures, IVs, and levels) and overlays them as manual knowledge.
- [`src/lib/sets-io.ts`](./src/lib/sets-io.ts) builds and parses the side-headered both-teams text format for the Import/Export Sets panel.
- [`src/lib/pokemon-options.ts`](./src/lib/pokemon-options.ts) serves legal move/item/ability/tera/nature pools for dropdowns (loaded lazily to keep dex data out of the entry chunk).
- [`src/components/PSReplayFrame.tsx`](./src/components/PSReplayFrame.tsx) renders the Showdown replay viewer in an iframe.
- [`src/components/BranchPanel.tsx`](./src/components/BranchPanel.tsx) renders move and switch controls for the active branch.
- [`src/components/BranchSaveSharePanel.tsx`](./src/components/BranchSaveSharePanel.tsx) saves branch summaries locally and creates compact share links.
- [`src/components/BattleStatsPanel.tsx`](./src/components/BattleStatsPanel.tsx) shows inferred team information for both players.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) explains the current internal flow in more detail.

## Sample Inputs In The Repo

- [`replay.txt`](./replay.txt) contains a sample replay URL.
- [`team.txt`](./team.txt) contains a sample team export with German stat labels.

## Notes For Contributors

- The current app path uses the Showdown iframe viewer plus the `useBranch` simulator hook.
- The production bundle is large because the simulator and learnset data are included client-side.

## Next Priorities

- Turn branch share links into full replayable branch restores.
- Pre-apply an armed Tera toggle to the damage previews.
- Improve reconstruction fidelity for unusual targeting effects and volatile hidden battle state.
- Expand the replay regression suite with many more real replays and expected snapshots.
- Continue reducing async chunk size for `@pkmn/dex`, learnsets, and protocol parsing.
- Add deeper branch comparison tools.

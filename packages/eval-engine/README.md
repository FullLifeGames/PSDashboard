# @fulllifegames/eval-engine

Position evaluation for Pokémon Showdown replays: rebuild the battle at any turn from the replay log, search the position, grade the played turn, and write the game report. Pure computation over `@pkmn/sim` and `@smogon/calc`; the worker pool that runs the search in a browser stays in the app.

## Install

```sh
npm install @fulllifegames/eval-engine @fulllifegames/replay-core @pkmn/sim @pkmn/dex @smogon/calc
```

`@pkmn/sim`, `@pkmn/dex`, and `@smogon/calc` are peer dependencies: you pick the simulator version, and one copy serves both packages. The package ships ES modules for Node 20 or newer and for bundlers.

## Evaluate a replay turn

Copy [`examples/evaluate-turn.mjs`](./examples/evaluate-turn.mjs) next to your `package.json` and run it with a replay link or a saved replay JSON:

```sh
node evaluate-turn.mjs https://replay.pokemonshowdown.com/smogtours-gen8ou-573756 12
```

```js
/**
 * Evaluate one turn of a Pokémon Showdown replay in Node.
 *
 *   node evaluate-turn.mjs https://replay.pokemonshowdown.com/smogtours-gen8ou-573756 12
 *   node evaluate-turn.mjs ./replay.json 12
 *
 * Loads the replay JSON (a local file, or the replay page's .json), rebuilds
 * the battle at that turn from the sets the log reveals, runs the fixed-depth
 * search, and prints the win chance plus the top lines for each side.
 */
import { readFile } from 'node:fs/promises';
import { buildTeamsFromReplay, getBranchSimulatorFormat, parseReplayLog } from '@fulllifegames/replay-core';
import {
  reconstructBranchRuntime, reconstructionReached, searchPosition, serializeLiveBattle, validateBranchRuntime,
  winPercent,
} from '@fulllifegames/eval-engine';

async function loadReplay(source) {
  if (/^https?:/.test(source)) {
    const url = source.endsWith('.json') ? source : `${source}.json`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
    return response.json();
  }
  return JSON.parse(await readFile(source, 'utf8'));
}

const [source, turnArg] = process.argv.slice(2);
if (!source) {
  console.error('usage: node evaluate-turn.mjs <replay.json | replay URL> [turn]');
  process.exit(1);
}
const turn = Number(turnArg ?? 1);
const replay = await loadReplay(source);
const [p1Name, p2Name] = replay.players;

// One snapshot per turn boundary; the reconstruction corrects the sim's
// guessed damage rolls against it so the position matches the real game.
const snapshots = parseReplayLog(replay.log);
const snapshot = snapshots.find(entry => entry.turn === turn);
if (!snapshot) throw new Error(`turn ${turn} is not in this replay (last turn ${snapshots.at(-1)?.turn ?? 0})`);

const { p1Team, p2Team } = buildTeamsFromReplay(replay.log);
const runtime = await reconstructBranchRuntime({
  format: getBranchSimulatorFormat(replay),
  p1Team,
  p2Team,
  replayLog: replay.log,
  targetTurn: turn,
  snapshot,
  playerNames: [p1Name, p2Name],
});
const problem = validateBranchRuntime(runtime);
if (problem) throw new Error(problem);
if (!reconstructionReached(runtime, turn)) throw new Error(`the guessed sets could not reproduce turn ${turn}`);

// depth 1 = the full joint matrix of this turn, one seed per cell: seconds,
// not minutes. Deeper settings and the MCTS mode take the same call.
const result = searchPosition(serializeLiveBattle(runtime.battleStream.battle), { depth: 1, samples: 1 });

console.log(`Turn ${turn}: ${p1Name} wins ${winPercent(result.score)}% of the time`);
for (const [side, name] of [['p1', p1Name], ['p2', p2Name]]) {
  console.log(`${name}:`);
  for (const choice of result.perSide[side].slice(0, 3)) {
    console.log(`  ${choice.label.padEnd(24)} ${winPercent(choice.ev)}%`);
  }
}
```

The repository's fixture replay at turn 2 prints:

```
Turn 2: TestPlayer1 wins 57% of the time
TestPlayer1:
  Earthquake               57%
  Tera + Earthquake        57%
  Tera + Scale Shot        57%
TestPlayer2:
  Tera + Iron Head         43%
  Iron Head                43%
  → Zamazenta              42%
```

The fixture is a synthetic four-turn game, so its unrevealed move slots fall back to placeholders; on a real replay `buildTeamsFromReplay` fills them from usage stats and set assumptions when you pass those in (see `@fulllifegames/replay-core`). Depth 1 with one sample takes seconds; `{ depth: 2, samples: 3 }` and `{ mode: 'mcts' }` are the app's deeper settings.

## What the package offers

- Reconstruction: `reconstructBranchRuntime` rebuilds a live `@pkmn/sim` battle at a replay turn from the sets and the protocol log, correcting HP, status, and the active Pokémon against the turn snapshot. `validateBranchRuntime` and `reconstructionReached` say whether the rebuild can be trusted. `serializeLiveBattle` and `deserializeBattleExact` round-trip a position as a string. `createBranchState`, `executeBranchChoices`, and `resolveSideChoices` play a branch on turn by turn.
- Search: `searchPosition` runs the fixed-depth matrix search with a regret-matching equilibrium solver. `mctsSearch`, `mctsTreeSearch`, and `mergeMctsTrees` are the DUCT tree mode. `searchOrchestrated` fans the matrix cells out over a `SearchExecutor` of your own (a worker pool, a queue); `createLocalExecutor` runs them inline. `EvalSettings` carries `depth` (1 to 3), `samples`, `tera`, and `mode`; `AUTO_MCTS_FAINTED_FRACTION` is the point where the app switches from the matrix to the tree.
- Grading and prose: `parsePlayedActions` and `parsePlayedActionsDoubles` read what was played from a turn's protocol lines. `analyzeTurn` grades it against the search (verdict tiers, regret, sacrifices, reads), `summarizeTurn` writes the sentence, `analyzeLeads` grades team preview, and `buildGameReport` folds the per-turn analyses into accuracies and key moments. `computeBlunders` and `selectKeyTurns` pick the graph markers.
- Display helpers: `winProbability`, `winPercent`, `winPctText`, and `winDeltaText` turn scores into percentages; `calcSingleDamageRange` gives damage previews; `notationSlotChoice` and `notationSideLabel` write chess-style notation.
- Types for all of the above: `EvalResult`, `RankedChoice`, `TurnAnalysis`, `GameReport`, `BranchRuntime`, `BranchSimState`, and their parts.

The barrel is the API: it lists what the app, its worker, and the examples use, plus every type those signatures mention. `regression/fixtures/api/eval-engine.txt` in the repository pins that list, so widening the surface is a one-line edit to `src/index.ts` plus a snapshot refresh.

## Versioning and publishing

Both packages carry the repository's version. A release publishes a package only when its files changed since the previous release, and the dependency on `@fulllifegames/replay-core` becomes a caret range at publish time.

## Where it comes from

Part of the [PS Dashboard](https://github.com/FullLifeGames/PSDashboard) repository (MIT). The app at the repository root consumes the package through the npm workspace.

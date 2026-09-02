# @fulllifegames/eval-engine

Position evaluation for Pokémon Showdown replays: rebuild the battle at any turn from the replay log, search the position, grade the played turn, and write the game report. Pure computation over `@pkmn/sim` and `@smogon/calc`; the worker pool that runs the search in a browser stays in the app.

## Install

```sh
npm install @fulllifegames/eval-engine @fulllifegames/replay-core @pkmn/sim @pkmn/dex @smogon/calc
```

The sim family is a peer dependency, so the consumer picks the simulator version.

## Use

```ts
import { searchPosition, analyzeTurn, buildGameReport } from '@fulllifegames/eval-engine';

const result = searchPosition(serializedBattle, settings); // ranked choices per side, matrix, win probability
```

`reconstructBranchRuntime` rebuilds a live battle at a replay turn, `analyzeTurn` grades what was played against the search, `summarizeTurn` writes the sentence, and `buildGameReport` folds the per-turn results into accuracies and key moments.

## Where it comes from

Part of the PS Dashboard repository; the app at the repository root consumes the package through the npm workspace.

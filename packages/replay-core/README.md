# @fulllifegames/replay-core

Pokémon Showdown replay parsing: protocol logs in, turn snapshots, revealed teams, and simulator sets out. No network, no DOM.

## Install

```sh
npm install @fulllifegames/replay-core @pkmn/sim @pkmn/dex @pkmn/data @pkmn/client @smogon/calc
```

The sim family is a peer dependency, so the consumer picks the simulator version.

## Use

```ts
import { inferOpponentTeam, parseReplayLog } from '@fulllifegames/replay-core';

const snapshots = parseReplayLog(log); // one TurnSnapshot per turn boundary
const p2 = inferOpponentTeam(log, 'p2'); // revealed moves, items, and abilities per Pokémon
```

`buildTeamsFromReplay` turns the same evidence into simulator sets, `solveReplaySpreads` fits EV spreads to observed damage, and `parseTeamText` reads a pasted Showdown export.

## Where it comes from

Part of the PS Dashboard repository; the app at the repository root consumes the package through the npm workspace.

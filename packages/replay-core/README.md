# @fulllifegames/replay-core

Pokémon Showdown replay parsing: protocol logs in, turn snapshots, revealed teams, and simulator sets out. No network, no DOM.

## Install

```sh
npm install @fulllifegames/replay-core @pkmn/sim @pkmn/dex @pkmn/data @pkmn/client @smogon/calc
```

The sim family is a peer dependency: you pick the simulator version, and one copy serves every package that uses it. The package ships ES modules for Node 20 or newer and for bundlers.

## Parse a replay

Copy [`examples/parse-replay.mjs`](./examples/parse-replay.mjs) next to your `package.json` and run it with a replay link or a saved replay JSON:

```sh
node parse-replay.mjs https://replay.pokemonshowdown.com/smogtours-gen8ou-573756
```

```js
/**
 * Turn a Pokémon Showdown replay into snapshots, revealed teams, and sim sets.
 *
 *   node parse-replay.mjs https://replay.pokemonshowdown.com/smogtours-gen8ou-573756
 *   node parse-replay.mjs ./replay.json
 *
 * Loads the replay JSON (a local file, or the replay page's .json), walks the
 * protocol log into one snapshot per turn, lists what the log revealed about
 * the second player's team, and builds the simulator sets both sides would
 * get in the app.
 */
import { readFile } from 'node:fs/promises';
import { buildTeamsFromReplay, inferOpponentTeam, parseReplayLog } from '@fulllifegames/replay-core';

async function loadReplay(source) {
  if (/^https?:/.test(source)) {
    const url = source.endsWith('.json') ? source : `${source}.json`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
    return response.json();
  }
  return JSON.parse(await readFile(source, 'utf8'));
}

const [source] = process.argv.slice(2);
if (!source) {
  console.error('usage: node parse-replay.mjs <replay.json | replay URL>');
  process.exit(1);
}
const replay = await loadReplay(source);
const [p1Name, p2Name] = replay.players;

// One snapshot per turn boundary: HP, status, boosts, and field per side.
const snapshots = parseReplayLog(replay.log);
const last = snapshots.at(-1);
const actives = side => side.pokemon.filter(pokemon => pokemon.isActive).map(pokemon => pokemon.speciesForme);
console.log(`${snapshots.length} turn snapshots; at turn ${last.turn} ${p1Name} has ${actives(last.p1).join(' + ')} out against ${actives(last.p2).join(' + ')}`);

// What the log revealed about p2: moves, item, ability, with their sources.
const revealed = inferOpponentTeam(replay.log, 'p2');
console.log(`${p2Name}'s team as revealed:`);
for (const pokemon of revealed.pokemon) {
  const moves = pokemon.moves.map(move => move.name).join(', ') || 'no moves seen';
  console.log(`  ${pokemon.species.padEnd(16)} ${moves}`);
}

// The sets the simulator gets: revealed evidence first, guesses for the rest.
const { p1Team, p2Team } = buildTeamsFromReplay(replay.log);
for (const [name, team] of [[p1Name, p1Team], [p2Name, p2Team]]) {
  console.log(`${name}'s sim sets:`);
  for (const set of team) console.log(`  ${set.species.padEnd(16)} ${set.item || 'no item'} / ${set.ability} / ${set.moves.join(', ')}`);
}
```

The repository's fixture replay prints:

```
4 turn snapshots; at turn 4 TestPlayer1 has Garchomp out against Great Tusk
TestPlayer2's team as revealed:
  Kingambit        Sucker Punch, Iron Head
  Great Tusk       no moves seen
  Gholdengo        no moves seen
  Iron Valiant     no moves seen
  Slowking-Galar   no moves seen
  Zamazenta        no moves seen
TestPlayer1's sim sets:
  Garchomp         no item / Sand Veil / Earthquake, Swords Dance, Scale Shot
  Dragapult        no item / Clear Body / Tackle
  Heatran          no item / Flash Fire / Tackle
  Rillaboom        no item / Overgrow / Tackle
  Toxapex          no item / Merciless / Tackle
  Corviknight      no item / Pressure / Tackle
TestPlayer2's sim sets:
  Kingambit        no item / Defiant / Sucker Punch, Iron Head
  Great Tusk       no item / Protosynthesis / Tackle
  Gholdengo        no item / Good as Gold / Tackle
  Iron Valiant     no item / Quark Drive / Tackle
  Slowking-Galar   no item / Curious Medicine / Tackle
  Zamazenta        no item / Dauntless Shield / Tackle
```

The fixture is a synthetic four-turn game with nothing to guess from, so unrevealed slots fall back to placeholders. On a real replay, pass the usage stats and set assumptions you fetched (`buildTeamsFromReplay(log, { usageStats, setAssumptions })`) and the builder fills them with coherent guesses; `solveReplaySpreads` adds damage-consistent EV spreads.

## What the package offers

- Log to data: `parseReplayLog` gives one `TurnSnapshot` per turn boundary (HP, status, boosts, field, per side); `parseReplayLogWithObservations` adds the damage and speed-order observations the spread solver reads; `inferOpponentTeam` lists what the log revealed per Pokémon (moves, item, ability, Tera type, each with its source); `finalPlayedTurn` finds the last turn that was played out.
- Sets: `buildTeamsFromReplay` turns the evidence into simulator `PokemonSet`s (revealed facts first, then pasted teams, usage stats, and coherent set guesses); `solveReplaySpreads` fits EV spreads to the observed damage; `extractTeamSheets` reads open team sheets; `parseTeamText`, `parsePastedTeam`, and `applyPastedTeam` handle Showdown exports; `applyTeamSheetToInfo` overlays a sheet.
- Formats: `inferReplayFormatId`, `getReplayDisplayFormat`, `getReplayGeneration`, and `getReplayGameType` read the format; `getBranchSimulatorFormat` names the sim format a reconstruction should run; `getReplayBringCount`, `replayBringOnly`, and `broughtSpeciesFor` handle VGC bring limits; `formatEnforcesSleepClause` and `splitReplayPassword` cover the edge cases.
- Knowledge: `enrichTeamInfo` merges revealed, guessed, and manual knowledge with source labels; `manualField`, `manualEvs`, `manualMove`, `itemSetValue`, and `applyInferredSpreads` edit it; the Smogon lookups (`getSpeciesUsageStats`, `getSpeciesUsageSet`, `fillUsageMoves`, `alternativeItems`, `guessedFieldFromUsage`, `getSpeciesSetAssumption`) work on usage payloads you fetch yourself.
- Helpers and types: `toId`, `sideIndex`, `speciesBaseId`; hidden-power typing (`resolveHiddenPowerType`, `typedHiddenPowerId`, `withHiddenPowerType`, `HP_TYPES`); `WEATHER_BY_ID` and `TERRAIN_BY_ID` for `@smogon/calc`; the types `ReplayData`, `TurnSnapshot`, `PokemonSnapshot`, `OpponentTeamInfo`, `RevealedPokemonInfo`, and the usage-stat payload shapes.

The barrel is the API: it lists what the app, the evaluation engine, and the example use, plus every type those signatures mention. `regression/fixtures/api/replay-core.txt` in the repository pins that list, so widening the surface is a one-line edit to `src/index.ts` plus a snapshot refresh.

## Tests

The package's own suite lives under `test/` (white-box against `src/`; not part of the published package). From the repository root:

```sh
npm test -w packages/replay-core
```

`npm run test:regression` at the root runs it together with the app's suite.

## Versioning and publishing

Both packages carry the repository's version. A release publishes a package only when its files changed since the previous release, and npm receives it from the release workflow through trusted publishing, so every published version carries a provenance attestation.

## Where it comes from

Part of the [PS Dashboard](https://github.com/FullLifeGames/PSDashboard) repository (MIT). The app at the repository root consumes the package through the npm workspace.

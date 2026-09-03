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

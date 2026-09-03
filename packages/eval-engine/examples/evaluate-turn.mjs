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

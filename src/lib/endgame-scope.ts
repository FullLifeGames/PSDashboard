import { ENDGAME_MAX_BODIES } from '@fulllifegames/eval-engine';
import { teamSizes, type TurnSnapshot } from '@fulllifegames/replay-core';
import { logWinner } from './game-end';


type Side = 'p1' | 'p2';

export const WIN_PATHS_BEHIND = 0.3;

/** Bodies standing at a turn's start, both sides: those brought (`|teamsize|`, VGC four of six), else the snapshot. */
export function livingBodies(snapshots: readonly TurnSnapshot[], turn: number): number | null {
  const at = snapshots[Math.min(turn - 1, snapshots.length - 1)];
  if (!at) return null;
  const brought = teamSizes(snapshots[0]?.log ?? []);
  const total = (brought.p1 ?? at.p1.pokemon.length) + (brought.p2 ?? at.p2.pokemon.length);
  return total - [...at.p1.pokemon, ...at.p2.pokemon].filter(pokemon => pokemon.fainted).length;
}

export function endgameTurns(snapshots: readonly TurnSnapshot[], lastTurn: number): number[] {
  const turns: number[] = [];
  for (let turn = 1; turn <= lastTurn; turn++) {
    const living = livingBodies(snapshots, turn);
    if (living !== null && living <= ENDGAME_MAX_BODIES) turns.push(turn);
  }
  return turns;
}

/** The side that lost; null for a tie, a log without a result or a winner no player bears. */
export function loserOf(log: string, players: readonly string[]): Side | null {
  const winner = logWinner(log);
  const at = winner === null ? -1 : players.indexOf(winner);
  return at === 0 ? 'p2' : at === 1 ? 'p1' : null;
}

/** The endgame turns plus every turn whose result reads the loser 0.3 (`WIN_PATHS_BEHIND`) or more behind, sorted. */
export function offeredTurns(endgame: readonly number[], results: readonly ({ score: number } | null | undefined)[], loser: Side): number[] {
  const offered = new Set(endgame);
  results.forEach((result, index) => {
    if (result && (loser === 'p1' ? result.score : -result.score) <= -WIN_PATHS_BEHIND) offered.add(index + 1);
  });
  return [...offered].sort((a, b) => a - b);
}

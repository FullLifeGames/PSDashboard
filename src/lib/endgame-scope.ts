import { ENDGAME_MAX_BODIES } from '@fulllifegames/eval-engine';
import { teamSizes, type TurnSnapshot } from '@fulllifegames/replay-core';
import { logWinner } from './game-end';

/** Which turns of a game are its endgame (three bodies or fewer standing in total: the engine's `ENDGAME_MAX_BODIES`) and which side lost it. */

type Side = 'p1' | 'p2';

/**
 * The bodies standing at a turn's start, both sides together: those each side brought (`|teamsize|`: VGC brings four of six), else the
 * snapshot's list, less the fallen.
 */
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

/** The side that lost the game: the other one than the log's winner; null for a tie, a log without a result or a winner no player bears. */
export function loserOf(log: string, players: readonly string[]): Side | null {
  const winner = logWinner(log);
  const at = winner === null ? -1 : players.indexOf(winner);
  return at === 0 ? 'p2' : at === 1 ? 'p1' : null;
}

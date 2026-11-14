import { ENDGAME_MAX_BODIES } from '@fulllifegames/eval-engine';
import { teamSizes, type TurnSnapshot } from '@fulllifegames/replay-core';
import { logWinner } from './game-end';

/**
 * Round 89 (#130, G8b): which turns of a game are its endgame and which side lost it. The scope is the engine's own constant
 * (`ENDGAME_MAX_BODIES`, the one the prover's gate reads): three Pokémon or fewer standing in total. The Game review has no battle, so
 * the count reads the turn's start snapshot the way the turn card's phase does (`turnFaintedFraction`): the bodies each side brought
 * (the `|teamsize|` line: VGC brings four of six), else the bodies the snapshot lists, less the fallen ones.
 */

type Side = 'p1' | 'p2';

/** The bodies still standing at a turn's start, both sides together. */
export function livingBodies(snapshots: readonly TurnSnapshot[], turn: number): number | null {
  const at = snapshots[Math.min(turn - 1, snapshots.length - 1)];
  if (!at) return null;
  const brought = teamSizes(snapshots[0]?.log ?? []);
  const total = (brought.p1 ?? at.p1.pokemon.length) + (brought.p2 ?? at.p2.pokemon.length);
  return total - [...at.p1.pokemon, ...at.p2.pokemon].filter(pokemon => pokemon.fainted).length;
}

/** The turns from 1 to `lastTurn` that start with three bodies or fewer standing, in order. */
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

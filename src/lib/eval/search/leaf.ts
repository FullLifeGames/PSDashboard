import type { PRNGSeed } from '@pkmn/sim';
import { evaluatePosition, type MatchupCache } from '../eval-function';
import type { positionBattle } from '../forward-model';
import { RANDOM_CALL_MOVES } from '../ko-odds';
import { wpUnits } from '../winprob';

/**
 * The search's value space and its chance schedule: the fixed seed list,
 * the leaf value in win-prob units, the fainted-fraction phase signal, and
 * the roll-sensitivity of a choice pair.
 */

/** Fixed seeds: index < settings.samples are used. Never randomized. */
export const SEARCH_SEEDS: readonly PRNGSeed[] = [
  '1,2,3,4', '5,6,7,8', '9,10,11,12', '13,14,15,16', '17,18,19,20',
];

export function countFainted(battle: ReturnType<typeof positionBattle>): number {
  return battle.sides[0].pokemon.filter(p => p.fainted).length +
    battle.sides[1].pokemon.filter(p => p.fainted).length;
}

/** Fainted bodies over total bodies, both sides — the phase signal for the win-prob mapping. */
export function battleFaintedFraction(battle: ReturnType<typeof positionBattle>): number {
  let fainted = 0;
  let total = 0;
  for (const side of battle.sides) {
    for (const pokemon of side.pokemon) {
      total += 1;
      if (pokemon.fainted || pokemon.hp <= 0) fainted += 1;
    }
  }
  return total > 0 ? fainted / total : 0;
}

/**
 * The ONE place the sigmoid applies: every leaf evaluation becomes win-prob
 * units (2p−1), so cell averages, the equilibrium solve, and regret all live
 * in probability space — variance is genuinely valuable when behind (Jensen)
 * instead of being flattened by score-space means. Ended battles clamp to
 * exact ±1 (the sigmoid saturates near but not at ±1). Shared by the sync
 * search, the executor (worker path), and MCTS — all engine modes must live
 * in the same value space.
 */
export function leafValue(battle: ReturnType<typeof positionBattle>, matchupCache: MatchupCache): number {
  const raw = evaluatePosition(battle, matchupCache);
  if (battle.ended) return raw > 0 ? 1 : raw < 0 ? -1 : 0;
  return wpUnits(raw, battle.gameType === 'doubles', battleFaintedFraction(battle));
}

/** Move ids named in a (possibly combined) choice string. */
const choiceMoveIds = (choice: string): string[] => choice.split(',')
  .map(part => part.trim().split(' '))
  .filter(tokens => tokens[0] === 'move')
  .map(tokens => tokens[1]);

/** The pair includes an accuracy roll or a random-call move — seeds diverge. */
export function rollSensitivePair(battle: ReturnType<typeof positionBattle>, p1Choice: string, p2Choice: string): boolean {
  return [...choiceMoveIds(p1Choice), ...choiceMoveIds(p2Choice)].some(id => {
    const move = battle.dex.moves.get(id);
    if (!move.exists) return false;
    if (RANDOM_CALL_MOVES.has(move.id)) return true;
    return typeof move.accuracy === 'number' && move.accuracy < 100;
  });
}

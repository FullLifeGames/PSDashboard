import type { PRNGSeed } from '@pkmn/sim';
import { evaluatePosition, type MatchupCache } from '../eval-function.ts';
import type { positionBattle } from '../forward-model.ts';
import { randomCallMoves } from '../ko-odds.ts';
import { lastPairRace, lastPairValue } from '../score/last-pair.ts';
import { actionsTie } from '../sim-ask/index.ts';
import type { RollScripts } from '../forward/scripted-prng.ts';
import { wpUnits } from '../winprob.ts';

/**
 * The search's value space and its chance schedule: the fixed seed list,
 * the leaf value in win-prob units, the fainted-fraction phase signal, and
 * the roll-sensitivity of a choice pair.
 */

/** Fixed seeds: index < settings.samples are used. Never randomized. */
export const SEARCH_SEEDS: readonly PRNGSeed[] = [
  '1,2,3,4', '5,6,7,8', '9,10,11,12', '13,14,15,16', '17,18,19,20',
];

/**
 * Round 61: the seed a tree cell draws at creation. Tree k uses family
 * floor(k / 5); family 0 is SEARCH_SEEDS, so trees 0 to 4 keep the
 * sequences they had (a sixth tree used to copy the first).
 */
export function treeSeed(iteration: number, seedOffset: number): PRNGSeed {
  const family = Math.floor(seedOffset / SEARCH_SEEDS.length);
  const slot = (iteration + seedOffset) % SEARCH_SEEDS.length;
  if (family === 0) return SEARCH_SEEDS[slot];
  const base = 20 * family + 4 * slot;
  return `${base + 1},${base + 2},${base + 3},${base + 4}` as PRNGSeed;
}

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
 * in the same value space. Round 33: the last pair is priced by its race
 * (last-pair.ts), after the sigmoid, in the same units. Round 67 (T138):
 * the sigmoid reads the phase K of the search's rule set, which the matchup
 * cache carries (Pokémon Champions has its own).
 */
export function leafValue(battle: ReturnType<typeof positionBattle>, matchupCache: MatchupCache): number {
  const raw = evaluatePosition(battle, matchupCache);
  if (battle.ended) return raw > 0 ? 1 : raw < 0 ? -1 : 0;
  const race = lastPairRace(battle, matchupCache);
  if (race) return lastPairValue(race);
  return wpUnits(raw, battle.gameType === 'doubles', battleFaintedFraction(battle), matchupCache.ruleset);
}

/** Move ids named in a (possibly combined) choice string. */
const choiceMoveIds = (choice: string): string[] => choice.split(',')
  .map(part => part.trim().split(' '))
  .filter(tokens => tokens[0] === 'move')
  .map(tokens => tokens[1]);

/**
 * Singles only: the simulator's queue meets both sides' moves at equal priority and speed, so it flips a coin for the
 * order. Round 69 (T146 c4): moved here from outcome-children.ts (which re-exports it) so the root cell and the
 * roll-sensitivity below read it too. Round 72 (T196): the queue itself answers (sim-ask/action-order.ts), so Prankster,
 * Gale Wings, Triage, Stall, Quick Claw and the speed rules of every generation count as the simulator counts them.
 */
export function speedTie(battle: ReturnType<typeof positionBattle>, p1Choice: string, p2Choice: string): boolean {
  if (battle.gameType !== 'singles') return false;
  const ids = [choiceMoveIds(p1Choice)[0], choiceMoveIds(p2Choice)[0]];
  const actives = [battle.sides[0].active[0], battle.sides[1].active[0]];
  if (!ids[0] || !ids[1] || !actives[0] || !actives[1]) return false;
  return actionsTie(battle, { pokemon: actives[0], moveId: ids[0] }, { pokemon: actives[1], moveId: ids[1] });
}

/** The scripts that settle a tied pair's coin flip for one order: the side that moves first, on its own move (scripted-prng.ts). */
export function tieOrderScripts(p1Choice: string, p2Choice: string): Record<'p1' | 'p2', RollScripts> {
  const ids = { p1: choiceMoveIds(p1Choice)[0], p2: choiceMoveIds(p2Choice)[0] };
  const script = (first: 'p1' | 'p2'): RollScripts => new Map([[`${first}:${ids[first]}`, { first }]]);
  return { p1: script('p1'), p2: script('p2') };
}

/** The pair includes an accuracy roll, a random-call move or a speed tie — seeds diverge. */
export function rollSensitivePair(battle: ReturnType<typeof positionBattle>, p1Choice: string, p2Choice: string): boolean {
  if (speedTie(battle, p1Choice, p2Choice)) return true;
  return [...choiceMoveIds(p1Choice), ...choiceMoveIds(p2Choice)].some(id => {
    const move = battle.dex.moves.get(id);
    if (!move.exists) return false;
    if (randomCallMoves(battle.dex).has(move.id)) return true;
    return typeof move.accuracy === 'number' && move.accuracy < 100;
  });
}

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

/** A murmur-style 32-bit finalizer: integer arithmetic only, so the browser and Node agree to the bit. */
function mix32(x: number): number {
  let h = x >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Round 89 (#59, T322 block 1): the finalizer and a text hash for the modules that key a draw by hash (the root quantiles of
 * `search/root-quantile.ts`; round 86's tree seeds keep `mix32` here). FNV-1a over the UTF-16 units, integer arithmetic only.
 */
export const hash32 = mix32;
export function hashText(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/**
 * Round 61: the seed a tree cell draws at creation. Round 86 (the engine reads the dice, T323): a hash of (seedOffset,
 * iteration). The five SEARCH_SEEDS are one arithmetic progression of the Gen 5 LCG state, so at one draw index a die came true
 * in 0, 1 or 2 of the five streams, never in a tenth of them at random: a 10 % paralysis in none or in a fifth of the five
 * seeds (in the singles tree one seed carried it in 74 % of its cells, the other four in at most 2 %), a 90 % move missing
 * in 73 % of slot 1's cells and in at most 7 % of the others, the same outcome in every cell of one slot (A10). A tree expands at most one cell per iteration, so (offset, iteration) names the expansion and
 * needs no cell key. The four 16-bit words of the seed come from a chain of the finalizer, none zero, and any tree
 * count gets its own streams. The sampler, the matrix search, the verify round and the endgame children keep
 * SEARCH_SEEDS.
 */
export function treeSeed(iteration: number, seedOffset: number): PRNGSeed {
  let h = mix32((Math.imul(seedOffset + 1, 0x9e3779b1) ^ Math.imul(iteration + 1, 0x85ebca6b)) >>> 0);
  const words: number[] = [];
  for (let i = 0; i < 4; i++) {
    h = mix32((h + 0x632be5ab) >>> 0);
    words.push((h & 0xffff) || 1);
  }
  return words.join(',') as PRNGSeed;
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

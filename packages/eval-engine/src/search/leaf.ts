import type { PRNGSeed } from '@pkmn/sim';
import { evaluatePosition, type MatchupCache } from '../eval-function.ts';
import type { positionBattle } from '../forward-model.ts';
import { randomCallMoves } from '../ko-odds.ts';
import { lastPairRace, lastPairValue } from '../score/last-pair.ts';
import { actionsTie } from '../sim-ask/index.ts';
import type { RollScripts } from '../forward/scripted-prng.ts';
import { wpUnits } from '../winprob.ts';


/** Base draws per cell: slots below this count and `settings.samples` draw first, the rest are probe slots. */
export const BASE_DRAWS = 5;

// Integer arithmetic only, so the browser and Node agree to the bit.
function mix32(x: number): number {
  let h = x >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** The finalizer and a text hash (FNV-1a over UTF-16 units) for the modules that key a draw by hash. */
export const hash32 = mix32;
export function hashText(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** The seed a tree cell draws at creation: a hash of (seedOffset, iteration), which names the expansion. */
export function treeSeed(iteration: number, seedOffset: number): PRNGSeed {
  let h = mix32((Math.imul(seedOffset + 1, 0x9e3779b1) ^ Math.imul(iteration + 1, 0x85ebca6b)) >>> 0);
  const words: number[] = [];
  for (let i = 0; i < 4; i++) {
    h = mix32((h + 0x632be5ab) >>> 0);
    words.push((h & 0xffff) || 1);
  }
  return words.join(',') as PRNGSeed;
}

/** The seed a cell reads at slot `index` of its list; `key` is its hash (`cellHash`, search/root-quantile.ts). */
export function cellSeed(index: number, key: number): PRNGSeed {
  const a = mix32((key ^ Math.imul(index + 1, 0x85ebca6b) ^ 0x165667b1) >>> 0);
  const b = mix32((key ^ Math.imul(index + 1, 0x9e3779b1) ^ 0x27d4eb2f) >>> 0);
  const x = mix32((b ^ mix32(a)) >>> 0);
  const y = mix32((a ^ x) >>> 0);
  return [(x & 0xffff) || 1, (x >>> 16) || 1, (y & 0xffff) || 1, (y >>> 16) || 1].join(',') as PRNGSeed;
}

export function cellSeedList(key: number, count: number): PRNGSeed[] {
  return Array.from({ length: count }, (_, index) => cellSeed(index, key));
}

export function countFainted(battle: ReturnType<typeof positionBattle>): number {
  return battle.sides[0].pokemon.filter(p => p.fainted).length +
    battle.sides[1].pokemon.filter(p => p.fainted).length;
}

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

/** The one place the sigmoid applies: every leaf becomes win-prob units (2p-1); ended battles clamp to exact +-1. */
export function leafValue(battle: ReturnType<typeof positionBattle>, matchupCache: MatchupCache): number {
  const raw = evaluatePosition(battle, matchupCache);
  if (battle.ended) return raw > 0 ? 1 : raw < 0 ? -1 : 0;
  const race = lastPairRace(battle, matchupCache);
  if (race) return lastPairValue(race);
  return wpUnits(raw, battle.gameType === 'doubles', battleFaintedFraction(battle), matchupCache.ruleset);
}

const choiceMoveIds = (choice: string): string[] => choice.split(',')
  .map(part => part.trim().split(' '))
  .filter(tokens => tokens[0] === 'move')
  .map(tokens => tokens[1]);

/** Singles only: whether the simulator's queue flips a coin for the order, as it answers (sim-ask/action-order.ts). */
export function speedTie(battle: ReturnType<typeof positionBattle>, p1Choice: string, p2Choice: string): boolean {
  if (battle.gameType !== 'singles') return false;
  const ids = [choiceMoveIds(p1Choice)[0], choiceMoveIds(p2Choice)[0]];
  const actives = [battle.sides[0].active[0], battle.sides[1].active[0]];
  if (!ids[0] || !ids[1] || !actives[0] || !actives[1]) return false;
  return actionsTie(battle, { pokemon: actives[0], moveId: ids[0] }, { pokemon: actives[1], moveId: ids[1] });
}

export function tieOrderScripts(p1Choice: string, p2Choice: string): Record<'p1' | 'p2', RollScripts> {
  const ids = { p1: choiceMoveIds(p1Choice)[0], p2: choiceMoveIds(p2Choice)[0] };
  const script = (first: 'p1' | 'p2'): RollScripts => new Map([[`${first}:${ids[first]}`, { first }]]);
  return { p1: script('p1'), p2: script('p2') };
}

export function rollSensitivePair(battle: ReturnType<typeof positionBattle>, p1Choice: string, p2Choice: string): boolean {
  if (speedTie(battle, p1Choice, p2Choice)) return true;
  return [...choiceMoveIds(p1Choice), ...choiceMoveIds(p2Choice)].some(id => {
    const move = battle.dex.moves.get(id);
    if (!move.exists) return false;
    if (randomCallMoves(battle.dex).has(move.id)) return true;
    return typeof move.accuracy === 'number' && move.accuracy < 100;
  });
}

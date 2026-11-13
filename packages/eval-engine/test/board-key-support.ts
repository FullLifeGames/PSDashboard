import type { Battle, Pokemon, PokemonSet } from '@pkmn/sim';
import { playedHit } from '../src/score/contact';
import { Interner, hitKeyReader } from '../src/score/memo-keys';
import { mon, type Mode, type Rules } from './dice-fixtures';
import { battleOf } from './power-oracle';

/**
 * Round 89 (#149, step A8): what the sweeps of the board key share. A pair of boards that differ in one piece of state is
 * sound for the key when the key splits wherever the hit played without a memo reads differently: the memo then answers each
 * board with its own play, whichever came first, and a clear changes nothing. The verdict compares the two plays and the two
 * keys (one interner for both, so the numbers in the keys mean the same strings).
 */

export type Tweak = (battle: Battle) => void;
export const attackerOf = (battle: Battle): Pokemon => battle.sides[0].active[0]!;
export const defenderOf = (battle: Battle): Pokemon => battle.sides[1].active[0]!;
export const partnerOf = (battle: Battle): Pokemon | undefined => battle.sides[0].active[1] ?? undefined;
export const foePartnerOf = (battle: Battle): Pokemon | undefined => battle.sides[1].active[1] ?? undefined;

/** The holders an entry is placed on: the attacker, the defender and, in doubles, the attacker's partner and the foe's partner. */
export const HOLDERS = ['attacker', 'defender', 'partner', 'foePartner'] as const;
export type Holder = typeof HOLDERS[number];
export const holderOf = (battle: Battle, holder: Holder): Pokemon | undefined =>
  ({ attacker: attackerOf, defender: defenderOf, partner: partnerOf, foePartner: foePartnerOf })[holder](battle);

export interface Lineup { attacker?: Partial<PokemonSet>; defender?: Partial<PokemonSet>; partner?: Partial<PokemonSet>; foePartner?: Partial<PokemonSet> }

/**
 * The board of a case: Snorlax (male) with the move against a Vaporeon (a pure Water type: no immunity of any generation reaches it),
 * in doubles a Blissey beside the attacker and a Chansey beside the foe, a second body behind each lead in singles. `lineup` puts an
 * ability or an item on a body.
 */
export function boardFor(rules: Rules, mode: Mode, moveId: string, lineup: Lineup = {}): Battle {
  const body = (species: string, moves: string[], extra: Partial<PokemonSet> | undefined, gender: 'M' | 'F' = 'F'): PokemonSet => ({ ...mon(rules, { species, moves, gender }), ...extra });
  const p1 = [body('Snorlax', [moveId, 'splash'], lineup.attacker, 'M'), body('Blissey', ['splash'], lineup.partner)];
  const p2 = [body('Vaporeon', ['splash'], lineup.defender), body('Chansey', ['splash'], lineup.foePartner)];
  return battleOf(mode === 'doubles' ? rules.doubles! : rules.singles, p1, p2);
}

export type Verdict = 'same' | 'split' | 'wrong';

/** Whether the two boards' hits differ (`split`: and the keys differ, as they must; `wrong`: and the keys are equal) or read the same. */
export function verdictOf(first: Battle, second: Battle, moveId: string): Verdict {
  const interner = new Interner();
  const keys = [first, second].map(battle => hitKeyReader(battle, interner)(attackerOf(battle), defenderOf(battle), moveId));
  const plays = [first, second].map(battle => JSON.stringify(playedHit(battle, attackerOf(battle), defenderOf(battle), moveId)));
  if (plays[0] === plays[1]) return 'same';
  return keys[0] === keys[1] ? 'wrong' : 'split';
}

/** Two values for a field, from the value the body holds: a flag flipped, a count raised, a stat name swapped; undefined where no pair is known. */
export function twoValues(value: unknown): [unknown, unknown] | undefined {
  if (typeof value === 'boolean') return [true, false];
  if (typeof value === 'number') return [0, Math.max(3, Math.floor(value / 2) + 1)];
  if (typeof value === 'string' && ['atk', 'def', 'spa', 'spd', 'spe'].includes(value)) return ['atk', value === 'spe' ? 'spd' : 'spe'];
  return undefined;
}

import type { Battle, Pokemon, PokemonSet } from '@pkmn/sim';
import { playedHit } from '../src/score/contact';
import { Interner, hitKeyReader } from '../src/score/memo-keys';
import { mon, type Mode, type Rules } from './dice-fixtures';
import { battleOf } from './power-oracle';

export const attackerOf = (battle: Battle): Pokemon => battle.sides[0].active[0]!;
export const defenderOf = (battle: Battle): Pokemon => battle.sides[1].active[0]!;
export const partnerOf = (battle: Battle): Pokemon | undefined => battle.sides[0].active[1] ?? undefined;
export const foePartnerOf = (battle: Battle): Pokemon | undefined => battle.sides[1].active[1] ?? undefined;

export const HOLDERS = ['attacker', 'defender', 'partner', 'foePartner'] as const;
export type Holder = typeof HOLDERS[number];
export const holderOf = (battle: Battle, holder: Holder): Pokemon | undefined =>
  ({ attacker: attackerOf, defender: defenderOf, partner: partnerOf, foePartner: foePartnerOf })[holder](battle);

export interface Lineup { attacker?: Partial<PokemonSet>; defender?: Partial<PokemonSet>; partner?: Partial<PokemonSet>; foePartner?: Partial<PokemonSet> }

/** Snorlax with the move against a Vaporeon (pure Water: no immunity of any generation reaches it). */
export function boardFor(rules: Rules, mode: Mode, moveId: string, lineup: Lineup = {}): Battle {
  const body = (species: string, moves: string[], extra: Partial<PokemonSet> | undefined, gender: 'M' | 'F' = 'F'): PokemonSet => ({ ...mon(rules, { species, moves, gender }), ...extra });
  const p1 = [body('Snorlax', [moveId, 'splash'], lineup.attacker, 'M'), body('Blissey', ['splash'], lineup.partner)];
  const p2 = [body('Vaporeon', ['splash'], lineup.defender), body('Chansey', ['splash'], lineup.foePartner)];
  return battleOf(mode === 'doubles' ? rules.doubles! : rules.singles, p1, p2);
}

export type Verdict = 'same' | 'split' | 'wrong';

export function verdictOf(first: Battle, second: Battle, moveId: string): Verdict {
  const interner = new Interner();
  const keys = [first, second].map(battle => hitKeyReader(battle, interner)(attackerOf(battle), defenderOf(battle), moveId));
  const plays = [first, second].map(battle => JSON.stringify(playedHit(battle, attackerOf(battle), defenderOf(battle), moveId)));
  if (plays[0] === plays[1]) return 'same';
  return keys[0] === keys[1] ? 'wrong' : 'split';
}

export function twoValues(value: unknown): [unknown, unknown] | undefined {
  if (typeof value === 'boolean') return [true, false];
  if (typeof value === 'number') return [0, Math.max(3, Math.floor(value / 2) + 1)];
  if (typeof value === 'string' && ['atk', 'def', 'spa', 'spd', 'spe'].includes(value)) return ['atk', value === 'spe' ? 'spd' : 'spe'];
  return undefined;
}

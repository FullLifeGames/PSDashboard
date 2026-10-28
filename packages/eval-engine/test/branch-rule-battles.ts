import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import type { SimBattle } from '../src/branch/types';

/** Shared builders of the round 77 branch-rule specs (forced passes, disabled moves, trapping): real simulator battles, no mocks. */

const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

export const setOf = (species: string, moves: string[], extra: Partial<PokemonSet> = {}): PokemonSet => ({
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy', evs, ivs, level: 100, ...extra,
});

/** A battle past team preview, both sides on their lead order (the first `active` bodies of each team stand). */
export function startBattle(format: string, p1: PokemonSet[], p2: PokemonSet[]): SimBattle {
  const battle = new Battle({
    formatid: toID(format), seed: [1, 2, 3, 4],
    p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  if (battle.sides[0].requestState === 'teampreview') {
    battle.choose('p1', 'default');
    battle.choose('p2', 'default');
  }
  return battle as unknown as SimBattle;
}

export const FORMATS = [
  { name: 'singles', id: 'gen9customgame', doubles: false },
  { name: 'doubles', id: 'gen9doublescustomgame', doubles: true },
];

export const sideId = (index: number) => (index === 0 ? 'p1' : 'p2') as 'p1' | 'p2';

/** One side's turn: the clicked move with a foe target where the Dex target type asks for one (doubles), the partner on Splash. */
export function moveCommand(battle: SimBattle, move: string, doubles: boolean): string {
  const targeted = doubles && battle.actions.targetTypeChoices(battle.dex.moves.get(move).target);
  return `move ${move}${targeted ? ' 1' : ''}${doubles ? ', move Splash' : ''}`;
}

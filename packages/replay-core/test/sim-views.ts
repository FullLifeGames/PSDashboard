import { Battle, Dex, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import * as champions from '@pkmn/mods/champions';

/**
 * Round 72 (T235): the rule sets the corpus plays, for the specs that hold a hand list to the simulator (the `oracle:` tags in
 * src). Generations 1 to 9 as singles Custom Games, the Champions mod as one, and the two doubles rule sets the bank plays
 * (Scarlet/Violet and Champions). A list that is right in one view and wrong in another fails with the view's name.
 */

Dex.mod('champions', champions as unknown as NonNullable<Parameters<typeof Dex.mod>[1]>);
Dex.formats.extend(champions.Formats);

export interface SimView {
  name: string;
  format: string;
  doubles: boolean;
  dex: typeof Dex;
}

const gens = [1, 2, 3, 4, 5, 6, 7, 8, 9];
export const SINGLES_VIEWS: SimView[] = [
  ...gens.map(gen => ({ name: `Gen ${gen}`, format: `gen${gen}customgame`, doubles: false, dex: Dex.forGen(gen) })),
  { name: 'Champions', format: 'gen9championscustomgame', doubles: false, dex: Dex.mod('champions') },
];
export const DOUBLES_VIEWS: SimView[] = [
  { name: 'Scarlet/Violet doubles', format: 'gen9doublescustomgame', doubles: true, dex: Dex.forGen(9) },
  { name: 'Champions doubles', format: 'gen9championsdoublescustomgame', doubles: true, dex: Dex.mod('champions') },
];
export const ALL_VIEWS: SimView[] = [...SINGLES_VIEWS, ...DOUBLES_VIEWS];

export function mon(species: string, moves: string[], extra: Partial<PokemonSet> = {}): PokemonSet {
  return {
    name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 252, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 100, gender: '', ...extra,
  };
}

/** A battle of the view past team preview, every set in team order. */
export function battleIn(view: SimView, p1: PokemonSet[], p2: PokemonSet[], seed = '1,2,3,4'): Battle {
  const battle = new Battle({
    formatid: toID(view.format), seed,
    p1: { name: 'Alpha', team: Teams.pack(p1) },
    p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  return battle;
}

/** The move names of a view's Dex that a set may carry (a move the view lacks is dropped). */
export const known = (view: SimView, ids: string[]): string[] => ids.filter(id => view.dex.moves.get(id).exists);

export { oracleTagAbove } from './oracle-tag';

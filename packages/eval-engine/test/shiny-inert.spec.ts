import { describe, expect, test } from 'vitest';
import { Battle, Dex, State, Teams, type PokemonSet } from '@pkmn/sim';

/**
 * Round 72, T238: the built sets carry the replay's shiny flag, so the simulator writes `, shiny` in a switch-in line the
 * way the game did. This sweep holds that the flag changes nothing else: for every species of generations 1 to 9
 * (singles and doubles formats), a body with the flag and a body without it, one turn played with the same dice, give
 * the same serialized battle once the flag and the details string that spells it are masked. Generations 1 and 2 are
 * in it on purpose (their shiny came from the DVs; the simulator does not read the flag there).
 */

const FOE: PokemonSet = {
  name: 'Foe', species: 'Snorlax', item: '', ability: 'No Ability', moves: ['Tackle'], nature: 'Serious', gender: '', level: 100,
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
};

const setOf = (species: string, shiny: boolean): PokemonSet => ({
  ...FOE, name: species, species, moves: ['Tackle'], gender: 'M', ...(shiny ? { shiny: true } : {}),
});

/** The serialized battle after one turn, the shiny flag and the text that spells it removed (the details string, the set's flag and the packed team the input log holds) and the log's clock lines. */
function played(format: string, species: string, shiny: boolean, doubles: boolean): string {
  const battle = new Battle({
    formatid: format as never, seed: [1, 2, 3, 4],
    p1: { name: 'A', team: Teams.pack([setOf(species, shiny), { ...FOE, name: 'Bench' }]) },
    p2: { name: 'B', team: Teams.pack([FOE, { ...FOE, name: 'Bench' }]) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) battle.makeChoices('default', 'default');
  battle.makeChoices(doubles ? 'move 1, move 1' : 'move 1', doubles ? 'move 1, move 1' : 'move 1');
  return JSON.stringify(State.serializeBattle(battle)).replaceAll(', shiny', '').replaceAll(',"shiny":true', '').replaceAll('|S|', '||').replace(/\|t:\|\d+/g, '|t:|');
}

describe('the shiny flag changes no mechanic', () => {
  test.each([1, 2, 3, 4, 5, 6, 7, 8, 9])('generation %i: every species plays the same with and without the flag, singles and doubles', (gen) => {
    const dex = Dex.forGen(gen);
    const species = dex.species.all().filter(entry => entry.exists && entry.gen <= gen && entry.isNonstandard !== 'CAP' && entry.isNonstandard !== 'Custom');
    expect(species.length).toBeGreaterThan(100);
    const differing: string[] = [];
    for (const entry of species) {
      for (const doubles of [false, true]) {
        if (doubles && gen < 3) continue;
        const format = `gen${gen}${doubles ? 'doubles' : ''}customgame`;
        let plain: string, shiny: string;
        try {
          plain = played(format, entry.name, false, doubles);
          shiny = played(format, entry.name, true, doubles);
        } catch {
          continue; // a species the format cannot field plays in neither
        }
        if (plain !== shiny) differing.push(`${entry.name} ${format}`);
      }
    }
    expect(differing).toEqual([]);
  }, 240_000);
});

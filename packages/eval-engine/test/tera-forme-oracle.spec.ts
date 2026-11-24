import { describe, expect, test } from 'vitest';
import { TERA_FORME_SPECIES } from '../src/branch/tera-restore';
import { DOUBLES_VIEWS, SINGLES_VIEWS, battleIn, mon, type SimView } from './sim-views';

// Morpeko keeps its forme under Tera: Hunger Switch's `onResidual` returns when `pokemon.terastallized`.

interface Outcome { forme: string; ability: string; maxhp: number }

function afterTurn(view: SimView, species: string, ability: string, click: boolean): Outcome {
  const battle = battleIn(view, [mon(species, ['splash'], { ability }), mon('Blissey', ['splash'])], [mon('Snorlax', ['splash']), mon('Snorlax', ['splash'])]);
  battle.choose('p1', `move 1${click ? ' terastallize' : ''}${view.doubles ? ', move 1' : ''}`);
  battle.choose('p2', view.doubles ? 'move 1, move 1' : 'move 1');
  const lead = battle.sides[0].active[0];
  return { forme: lead.species.name, ability: lead.ability, maxhp: lead.maxhp };
}

function leads(view: SimView): { species: string; ability: string }[] {
  return view.dex.species.all()
    .filter(species => species.exists && !species.isNonstandard && species.name === species.baseSpecies && !species.battleOnly)
    .map(species => ({ species: species.name, ability: view.dex.abilities.get(species.abilities[0]).id }));
}

describe('TERA_FORME_SPECIES is held to the simulator', () => {
  describe.each([SINGLES_VIEWS[8], DOUBLES_VIEWS[0]])('$name', view => {
    test('the species whose Tera click changes their forme, ability or maximum HP over a turn are the set', () => {
      const dependent = leads(view)
        .filter(lead => {
          const plain = afterTurn(view, lead.species, lead.ability, false);
          const tera = afterTurn(view, lead.species, lead.ability, true);
          return plain.forme !== tera.forme || plain.ability !== tera.ability || plain.maxhp !== tera.maxhp;
        })
        .map(lead => lead.species)
        .sort();
      expect(dependent).toEqual([...TERA_FORME_SPECIES].sort());
    });

    test('a Tera Morpeko keeps its forme across the turn end where the plain one turns Hangry', () => {
      const morpeko = leads(view).find(lead => lead.species === 'Morpeko')!;
      expect(afterTurn(view, morpeko.species, morpeko.ability, false).forme).toBe('Morpeko-Hangry');
      expect(afterTurn(view, morpeko.species, morpeko.ability, true).forme).toBe('Morpeko');
    });
  });
});

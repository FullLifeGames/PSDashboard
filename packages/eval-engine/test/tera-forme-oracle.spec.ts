import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { TERA_FORME_SPECIES } from '../src/branch/tera-restore';
import { DOUBLES_VIEWS, SINGLES_VIEWS, battleIn, mon, oracleTagAbove, type SimView } from './sim-views';

/**
 * Round 72 (T235), plan row 19: `TERA_FORME_SPECIES` in branch/tera-restore.ts names the species whose Terastallization leaves
 * more behind than the marker, so restoring the bare marker on a revived body would leave half a Tera there:
 *  - Ogerpon: the click turns it into its Tera forme and gives it Embody Aspect;
 *  - Terapagos: the click turns it into the Terastal forme (a different ability and maximum HP);
 *  - Morpeko: the click changes nothing at once, but Hunger Switch (its `onResidual` returns when `pokemon.terastallized`) stops
 *    flipping it between Full Belly and Hangry at every turn end.
 * The spec plays every base species of Generation 9, in singles and in doubles (Champions has no Terastallization): the
 * same lead twice over one full turn, once with the Tera click and once without, and keeps the species whose forme, ability
 * or maximum HP at the end of the turn depends on the click. They are the list, and a Tera Morpeko is the one that keeps its
 * forme where the plain Morpeko turns Hangry.
 */

const SPEC = 'packages/eval-engine/test/tera-forme-oracle.spec.ts';

interface Outcome { forme: string; ability: string; maxhp: number }

/** The lead's forme, ability and maximum HP after one turn in which it uses its first move, with or without the Tera click. */
function afterTurn(view: SimView, species: string, ability: string, click: boolean): Outcome {
  const battle = battleIn(view, [mon(species, ['splash'], { ability }), mon('Blissey', ['splash'])], [mon('Snorlax', ['splash']), mon('Snorlax', ['splash'])]);
  battle.choose('p1', `move 1${click ? ' terastallize' : ''}${view.doubles ? ', move 1' : ''}`);
  battle.choose('p2', view.doubles ? 'move 1, move 1' : 'move 1');
  const lead = battle.sides[0].active[0];
  return { forme: lead.species.name, ability: lead.ability, maxhp: lead.maxhp };
}

/** One entry per base species of the view's Dex that can be a lead, with its first listed ability. */
function leads(view: SimView): { species: string; ability: string }[] {
  return view.dex.species.all()
    .filter(species => species.exists && !species.isNonstandard && species.name === species.baseSpecies && !species.battleOnly)
    .map(species => ({ species: species.name, ability: view.dex.abilities.get(species.abilities[0]).id }));
}

describe('TERA_FORME_SPECIES is held to the simulator (round 72)', () => {
  test('the set carries its oracle tag and the file names the reason per species', () => {
    expect(oracleTagAbove('packages/eval-engine/src/branch/tera-restore.ts', 'const TERA_FORME_SPECIES', SPEC)).toBe(true);
    const source = readFileSync(new URL('../src/branch/tera-restore.ts', import.meta.url), 'utf8');
    for (const word of ['Ogerpon', 'Terapagos', 'Morpeko', 'Hunger Switch']) expect(source, word).toContain(word);
  });

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

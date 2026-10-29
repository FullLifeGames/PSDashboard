import { describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';
import { ATTACKER_SIDE_FLAG_BY_ID, DEFENDER_SIDE_FLAG_BY_ID, FIELD_FLAG_BY_ID, allyFactOf } from '../src/calc-field';
import { partnerAbility } from '../src/spreads/partner-ability';
import { FIELD_DAMAGE_HOOK } from '../src/team/item-damage-shared';

/**
 * Round 73 (T203): the abilities that change another Pokémon's damage, read from the Dex, against what the calculator tables of
 * `calc-field.ts` hold. A new ability with such a handler in a later Dex fails here until the tables name it or this file says why
 * the calculator lacks it. The partner path (`partnerAbility`) is held to the Dex species the same way: a species with one ability
 * has it, any other species has the ability of its set.
 */

Dex.mod('champions', championsMod as unknown as NonNullable<Parameters<typeof Dex.mod>[1]>);

const dexes = [5, 6, 7, 8, 9].map(gen => [`gen ${gen}`, Dex.forGen(gen)] as const).concat([['champions', Dex.mod('champions')] as never]);

/** The abilities with a damage hook on another Pokémon, by their handlers. */
const hooked = (dex: ReturnType<typeof Dex.forGen>) => dex.abilities.all()
  .map(ability => ({ id: ability.id, hooks: Object.keys(ability).filter(key => FIELD_DAMAGE_HOOK.test(key)) }))
  .filter(entry => entry.hooks.length > 0);

/** Where the calculator reads an ability: the field (any holder), the attacker's ally, the defender's ally. */
function tableOf(hooks: string[]): 'field' | 'attacker' | 'defender' | 'both' | 'unknown' {
  const ally = hooks.filter(hook => hook.startsWith('onAlly'));
  const offense = ally.some(hook => /(BasePower|ModifyAtk|ModifySpA)$/.test(hook));
  const defense = ally.some(hook => /(ModifyDef|ModifySpD)$/.test(hook)) || hooks.includes('onAnyModifyDamage');
  if (offense && defense) return 'both';
  if (offense) return 'attacker';
  if (defense) return 'defender';
  return hooks.some(hook => hook.startsWith('onAny')) ? 'field' : 'unknown';
}

/** What the calculator lacks, with the reason. Empty while the tables hold every hooked ability. */
const CALCULATOR_LACKS: Record<string, string> = {};

describe('the calculator tables hold every ability with a damage hook on another Pokémon', () => {
  test.each(dexes)('%s', (_name, dex) => {
    const entries = hooked(dex);
    expect(entries.length).toBeGreaterThan(8);
    for (const { id, hooks } of entries) {
      if (id in CALCULATOR_LACKS) continue;
      const where = tableOf(hooks);
      expect(where, `${id} (${hooks.join(', ')})`).not.toBe('unknown');
      if (where === 'field') expect(FIELD_FLAG_BY_ID, id).toHaveProperty(id);
      if (where === 'attacker' || where === 'both') expect(allyFactOf('attacker', id), `${id} as the attacker's ally`).toBe(id);
      if (where === 'defender' || where === 'both') expect(allyFactOf('defender', id), `${id} as the defender's ally`).not.toBeNull();
    }
  });

  test('every ally table entry that names an ability is an ability the Dex hooks', () => {
    const ids = new Set(dexes.flatMap(([, dex]) => hooked(dex).map(entry => entry.id)));
    // The field table also holds conditions (Gravity, the rooms) and Aura Break, which the Dex handles outside the damage hooks.
    for (const key of [...Object.keys(ATTACKER_SIDE_FLAG_BY_ID), ...Object.keys(DEFENDER_SIDE_FLAG_BY_ID)]) {
      if (Dex.abilities.get(key).exists) expect(ids.has(key), `${key} has no damage hook in any Dex`).toBe(true);
    }
  });
});

describe('the partner path follows the Dex species (singles has no partner)', () => {
  const partnerAbilities = Object.keys(ATTACKER_SIDE_FLAG_BY_ID).concat(Object.keys(DEFENDER_SIDE_FLAG_BY_ID)).filter(id => Dex.abilities.get(id).exists);

  test.each(dexes)('%s: a species with one ability has it, any other species has its set\'s', (_name, dex) => {
    let singles = 0;
    let several = 0;
    for (const species of dex.species.all()) {
      const abilities = [...new Set(Object.values(species.abilities).map(name => dex.abilities.get(name).id))];
      const mine = abilities.filter(id => partnerAbilities.includes(id));
      if (mine.length === 0) continue;
      if (abilities.length === 1) {
        singles += 1;
        expect(partnerAbility(dex, [], species.name), species.name).toBe(abilities[0]);
      } else {
        several += 1;
        const set = { name: species.name, species: species.name, ability: dex.abilities.get(mine[0]).name } as never;
        expect(partnerAbility(dex, [set], species.name), species.name).toBe(mine[0]);
        expect(partnerAbility(dex, [], species.name), `${species.name} without a set`).toBe('');
      }
    }
    expect(singles + several).toBeGreaterThan(0);
  });

  // Round 78 (@pkmn 0.10.12): Regulation M-C brings Perrserker, whose Steely Spirit lifts its partner's Steel moves.
  test('the Champions roster holds three families of these species: Vivillon (the Champions scene plays it) and Maushold with Friend Guard, Perrserker with Steely Spirit', () => {
    const dex = Dex.mod('champions');
    const partnerOf = (species: { abilities: Record<string, string> }) =>
      Object.values(species.abilities).map(name => dex.abilities.get(name).id).filter(id => partnerAbilities.includes(id)).join(',');
    const named = dex.species.all().filter(species => !species.isNonstandard && partnerOf(species) !== '');
    expect([...new Set(named.map(species => species.baseSpecies))]).toEqual(['Vivillon', 'Perrserker', 'Maushold']);
    expect(Object.fromEntries(named.map(species => [species.baseSpecies, partnerOf(species)])))
      .toEqual({ Vivillon: 'friendguard', Perrserker: 'steelyspirit', Maushold: 'friendguard' });
  });
});

import { describe, expect, test } from 'vitest';
import { Generations } from '@smogon/calc';
import * as bodyModule from '../src/calc/body';
import { calcAddsStages, calcPokemon, type CalcBody } from '../src/calc/body';
import { CALC_HAS_GEN0 } from './calc-version';

/**
 * Round 68 (T186, decision 5): entry stages as in 0.11. @smogon/calc 0.12 gives Intrepid Sword and Dauntless Shield
 * their stage only in Gen 8 or when the Pokémon's `abilityOn` is set; Download and the Embody Aspects still give theirs
 * by themselves. The engine keeps 0.11's behavior: a body still to come in gets the stage once (abilityOn for the
 * ability a probe finds in the second group), a body on the field never does (its stage comes from the simulator).
 * Two probes tell the groups apart per gen and ability, both read from the calc, no list: `calcAddsStages` (the calc
 * adds a stage of its own) and `calcOwnEntryStage(gen, ability)` (it adds a stage to the holder when abilityOn is true).
 * These checkers need the 0.12 calculator (skipped under 0.11, enabled by step C3; the ones asking calcOwnEntryStage
 * stay red until step C6 writes it).
 */
const ownEntryStage = (bodyModule as unknown as { calcOwnEntryStage?: (gen: number, ability: string) => boolean }).calcOwnEntryStage;
const BODY: CalcBody = {
  species: 'Zacian-Crowned', level: 100, ability: 'Intrepid Sword', item: 'Rusted Sword', nature: 'Hardy', evs: {}, ivs: {},
  boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, tera: null, onField: false,
};

describe.skipIf(!CALC_HAS_GEN0)('the entry stages of 0.12 (decision 5)', () => {
  test('the calc adds a stage of its own for Download, the Embody Aspects and, in Gen 8, Sword and Shield', () => {
    const found = (gen: number) => [...Generations.get(gen as 9).abilities].map(ability => ability.name).filter(name => calcAddsStages(gen, name)).sort();
    expect(found(3)).toEqual([]);
    for (const gen of [4, 5, 6, 7]) expect(found(gen), `gen ${gen}`).toEqual(['Download']);
    expect(found(8)).toEqual(['Dauntless Shield', 'Download', 'Intrepid Sword']);
    expect(found(9)).toEqual(['Download', 'Embody Aspect (Cornerstone)', 'Embody Aspect (Hearthflame)', 'Embody Aspect (Teal)', 'Embody Aspect (Wellspring)']);
  });

  test('the calc adds a stage to its holder only with abilityOn for Intrepid Sword and Dauntless Shield in Gen 9, and nothing else', () => {
    expect(typeof ownEntryStage, 'calcOwnEntryStage in calc/body.ts').toBe('function');
    const found = (gen: number) => [...Generations.get(gen as 9).abilities].map(ability => ability.name).filter(name => ownEntryStage!(gen, name)).sort();
    expect(found(9)).toEqual(['Dauntless Shield', 'Intrepid Sword']);
    for (const gen of [3, 4, 5, 6, 7, 8]) expect(found(gen), `gen ${gen}`).toEqual([]);
  });

  test('singles and doubles share the builder: a body to come in gets abilityOn for Intrepid Sword once, a body on the field never', () => {
    const gen = Generations.get(9);
    expect(calcPokemon(gen, BODY).abilityOn, 'to come in').toBe(true);
    expect(calcPokemon(gen, { ...BODY, onField: true }).abilityOn, 'on the field').toBeFalsy();
    expect(calcPokemon(gen, { ...BODY, ability: 'Pressure' }).abilityOn, 'an ability with no entry stage').toBeFalsy();
  });
});

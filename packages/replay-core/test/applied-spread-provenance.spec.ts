import { describe, expect, test } from 'vitest';
import {
  applyInferredSpreads, guessedEvs, guessedField, INFERRED_SPREAD_DETAIL, ORDER_SPREAD_DETAIL, MEASURED_HP_SPREAD_DETAIL,
} from '../src/team-info';
import type { SpreadCandidate } from '../src/spread-inference';
import type { OpponentTeamInfo, PokemonEvs, RevealedPokemonInfo } from '../src/types';

/**
 * Round 69 (T69, spec decision 13): the panel's label says who checked the spread. An entry that keeps the guess's
 * EVs and nature keeps the guess's label (gen9ou-2658659909: Tyranitar Adamant 0/252/0/0/4/252 was stamped
 * "fits observed damage" with the guess's own numbers); an entry that changes them carries the label of its
 * origin. The overlay never reads the game type, so one table covers singles and doubles.
 */
const evs = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): PokemonEvs => ({ hp, atk, def, spa, spd, spe });
const SET_DETAIL = 'Smogon sets gen9ou';
const guess = evs(0, 252, 0, 0, 4, 252);

const tyranitar = (overrides: Partial<RevealedPokemonInfo> = {}): RevealedPokemonInfo => ({
  species: 'Tyranitar', moves: [], ability: { value: '', source: 'unknown' }, item: { value: '', source: 'unknown' },
  teraType: { value: '', source: 'unknown' }, level: 100, gender: '',
  evs: guessedEvs({ ...guess }, undefined, SET_DETAIL), nature: guessedField('Adamant', undefined, SET_DETAIL),
  ...overrides,
});
const info = (pokemon: RevealedPokemonInfo): OpponentTeamInfo => ({ pokemon: [pokemon] });
const apply = (candidate: SpreadCandidate, pokemon = tyranitar()) =>
  applyInferredSpreads(info(pokemon), 'p2', new Map([['p2:tyranitar', candidate]])).pokemon[0];

describe('the label of an applied spread', () => {
  test.each(['damage', 'order', 'hp', 'prior'] as const)('a candidate with the guess\'s EVs and nature keeps the guess\'s label (%s)', origin => {
    const mon = apply({ evs: { ...guess }, nature: 'Adamant', origin });
    expect(mon.evs.sourceDetail).toBe(SET_DETAIL);
    expect(mon.nature?.sourceDetail).toBe(SET_DETAIL);
  });

  test('changed EVs carry the label of their origin', () => {
    const changed = evs(0, 252, 0, 0, 4, 0);
    expect(apply({ evs: changed, nature: 'Adamant', origin: 'damage' }).evs.sourceDetail).toBe(INFERRED_SPREAD_DETAIL);
    expect(apply({ evs: changed, nature: 'Adamant', origin: 'order' }).evs.sourceDetail).toBe(ORDER_SPREAD_DETAIL);
    expect(apply({ evs: changed, nature: 'Adamant', origin: 'hp' }).evs.sourceDetail).toBe(MEASURED_HP_SPREAD_DETAIL);
    // An entry no evidence solved shows its numbers with the label of the guess they come from.
    const prior = apply({ evs: changed, nature: 'Adamant', origin: 'prior' });
    expect(prior.evs.value).toEqual(changed);
    expect(prior.evs.sourceDetail).toBe(SET_DETAIL);
  });

  test('an entry from before the origin existed reads as fitted from damage', () => {
    expect(apply({ evs: evs(0, 252, 0, 0, 4, 0), nature: 'Adamant' }).evs.sourceDetail).toBe(INFERRED_SPREAD_DETAIL);
  });

  test('EVs and nature are judged apart', () => {
    const mon = apply({ evs: { ...guess }, nature: 'Jolly', origin: 'order' });
    expect(mon.evs.sourceDetail).toBe(SET_DETAIL);
    expect(mon.nature?.value).toBe('Jolly');
    expect(mon.nature?.sourceDetail).toBe(ORDER_SPREAD_DETAIL);
    const evsOnly = apply({ evs: evs(0, 252, 0, 0, 4, 0), nature: 'Adamant', origin: 'damage' });
    expect(evsOnly.evs.sourceDetail).toBe(INFERRED_SPREAD_DETAIL);
    expect(evsOnly.nature?.sourceDetail).toBe(SET_DETAIL);
  });

  test('a manual or revealed spread is never relabelled', () => {
    const manual = tyranitar({ evs: { value: { ...guess }, source: 'manual' }, nature: { value: 'Adamant', source: 'manual' } });
    const mon = apply({ evs: evs(0, 0, 0, 252, 0, 252), nature: 'Timid', origin: 'damage' }, manual);
    expect(mon.evs.source).toBe('manual');
    expect(mon.nature?.source).toBe('manual');
  });
});

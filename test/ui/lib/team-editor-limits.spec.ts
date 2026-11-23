import { beforeAll, describe, expect, test } from 'vitest';
import { TeamValidator, type PokemonSet } from '@pkmn/sim';
import { loadSimMods } from '@fulllifegames/eval-engine';
import { EV_STATS, clampEv, evLimitsFor, canonicalMove, withEditedStandIns } from '../../../src/lib/team-editor';
import { getEvLimit } from '../../../src/lib/pokemon-options';
import { field, revealedPokemon } from '../fixtures/team-info';

/**
 * Round 69 (T162): the editor clamps the EVs of a set by the format's limits.
 * Pokémon Champions replaces EVs by Stat Points (32 per stat, 66 in total),
 * Scarlet/Violet caps the total at 510. The table is checked against the
 * simulator's own team validator, so it cannot drift from the format.
 */

describe('team-editor-limits', () => {
  const SINGLES_CHAMPIONS = 'gen9championsou';
  const DOUBLES_CHAMPIONS = 'gen9championsvgc2026regmcbo3';
  const SINGLES_SV = 'gen9ou';
  const DOUBLES_SV = 'gen9doublesou';
  const FORMATS = [SINGLES_CHAMPIONS, DOUBLES_CHAMPIONS, SINGLES_SV, DOUBLES_SV];

  beforeAll(async () => {
    await loadSimMods(SINGLES_CHAMPIONS);
  });

  describe('clampEv by the format limits', () => {
    for (const format of [SINGLES_CHAMPIONS, DOUBLES_CHAMPIONS]) {
      test(`${format} (Stat Points): 40 clamps to 32, 32 beside 40 clamps to 26, negative and text give 0`, () => {
        const limits = evLimitsFor(format);
        expect(limits).toMatchObject({ perStat: 32, total: 66, statPoints: true });
        expect(clampEv('40', limits)).toBe(32);
        expect(clampEv('32', limits, 40)).toBe(26);
        expect(clampEv('32', limits, 66)).toBe(0);
        expect(clampEv('32', limits, 80)).toBe(0);
        expect(clampEv('-3', limits)).toBe(0);
        expect(clampEv('abc', limits)).toBe(0);
      });
    }

    for (const format of [SINGLES_SV, DOUBLES_SV, 'gen9vgc2026regf']) {
      test(`${format} (EVs): 252 stays 252 and a format without a known total caps no total`, () => {
        const limits = evLimitsFor(format);
        expect(limits).toMatchObject({ perStat: 252, total: null, statPoints: false });
        expect(clampEv('252', limits)).toBe(252);
        expect(clampEv('300', limits)).toBe(252);
        expect(clampEv('252', limits, 508)).toBe(252);
      });
      test(`${format}: a total from the simulator caps the stat beside the others`, () => {
        const limits = evLimitsFor(format, 510);
        expect(clampEv('252', limits, 252)).toBe(252);
        expect(clampEv('252', limits, 300)).toBe(210);
        expect(clampEv('252', limits, 510)).toBe(0);
        // Round 76 (12a): the editor opens on the solved spread (252 Atk / 252 Spe / 4 SpD is 508 of 510), so a typed 252 HP keeps 2.
        expect(clampEv('252', limits, 508)).toBe(2);
      });
    }
  });

  /** A sound Garchomp set carrying the spread; only the EV problems are read. */
  const evProblems = (format: string, evs: number[]): string[] => {
    const set = {
      name: 'Garchomp', species: 'Garchomp', item: 'Life Orb', ability: 'Rough Skin', moves: ['Earthquake'], nature: 'Jolly', gender: '',
      level: 50, evs: { hp: evs[0], atk: evs[1], def: evs[2], spa: evs[3], spd: evs[4], spe: evs[5] },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, teraType: 'Steel',
    } as PokemonSet;
    return (TeamValidator.get(format).validateSet(set, {}) ?? []).filter(problem => /EVs|Stat Points/.test(problem));
  };

  /** The spread the editor ends on when a player types the same number into every stat. */
  function typedEverywhere(format: string, typed: string): number[] {
    const limits = evLimitsFor(format, getEvLimit(format));
    const spread = [0, 0, 0, 0, 0, 0];
    EV_STATS.forEach((_stat, index) => {
      const others = spread.reduce((sum, value, i) => (i === index ? sum : sum + value), 0);
      spread[index] = clampEv(typed, limits, others);
    });
    return spread;
  }

  describe('the limits equal the simulator validator\'s', () => {
    for (const format of FORMATS) {
      test(`${format}: what the editor lets through validates, one more in total does not`, () => {
        const limits = evLimitsFor(format, getEvLimit(format));
        expect(limits.total).not.toBeNull();
        const spread = typedEverywhere(format, '999');
        expect(spread.every(value => value <= limits.perStat)).toBe(true);
        expect(spread.reduce((sum, value) => sum + value, 0)).toBe(limits.total);
        expect(evProblems(format, spread)).toEqual([]);

        const over = [...spread];
        over[5] = spread[5] + 1;
        expect(evProblems(format, over).length).toBeGreaterThan(0);
      });
    }

    for (const format of [SINGLES_CHAMPIONS, DOUBLES_CHAMPIONS]) {
      test(`${format}: the validator accepts 32 on one stat and rejects 33`, () => {
        expect(evLimitsFor(format).perStat).toBe(32);
        expect(evProblems(format, [0, 32, 0, 0, 0, 0])).toEqual([]);
        expect(evProblems(format, [0, 33, 0, 0, 0, 0]).join(' ')).toMatch(/more than 32 Stat Points/);
      });
    }
  });
});

const pool = ['Earthquake', 'Fire Fang'];
const every = ['Earthquake', 'Fire Fang', 'Power Whip', 'Spore'];

describe('canonicalMove', () => {
  test('a move of the species keeps its pool spelling and carries no note', () => {
    expect(canonicalMove(pool, 'fire fang', every)).toEqual({ canonical: 'Fire Fang', outside: false });
  });

  test('a move of the generation the species cannot learn resolves to the generation\'s spelling, marked outside', () => {
    expect(canonicalMove(pool, 'power whip', every)).toEqual({ canonical: 'Power Whip', outside: true });
  });

  test('a name the generation does not know is unknown', () => {
    expect(canonicalMove(pool, 'Moon Landing', every)).toEqual({ unknown: true });
  });

  test('a species without a pool of its own still reads the generation\'s list, and no note is possible', () => {
    expect(canonicalMove(undefined, 'spore', every)).toEqual({ canonical: 'Spore', outside: false });
    expect(canonicalMove([], 'Moon Landing', every)).toEqual({ unknown: true });
  });

  test('before the pools load, any name is taken as typed', () => {
    expect(canonicalMove(undefined, 'Magma Storm')).toEqual({ canonical: 'Magma Storm', outside: false });
    expect(canonicalMove(undefined, 'Magma Storm', [])).toEqual({ canonical: 'Magma Storm', outside: false });
  });
});

describe('withEditedStandIns', () => {
  const guess = (species: string) => revealedPokemon(species, { standIn: true });

  test.each(['Tyranitar', 'Incineroar'])('a %s stand-in the editor left alone keeps its flag, an edited one loses it', species => {
    const original = [revealedPokemon('Azelf'), guess(species)];
    const untouched = withEditedStandIns(structuredClone(original), original);
    expect(untouched[1].standIn).toBe(true);

    const edited = structuredClone(original);
    edited[1] = { ...edited[1], item: field('Choice Scarf', 'manual') };
    const saved = withEditedStandIns(edited, original);
    expect('standIn' in saved[1]).toBe(false);
    expect(saved[1].item).toEqual({ value: 'Choice Scarf', source: 'manual' });
    expect(saved[0]).toEqual(original[0]);
  });

  test('a body that is no stand-in comes back as it went in', () => {
    const original = [revealedPokemon('Azelf')];
    const saved = withEditedStandIns([{ ...original[0], item: field('Leftovers', 'manual') }], original);
    expect(saved[0].item.source).toBe('manual');
    expect(saved[0].standIn).toBeUndefined();
  });
});
